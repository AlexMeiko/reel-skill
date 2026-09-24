#!/usr/bin/env node
/**
 * Reel capture: seekable HTML → PNG sequence → MP4 via Chromium CDP + ffmpeg.
 * Zero npm deps. Needs a Chromium-based browser and ffmpeg.
 *
 * Full export (one scene, parallel headless windows sharing browsers):
 *   node capture.mjs scene.html --out out.mp4 --qa-dir qa [--jobs N]
 * Key-node stills before a long export:
 *   node capture.mjs scene.html --probe --qa-dir probe
 * Look at specific seconds of the live HTML (no MP4):
 *   node capture.mjs scene.html --at 20.5,41 --qa-dir shots
 * Final check of a finished MP4 (ffmpeg, includes concat result):
 *   node capture.mjs --from-mp4 scene.mp4 --qa-dir scene-qa [--qa-at 0,19.5,40]
 */

import { spawn } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
  existsSync,
  statfsSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { injectSidecarJs, loadCuesForHtml, loadGbarForHtml } from "./captions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEEK_HELPER = readFileSync(join(ROOT, "runtime", "seek.js"), "utf8");
const KIT_HELPER = readFileSync(join(ROOT, "runtime", "kit.js"), "utf8");
const PANEL_CANDIDATES = [
  process.env.REEL_PANEL,
  "http://127.0.0.1:8766",
  "http://127.0.0.1:8765",
].filter(Boolean);

let progressDir = null;
let lastPanelPost = 0;
function progressPaths() {
  const dir = progressDir || join(process.cwd(), "reel-out");
  return {
    dir,
    json: join(dir, ".reel-progress.json"),
    preview: join(dir, ".reel-preview.png"),
  };
}
function fileUrl(abs, baseDir) {
  const rel = relative(baseDir, abs).replace(/\\/g, "/");
  if (rel.startsWith("..")) return "/file/" + abs.split(/[\\/]/).pop();
  return "/file/" + rel;
}
function report(payload) {
  try {
    const paths = progressPaths();
    mkdirSync(paths.dir, { recursive: true });
    const body = { ...payload, at: Date.now() };
    writeFileSync(paths.json, JSON.stringify(body));
    const now = Date.now();
    if (payload.phase === "capture" && now - lastPanelPost < 100) return;
    lastPanelPost = now;
    for (const url of PANEL_CANDIDATES) {
      fetch(url + "/api/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    }
  } catch {}
}

function die(msg, code = 1) {
  report({ phase: "error", message: String(msg).slice(0, 300) });
  const err = new Error(msg);
  err.reelExit = code;
  err.reelReported = true;
  throw err;
}

const WINDOWS_PER_BROWSER = 4;

function defaultJobs() {
  const env = Number(process.env.REEL_JOBS);
  if (env > 0) return Math.max(1, Math.floor(env));
  const n = cpus() && cpus().length ? cpus().length : 2;
  return Math.max(1, n);
}

function defaultBrowsers(jobs) {
  const env = Number(process.env.REEL_BROWSERS);
  if (env > 0) return Math.max(1, Math.min(jobs, Math.floor(env)));
  return Math.max(1, Math.ceil(jobs / WINDOWS_PER_BROWSER));
}

function parseTimes(s) {
  const parts = String(s).split(/[,\s]+/).filter(Boolean);
  if (!parts.length) die("empty time list");
  return parts.map((raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) die("bad time \"" + raw + "\" (seconds >= 0)");
    return n;
  });
}

function parseArgs(argv) {
  const args = {
    input: null,
    out: null,
    qaDir: null,
    framesDir: null,
    keepFrames: false,
    fps: null,
    duration: null,
    width: null,
    height: null,
    edge: null,
    timeout: 20000,
    crf: 14,
    probe: false,
    jobs: defaultJobs(),
    browsers: null,
    at: null,
    qaAt: null,
    fromMp4: null,
    noSandbox: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) die("missing value for " + a);
      return v;
    };
    if (a === "--out") args.out = next();
    else if (a === "--qa-dir") args.qaDir = next();
    else if (a === "--frames-dir") args.framesDir = next();
    else if (a === "--keep-frames") args.keepFrames = true;
    else if (a === "--fps") args.fps = Number(next());
    else if (a === "--duration") args.duration = Number(next());
    else if (a === "--width") args.width = Number(next());
    else if (a === "--height") args.height = Number(next());
    else if (a === "--edge" || a === "--browser") args.edge = next();
    else if (a === "--timeout") args.timeout = Number(next());
    else if (a === "--crf") args.crf = Number(next());
    else if (a === "--probe") args.probe = true;
    else if (a === "--at") args.at = (args.at || []).concat(parseTimes(next()));
    else if (a === "--qa-at") args.qaAt = (args.qaAt || []).concat(parseTimes(next()));
    else if (a === "--from-mp4") args.fromMp4 = next();
    else if (a === "--no-sandbox") args.noSandbox = true;
    else if (a === "--jobs") args.jobs = Math.max(1, Number(next()) || 1);
    else if (a === "--browsers") args.browsers = Math.max(1, Number(next()) || 1);
    else if (a === "-h" || a === "--help") args.help = true;
    else if (a.startsWith("-")) die("unknown flag " + a);
    else rest.push(a);
  }
  args.input = rest[0];
  if (args.browsers == null) args.browsers = defaultBrowsers(args.jobs);
  else args.browsers = Math.max(1, Math.min(args.browsers, args.jobs));
  return args;
}

function whichEdge(explicit) {
  if (explicit) return explicit;
  const candidates = [
    process.env.REEL_BROWSER,
    process.env.REEL_EDGE,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge-stable",
    "/opt/microsoft/msedge/msedge",
    "/usr/bin/microsoft-edge",
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  die("cannot find Chrome/Chromium/Edge. Pass --browser /path/to/chrome");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.sessionId = null;
    this.handlers = new Map();
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (msg.method) {
        const fns = this.handlers.get(msg.method);
        if (fns) for (const fn of fns) fn(msg.params || {}, msg.sessionId);
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result || {});
      }
    });
  }
  on(method, fn) {
    const list = this.handlers.get(method) || [];
    list.push(fn);
    this.handlers.set(method, list);
  }
  send(method, params = {}, opts = {}) {
    const id = ++this.id;
    const payload = { id, method, params };
    const session =
      opts.session === false ? undefined : opts.session || this.sessionId;
    if (session) payload.sessionId = session;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("cdp timeout: " + method));
      }, opts.timeout || 20000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }
  wait(method, timeout = 15000, sessionId) {
    return new Promise((resolve, reject) => {
      const remove = () => {
        const list = this.handlers.get(method) || [];
        this.handlers.set(method, list.filter((x) => x !== fn));
      };
      const timer = setTimeout(() => {
        remove();
        reject(new Error("wait timeout: " + method));
      }, timeout);
      const fn = (params, eventSessionId) => {
        if (sessionId && eventSessionId !== sessionId) return;
        clearTimeout(timer);
        remove();
        resolve(params);
      };
      this.on(method, fn);
    });
  }
}

async function waitDevtoolsUrl(proc, timeoutMs) {
  let buf = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      const tail = buf.trim().split(/\r?\n/).slice(-20).join("\n");
      reject(
        new Error(
          "未取到 DevTools URL（浏览器没起来）。\n" +
            "容器 / root 环境可加 --no-sandbox（或 REEL_NO_SANDBOX=1）。\n" +
            "浏览器输出末 20 行：\n" +
            tail
        )
      );
    }, timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        cleanup();
        resolve(m[1]);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      proc.stderr.off("data", onData);
    };
    proc.stderr.on("data", onData);
    proc.stdout.on("data", onData);
  });
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("websocket error: " + url)));
  });
}

async function evaluate(cdp, expression, extra = {}) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    ...extra,
  });
  if (result.exceptionDetails) {
    const text =
      (result.exceptionDetails.exception && result.exceptionDetails.exception.description) ||
      result.exceptionDetails.text ||
      "evaluate failed";
    throw new Error(text);
  }
  return result.result ? result.result.value : undefined;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (c) => {
      err += c.toString();
    });
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(cmd + " exited " + code + "\n" + err));
    });
  });
}

function killProc(proc) {
  if (!proc || proc.exitCode != null) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    try {
      proc.kill("SIGTERM");
    } catch {}
  }
}

function inContainer() {
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

function smallDevShm() {
  try {
    const s = statfsSync("/dev/shm");
    return s.bsize * s.blocks < 128 * 1024 * 1024;
  } catch {
    return false;
  }
}

function chromeFlags(args) {
  const flags = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-extensions",
    "--disable-component-update",
    "--mute-audio",
    "--hide-scrollbars",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--force-device-scale-factor=1",
    "--remote-debugging-port=0",
  ];
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const container = inContainer();
  if (args.noSandbox || process.env.REEL_NO_SANDBOX === "1" || isRoot || container) {
    flags.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  if (container || args.forceDevShm || smallDevShm() || process.env.REEL_DISABLE_DEV_SHM === "1") {
    flags.push("--disable-dev-shm-usage");
  }
  if (process.env.REEL_CHROME_FLAGS) {
    flags.push(...process.env.REEL_CHROME_FLAGS.split(/\s+/).filter(Boolean));
  }
  return flags;
}

async function openPage(root, htmlPath, args) {
  const created = await root.send("Target.createTarget", { url: "about:blank", newWindow: true });
  const { sessionId } = await root.send("Target.attachToTarget", {
    targetId: created.targetId,
    flatten: true,
  });
  const page = {
    send: (method, params) => root.send(method, params, { session: sessionId }),
    wait: (method, timeout) => root.wait(method, timeout, sessionId),
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  const loaded = page.wait("Page.loadEventFired", args.timeout);
  await page.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
  await loaded;
  await evaluate(page, "document.fonts && document.fonts.ready ? document.fonts.ready.then(()=>true) : true");
  return page;
}

async function startBrowser(args) {
  const edge = whichEdge(args.edge);
  const work = mkdtempSync(join(tmpdir(), "reel-"));
  const profile = join(work, "profile");
  mkdirSync(profile, { recursive: true });
  const proc = spawn(
    edge,
    [...chromeFlags(args), "--user-data-dir=" + profile, "about:blank"],
    { stdio: ["ignore", "pipe", "pipe"], detached: true }
  );
  let ws, cdp;
  const close = async () => {
    try {
      if (cdp && ws.readyState === WebSocket.OPEN) {
        await cdp.send("Browser.close", {}, { timeout: 1000 });
      }
    } catch {}
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    } catch {}
    killProc(proc);
    await sleep(200);
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {}
  };
  try {
    const devtools = await waitDevtoolsUrl(proc, args.timeout);
    ws = await openWs(devtools);
    cdp = new Cdp(ws);
    return { cdp, close };
  } catch (err) {
    await close();
    if (/DevTools URL/.test(err.message) && !args.noSandbox) {
      console.error("[reel] 浏览器启动失败，改用 --no-sandbox --disable-dev-shm-usage 重试一次");
      return startBrowser({ ...args, noSandbox: true, forceDevShm: true });
    }
    throw err;
  }
}

async function withBrowser(htmlPath, args, fn) {
  const browser = await startBrowser(args);
  try {
    return await fn(await openPage(browser.cdp, htmlPath, args));
  } finally {
    await browser.close();
  }
}

async function readReel(cdp, args) {
  const meta = await evaluate(
    cdp,
    `(() => {
      var r = window.REEL || {};
      return {
        duration: Number(r.duration) || 0,
        fps: Number(r.fps) || 0,
        width: Number(r.width) || 0,
        height: Number(r.height) || 0,
        offset: Number(r.offset) || 0,
        captions: Array.isArray(r.captions) ? r.captions : [],
        chapters: Array.isArray(r.chapters) ? r.chapters : [],
        hud: Array.isArray(r.hud) ? r.hud : [],
        hasDraw: typeof window.reelDraw === "function",
        hasSeek: typeof window.reelSeek === "function"
      };
    })()`
  );
  if (!meta || !meta.duration) {
    die("window.REEL.duration missing. Declare window.REEL = { duration, fps, width, height }");
  }
  if (args.duration != null) {
    if (!Number.isFinite(args.duration) || !(args.duration > 0)) die("bad --duration " + args.duration);
    if (Math.abs(args.duration - meta.duration) > 0.02) {
      die(
        "--duration " +
          args.duration +
          " != page REEL.duration " +
          meta.duration +
          " (refusing to repeat or cut frames)"
      );
    }
  }
  const duration = meta.duration;
  const fps = args.fps || meta.fps || 30;
  const width = args.width || meta.width || 1280;
  const height = args.height || meta.height || 720;
  if (width % 2 || height % 2) die("width/height must be even for yuv420p, got " + width + "x" + height);
  if (!(fps > 0 && fps <= 60)) die("bad fps " + fps);
  if (!(duration > 0)) die("duration must be > 0, got " + duration);
  return { ...meta, duration, fps, width, height };
}

async function settleSeek(cdp) {
  await evaluate(
    cdp,
    "new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); })"
  );
  await sleep(40);
}

async function preparePage(cdp, reel, htmlPath) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: reel.width,
    height: reel.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const injected = await evaluate(cdp, SEEK_HELPER + "\n" + KIT_HELPER);
  if (injected !== "ok") die("failed to inject __reelSeek / kit");
  if (htmlPath) {
    const loaded = loadCuesForHtml(htmlPath, reel.offset);
    if (loaded.error) die(loaded.error);
    const cues = loaded.cues;
    const gbar = loadGbarForHtml(htmlPath);
    if (loaded.file) console.error("[reel] captions " + loaded.file);
    if (gbar && gbar.file) console.error("[reel] gbar " + gbar.file);
    if (cues.length || (gbar && gbar.chapters && gbar.chapters.length)) {
      await evaluate(cdp, injectSidecarJs(cues, gbar));
      if (cues.length) reel.captions = cues;
      if (gbar && gbar.chapters && gbar.chapters.length) reel.gbarChapters = gbar.chapters;
    }
  }
  await settleSeek(cdp);
}

async function screenshotAt(cdp, t) {
  await evaluate(cdp, "window.__reelSeek(" + JSON.stringify(t) + ")");
  await evaluate(
    cdp,
    "new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); })"
  );
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
    optimizeForSpeed: true,
  });
  if (!shot.data) throw new Error("empty screenshot at t=" + t);
  return Buffer.from(shot.data, "base64");
}

function keyNodes(reel) {
  const duration = reel.duration;
  const hits = [];
  const add = (t, label) => {
    const x = Math.max(0, Math.min(duration, Number(t)));
    if (Number.isNaN(x)) return;
    hits.push({ t: x, label: String(label || "") });
  };
  add(0, "start");
  add(duration, "end");
  for (const p of [0.25, 0.5, 0.75]) add(duration * p, Math.round(p * 100) + "%");
  (reel.captions || []).forEach((c, i) => {
    const a = c && c.t;
    if (!a) return;
    add(a[0], "caption " + (c.text || "#" + i));
  });
  (reel.chapters || []).forEach((c, i) => {
    const raw = c && c.t;
    const t0 = Array.isArray(raw) ? raw[0] : raw;
    add(t0, "chapter " + (c.title || c.text || "#" + i));
  });
  const offset = Number(reel.offset) || 0;
  (reel.gbarChapters || []).forEach((c, i) => {
    const raw = c && c.t;
    const t0 = Array.isArray(raw) ? raw[0] : raw;
    const local = Number(t0) - offset;
    if (!Number.isFinite(local) || local < -1e-3 || local > duration + 1e-3) return;
    add(local, "gbar " + (c.title || c.text || "#" + i));
  });
  hits.sort((a, b) => a.t - b.t || a.label.localeCompare(b.label));
  const out = [];
  for (const h of hits) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.t - h.t) < 0.08) {
      if (h.label && !prev.label.includes(h.label)) prev.label = prev.label + " · " + h.label;
      continue;
    }
    out.push({ t: h.t, label: h.label });
  }
  return out;
}

function warnOutOfRange(times, duration, flag) {
  const over = times.filter((t) => t > duration + 1e-6);
  if (over.length) {
    console.error(
      "warning: " + flag + " 超出本段时长 " + duration.toFixed(2) + "s，已压到段尾: " + over.join(", ")
    );
  }
}

function qaPoints(reel, override) {
  if (override && override.length) {
    warnOutOfRange(override, reel.duration, "--qa-at");
    return override.map((t) => ({ t, label: "qa-at" }));
  }
  let nodes = keyNodes(reel);
  const max = 20;
  if (nodes.length > max) {
    const picked = [];
    for (let i = 0; i < max; i++) {
      picked.push(nodes[Math.round((i * (nodes.length - 1)) / (max - 1))]);
    }
    nodes = picked;
  }
  return nodes;
}

function probeDuration(file) {
  return new Promise((resolveP, reject) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ]);
    let out = "";
    p.stdout.on("data", (c) => (out += c.toString()));
    p.on("close", (code) => {
      if (code === 0) resolveP(Number(out.trim()) || 0);
      else reject(new Error("ffprobe failed on " + file));
    });
  });
}

async function browserStills(htmlPath, args) {
  const qaDir = args.qaDir ? resolve(args.qaDir) : join(dirname(htmlPath), "shots");
  mkdirSync(qaDir, { recursive: true });
  return withBrowser(htmlPath, args, async (cdp) => {
    const reel = await readReel(cdp, args);
    await preparePage(cdp, reel, htmlPath);
    const times = args.at && args.at.length ? args.at : [0, reel.duration];
    warnOutOfRange(times, reel.duration, "--at");
    const files = [];
    for (let i = 0; i < times.length; i++) {
      const t = Math.max(0, Math.min(reel.duration, times[i]));
      const buf = await screenshotAt(cdp, t);
      const name = "at-" + String(i).padStart(2, "0") + "-" + t.toFixed(2).replace(".", "_") + "s.png";
      writeFileSync(join(qaDir, name), buf);
      const previewPath = progressPaths().preview;
      writeFileSync(previewPath, buf);
      files.push({ file: name, t });
      report({
        phase: "probe",
        current: i + 1,
        total: times.length,
        t,
        duration: reel.duration,
        preview: fileUrl(previewPath, progressDir),
        message: "定点 " + (i + 1) + "/" + times.length + " t=" + t.toFixed(2),
      });
    }
    const manifest = {
      ok: true,
      at: true,
      duration: reel.duration,
      fps: reel.fps,
      width: reel.width,
      height: reel.height,
      files,
      dir: qaDir,
    };
    writeFileSync(join(qaDir, "at.json"), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(manifest, null, 2));
    return manifest;
  });
}

async function extractFromMp4(args) {
  const mp4 = resolve(args.fromMp4);
  if (!existsSync(mp4)) die("mp4 not found: " + mp4);
  const qaDir = args.qaDir ? resolve(args.qaDir) : join(dirname(mp4), "scene-qa");
  mkdirSync(qaDir, { recursive: true });
  const dur = await probeDuration(mp4);
  const times =
    args.qaAt && args.qaAt.length
      ? args.qaAt
      : args.at && args.at.length
        ? args.at
        : [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((p) => p * dur);
  if (args.qaAt && args.qaAt.length) warnOutOfRange(times, dur, "--qa-at");
  else if (args.at && args.at.length) warnOutOfRange(times, dur, "--at");
  const files = [];
  for (let i = 0; i < times.length; i++) {
    const t = Math.max(0, Math.min(dur, times[i]));
    const dest = join(qaDir, "qa-" + String(i).padStart(2, "0") + ".png");
    await run("ffmpeg", [
      "-y",
      "-ss",
      String(t),
      "-i",
      mp4,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      dest,
    ]);
    files.push({ file: basename(dest), t });
    report({
      phase: "probe",
      current: i + 1,
      total: times.length,
      t,
      duration: dur,
      message: "成片抽帧 " + (i + 1) + "/" + times.length + " t=" + t.toFixed(2),
    });
  }
  const manifest = { ok: true, fromMp4: mp4, duration: dur, files, dir: qaDir };
  writeFileSync(join(qaDir, "qa.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}

async function captureRange(cdp, framesDir, start, count, fps, duration, onFrame) {
  mkdirSync(framesDir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const idx = start + i;
    const t = Math.min(duration, idx / fps);
    const buf = await screenshotAt(cdp, t);
    writeFileSync(join(framesDir, String(idx).padStart(6, "0") + ".png"), buf);
    if (onFrame) onFrame(idx, t, buf);
  }
}

async function probeScene(htmlPath, args, reelFromParent) {
  const qaDir = args.qaDir ? resolve(args.qaDir) : join(dirname(htmlPath), "probe");
  mkdirSync(qaDir, { recursive: true });
  return withBrowser(htmlPath, args, async (cdp) => {
    const reel = reelFromParent || (await readReel(cdp, args));
    await preparePage(cdp, reel, htmlPath);
    const nodes = keyNodes(reel);
    const files = [];
    report({
      phase: "probe",
      current: 0,
      total: nodes.length,
      duration: reel.duration,
      message: "探针 0/" + nodes.length,
    });
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const buf = await screenshotAt(cdp, node.t);
      const name = "probe-" + String(i).padStart(2, "0") + ".png";
      const dest = join(qaDir, name);
      writeFileSync(dest, buf);
      files.push({ file: name, t: node.t, label: node.label });
      const previewPath = progressPaths().preview;
      writeFileSync(previewPath, buf);
      report({
        phase: "probe",
        current: i + 1,
        total: nodes.length,
        t: node.t,
        duration: reel.duration,
        preview: fileUrl(previewPath, progressDir),
        message: "探针 " + (i + 1) + "/" + nodes.length + " t=" + node.t.toFixed(2) + " " + node.label,
      });
    }
    const manifest = { ok: true, probe: true, duration: reel.duration, fps: reel.fps, width: reel.width, height: reel.height, nodes: files };
    writeFileSync(join(qaDir, "probe.json"), JSON.stringify(manifest, null, 2));
    report({
      phase: "done",
      current: nodes.length,
      total: nodes.length,
      duration: reel.duration,
      qa: files.map((f) => fileUrl(join(qaDir, f.file), progressDir)),
      message: "探针完成 " + nodes.length + " 张",
    });
    console.log(JSON.stringify({ ...manifest, dir: qaDir }, null, 2));
    return manifest;
  });
}

function assertMp4(outPath) {
  if (!String(outPath).toLowerCase().endsWith(".mp4")) {
    die("--out must be a .mp4 file, got " + outPath);
  }
}

function ensureDir(dir, label) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    die(label + " not writable: " + dir + " (" + (err && err.message ? err.message : err) + ")");
  }
}

async function exportScene(htmlPath, args) {
  const outPath = resolve(args.out || join(dirname(htmlPath), "out.mp4"));
  assertMp4(outPath);
  ensureDir(dirname(outPath), "output dir");
  ensureDir(args.qaDir ? resolve(args.qaDir) : join(dirname(outPath), "qa"), "qa dir");
  progressDir = dirname(outPath);
  const work = mkdtempSync(join(tmpdir(), "reel-frames-"));
  const framesDir = args.framesDir ? resolve(args.framesDir) : join(work, "frames");
  mkdirSync(framesDir, { recursive: true });
  const sceneRel = fileUrl(htmlPath, progressDir).replace(/^\/file\//, "");
  let reel;
  let total = 0;
  let jobs = Math.max(1, args.jobs || 1);
  try {
    const tickFrame = (idx, t, buf, tot, r) => {
      const tick = {
        phase: "capture",
        scene: sceneRel,
        current: idx + 1,
        total: tot,
        t,
        fps: r.fps,
        duration: r.duration,
        width: r.width,
        height: r.height,
        message: "截帧 " + (idx + 1) + "/" + tot,
      };
      if (idx % 8 === 0 || idx === tot - 1) {
        const previewPath = progressPaths().preview;
        writeFileSync(previewPath, buf);
        tick.preview = fileUrl(previewPath, progressDir);
      }
      report(tick);
    };

    if (jobs <= 1) {
      await withBrowser(htmlPath, args, async (cdp) => {
        reel = await readReel(cdp, args);
        await preparePage(cdp, reel, htmlPath);
        total = Math.max(2, Math.round(reel.duration * reel.fps));
        report({
          phase: "capture",
          scene: sceneRel,
          current: 0,
          total,
          t: 0,
          fps: reel.fps,
          duration: reel.duration,
          width: reel.width,
          height: reel.height,
          message: "开始截帧 0/" + total,
        });
        await captureRange(cdp, framesDir, 0, total, reel.fps, reel.duration, (idx, t, buf) =>
          tickFrame(idx, t, buf, total, reel)
        );
      });
    } else {
      const started = [];
      try {
        const firstBrowser = await startBrowser(args);
        started.push(firstBrowser);
        const first = await openPage(firstBrowser.cdp, htmlPath, args);
        const r = await readReel(first, args);
        await preparePage(first, r, htmlPath);
        total = Math.max(2, Math.round(r.duration * r.fps));
        jobs = Math.max(1, Math.min(jobs, total));
        const browserCount = Math.max(1, Math.min(args.browsers, jobs));
        for (let b = 1; b < browserCount; b++) started.push(await startBrowser(args));
        const chunk = Math.ceil(total / jobs);
        const slices = [];
        for (let j = 0; j < jobs; j++) {
          const start = j * chunk;
          if (start >= total) break;
          slices.push({ start, count: Math.min(chunk, total - start) });
        }
        const pages = [];
        for (let i = 0; i < slices.length; i++) {
          const root = started[i % started.length].cdp;
          if (i === 0) {
            pages.push(first);
            continue;
          }
          const page = await openPage(root, htmlPath, args);
          await preparePage(page, r, htmlPath);
          pages.push(page);
        }
        report({
          phase: "capture",
          scene: sceneRel,
          current: 0,
          total,
          t: 0,
          fps: r.fps,
          duration: r.duration,
          width: r.width,
          height: r.height,
          message: "开始截帧 0/" + total + " ×" + pages.length + " 页",
        });
        const timer = setInterval(() => {
          let n = 0;
          try {
            n = readdirSync(framesDir).filter((f) => f.endsWith(".png")).length;
          } catch {}
          report({
            phase: "capture",
            scene: sceneRel,
            current: n,
            total,
            fps: r.fps,
            duration: r.duration,
            width: r.width,
            height: r.height,
            message: "截帧 " + n + "/" + total + " ×" + pages.length + " 页",
          });
        }, 400);
        try {
          await Promise.all(
            slices.map((s, i) =>
              captureRange(pages[i], framesDir, s.start, s.count, r.fps, r.duration, (idx, t, buf) =>
                tickFrame(idx, t, buf, total, r)
              )
            )
          );
        } finally {
          clearInterval(timer);
        }
        const have = readdirSync(framesDir).filter((f) => f.endsWith(".png")).length;
        if (have < total) die("parallel capture missing frames: " + have + "/" + total);
        reel = r;
      } finally {
        for (const s of started) await s.close();
      }
    }

    report({
      phase: "encode",
      scene: sceneRel,
      current: total,
      total,
      fps: reel.fps,
      duration: reel.duration,
      message: "ffmpeg 合成中",
    });
    await run("ffmpeg", [
      "-y",
      "-framerate",
      String(reel.fps),
      "-i",
      join(framesDir, "%06d.png"),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      String(args.crf),
      "-movflags",
      "+faststart",
      outPath,
    ]);

    const qaDir = args.qaDir ? resolve(args.qaDir) : join(dirname(outPath), "qa");
    const qa = [];
    const qaList = [];
    mkdirSync(qaDir, { recursive: true });
    const pts = qaPoints(reel, args.qaAt);
    for (const [i, node] of pts.entries()) {
      const idx = Math.min(total - 1, Math.max(0, Math.round(node.t * reel.fps)));
      const dest = join(qaDir, "qa-" + String(i).padStart(2, "0") + ".png");
      copyFileSync(join(framesDir, String(idx).padStart(6, "0") + ".png"), dest);
      qa.push(dest);
      qaList.push({ file: basename(dest), t: node.t, label: node.label || "" });
    }
    writeFileSync(
      join(qaDir, "qa.json"),
      JSON.stringify({ ok: true, mp4: outPath, duration: reel.duration, points: qaList }, null, 2)
    );
    const result = {
      ok: true,
      mp4: outPath,
      frames: total,
      fps: reel.fps,
      duration: reel.duration,
      width: reel.width,
      height: reel.height,
      jobs,
      qa,
    };
    report({
      phase: "done",
      scene: sceneRel,
      current: total,
      total,
      fps: reel.fps,
      duration: reel.duration,
      width: reel.width,
      height: reel.height,
      mp4: outPath,
      qa: qa.map((abs) => fileUrl(abs, progressDir)),
      message: "导出完成",
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (!args.keepFrames && !args.framesDir) {
      try {
        rmSync(work, { recursive: true, force: true });
      } catch {}
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.input && !args.fromMp4)) {
    console.log(`Usage:
  node capture.mjs <scene.html> --out out.mp4 [--qa-dir dir] [--jobs N]
  node capture.mjs <scene.html> --probe --qa-dir probe-dir
  node capture.mjs <scene.html> --at 20.5,41 --qa-dir shots
  node capture.mjs --from-mp4 scene.mp4 --qa-dir scene-qa [--qa-at 0,19.5,40]

  --probe      key-node stills (caption/chapter/quartiles), no MP4
  --at S[,S…]  live HTML stills at these seconds (SEGMENT time, 0 → REEL.duration), no MP4
  --from-mp4 F extract stills from a finished MP4 (ffmpeg; use for final QA)
  --qa-at S[,S…]  override QA sample times (segment time for export; whole-film time for --from-mp4)
  --jobs N     parallel headless windows (default = CPU count)
  --browsers N browser processes (default = ceil(jobs/4), at least 1, not more than jobs)
  --crf N      x264 quality, lower is better (default 14)
  --fps overrides window.REEL.fps
  --width --height change the viewport only; they do not scale .stage
  --timeout N  page-load timeout in ms (default 20000)
  --duration must match window.REEL.duration; a mismatch is an error, not a trim
  --out must be a .mp4 path
  --browser PATH  --no-sandbox  --frames-dir DIR  --keep-frames`);
    process.exit(args.help ? 0 : 64);
  }
  if (args.fromMp4) {
    progressDir = args.qaDir ? resolve(args.qaDir) : dirname(resolve(args.fromMp4));
    mkdirSync(progressDir, { recursive: true });
    await extractFromMp4(args);
    return;
  }
  const htmlPath = resolve(args.input);
  if (!existsSync(htmlPath)) die("html not found: " + htmlPath);
  if (args.at && args.at.length) {
    progressDir = args.qaDir ? resolve(args.qaDir) : dirname(htmlPath);
    mkdirSync(progressDir, { recursive: true });
    await browserStills(htmlPath, args);
    return;
  }
  if (args.probe) {
    progressDir = args.qaDir ? resolve(args.qaDir) : dirname(htmlPath);
    mkdirSync(progressDir, { recursive: true });
    await probeScene(htmlPath, args);
    return;
  }
  if (!args.out) {
    args.out = join(dirname(htmlPath), "out.mp4");
  }
  await exportScene(htmlPath, args);
}

main().catch((err) => {
  const message = err && err.message ? err.message : String(err);
  if (!err.reelReported) report({ phase: "error", message: message.slice(0, 300) });
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(err.reelExit || 1);
});
