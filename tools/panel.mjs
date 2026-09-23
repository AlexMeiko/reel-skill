#!/usr/bin/env node
/**
 * Reel panel: live preview of whatever the calling agent writes.
 * Does not call a model. Generation is the agent that loaded the skill.
 *
 *   node tools/panel.mjs [--dir $PWD/reel-out] [--port 8766] [--no-open] [scene.html]
 */

import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
} from "node:fs";
import http from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { injectSidecarJs, loadCuesForHtml, loadGbarForHtml } from "./captions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { port: 8766, open: true, scene: null, dir: process.env.REEL_OUT || null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--dir") args.dir = argv[++i];
    else if (a === "--no-open") args.open = false;
    else if (a === "--open") args.open = true;
    else if (!a.startsWith("-")) args.scene = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.dir && args.scene) args.dir = dirname(resolve(args.scene));
const OUT_DIR = resolve(args.dir || join(process.cwd(), "reel-out"));
mkdirSync(OUT_DIR, { recursive: true });

function under(root, p) {
  const full = resolve(root, p);
  const rel = relative(root, full);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) return null;
  return full;
}

function resolveScene(rel) {
  if (!rel) return null;
  if (rel.startsWith("examples/")) return under(ROOT, rel);
  return under(OUT_DIR, rel) || under(ROOT, rel);
}

function resolvePublic(rel) {
  if (!rel) return null;
  return under(OUT_DIR, rel) || under(ROOT, rel);
}

function publicUrl(abs) {
  const fromOut = relative(OUT_DIR, abs);
  if (!fromOut.startsWith("..")) return "/file/" + fromOut.replace(/\\/g, "/");
  const fromRoot = relative(ROOT, abs);
  if (!fromRoot.startsWith("..")) return "/file/" + fromRoot.replace(/\\/g, "/");
  return null;
}

function listScenes() {
  const out = [];
  if (existsSync(OUT_DIR)) {
    for (const name of readdirSync(OUT_DIR).sort()) {
      if (name.endsWith(".html") && !name.startsWith(".")) out.push(name);
    }
  }
  const examples = join(ROOT, "examples");
  if (existsSync(examples)) {
    for (const name of readdirSync(examples).sort()) {
      if (name.endsWith(".html")) out.push("examples/" + name);
    }
  }
  return out;
}

function htmlOffset(html) {
  const m = String(html).match(/\boffset\s*:\s*(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

function injectRuntime(html, htmlPath) {
  const loaded = htmlPath ? loadCuesForHtml(htmlPath, htmlOffset(html)) : { cues: [], error: null };
  if (loaded.error) console.error("[reel] " + loaded.error);
  const cues = loaded.cues;
  const gbar = htmlPath ? loadGbarForHtml(htmlPath) : { chapters: [] };
  const cap = injectSidecarJs(cues, gbar);
  // Read per request: the panel is long-lived, so a cached copy would hide edits to runtime/.
  const seek = readFileSync(join(ROOT, "runtime", "seek.js"), "utf8");
  const kit = readFileSync(join(ROOT, "runtime", "kit.js"), "utf8");
  const tag = "<script>\n" + cap + seek + "\n" + kit + "\n</script>\n";
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, tag + "</body>");
  return html + tag;
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function mime(p) {
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".mp4": "video/mp4",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
    }[extname(p).toLowerCase()] || "application/octet-stream"
  );
}

function whichEdge() {
  for (const c of [
    process.env.REEL_BROWSER,
    process.env.REEL_EDGE,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge-stable",
    "/opt/microsoft/msedge/msedge",
    "/usr/bin/microsoft-edge",
  ].filter(Boolean)) {
    if (existsSync(c)) return c;
  }
  return null;
}

function openEdge(url) {
  const edge = whichEdge();
  if (!edge) {
    console.error("browser not found; open " + url + " yourself");
    return;
  }
  spawn(edge, ["--new-window", url], { detached: true, stdio: "ignore" }).unref();
}

const clients = new Set();
let lastProgress = null;

function emit(event) {
  const line = "data: " + JSON.stringify(event) + "\n\n";
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

function fileMtime(rel) {
  const abs = resolveScene(rel);
  if (!abs || !existsSync(abs)) return 0;
  try {
    return statSync(abs).mtimeMs;
  } catch {
    return 0;
  }
}

function statusPayload() {
  return {
    type: "status",
    scenes: listScenes(),
    mtimes: Object.fromEntries(listScenes().map((s) => [s, fileMtime(s)])),
  };
}

function capture(sceneRel) {
  const html = resolveScene(sceneRel);
  if (!html || !existsSync(html)) throw new Error("scene not found: " + sceneRel);
  const base = sceneRel.replace(/[\\/]/g, "-").replace(/\.html$/i, "");
  const mp4 = join(OUT_DIR, base + ".mp4");
  const qaDir = join(OUT_DIR, base + "-qa");
  const script = join(ROOT, "tools", "capture.mjs");
  emit({ type: "log", text: "截帧 " + sceneRel });
  return new Promise((resolveP, reject) => {
    const p = spawn(process.execPath, [script, html, "--out", mp4, "--qa-dir", qaDir], {
      cwd: OUT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => {
      out += c.toString();
    });
    p.stderr.on("data", (c) => {
      err += c.toString();
    });
    p.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err || out || "capture exited " + code));
        return;
      }
      const json = JSON.parse(out.trim().split("\n").filter(Boolean).pop());
      json.qa = (json.qa || []).map((abs) => publicUrl(abs)).filter(Boolean);
      json.mp4Url = publicUrl(json.mp4);
      emit({ type: "capture", ok: true, scene: sceneRel, qa: json.qa, mp4: json.mp4 });
      resolveP(json);
    });
  });
}

function watchAbs(abs, toRel) {
  if (!existsSync(abs)) return;
  let timer = null;
  watch(abs, (event, filename) => {
    if (!filename) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const rel = toRel(filename);
      if (filename === ".reel-progress.json") {
        try {
          lastProgress = JSON.parse(readFileSync(join(abs, filename), "utf8"));
          emit({ type: "progress", ...lastProgress });
        } catch {}
        return;
      }
      if (filename.startsWith(".")) return;
      if (filename.endsWith(".html")) {
        emit({ type: "scene", path: rel, mtime: fileMtime(rel) });
        emit(statusPayload());
        emit({ type: "log", text: "已更新 " + rel });
      } else if (filename.endsWith(".srt") || filename.endsWith(".json")) {
        if (filename.startsWith(".")) return;
        emit({ type: "captions", path: rel });
        emit({ type: "log", text: "字幕/时间轴已更新 " + rel });
      }
    }, 120);
  });
}

if (args.scene) {
  const abs = resolve(args.scene);
  const relOut = relative(OUT_DIR, abs);
  const relRoot = relative(ROOT, abs);
  if (!relOut.startsWith("..")) args.sceneRel = relOut.replace(/\\/g, "/");
  else if (!relRoot.startsWith("..")) args.sceneRel = relRoot.replace(/\\/g, "/");
}

watchAbs(OUT_DIR, (name) => name);
watchAbs(join(ROOT, "examples"), (name) => "examples/" + name);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      send(
        res,
        200,
        readFileSync(join(ROOT, "runtime", "panel.html"), "utf8"),
        "text/html; charset=utf-8"
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(":\n\n");
      clients.add(res);
      res.write("data: " + JSON.stringify(statusPayload()) + "\n\n");
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/scenes") {
      send(res, 200, JSON.stringify({ scenes: listScenes() }), "application/json");
      return;
    }
    if (req.method === "GET" && url.pathname === "/scene") {
      const rel = url.searchParams.get("path") || args.sceneRel || "examples/signal.html";
      const abs = resolveScene(rel);
      if (!abs || !existsSync(abs)) {
        send(res, 404, "scene not found");
        return;
      }
      send(res, 200, injectRuntime(readFileSync(abs, "utf8"), abs), "text/html; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/file/")) {
      const abs = resolvePublic(url.pathname.slice("/file/".length));
      if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
        send(res, 404, "not found");
        return;
      }
      res.writeHead(200, { "content-type": mime(abs), "cache-control": "no-store" });
      createReadStream(abs).pipe(res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/progress") {
      send(res, 200, JSON.stringify(lastProgress || { phase: "idle" }), "application/json");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/progress") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      lastProgress = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      emit({ type: "progress", ...lastProgress });
      send(res, 200, JSON.stringify({ ok: true }), "application/json");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/capture") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const json = await capture(body.path);
      send(res, 200, JSON.stringify(json), "application/json");
      return;
    }
    send(res, 404, "not found");
  } catch (err) {
    send(
      res,
      500,
      JSON.stringify({ ok: false, error: String(err.message || err) }),
      "application/json"
    );
  }
});

server.listen(args.port, "0.0.0.0", () => {
  const q = args.sceneRel ? "?scene=" + encodeURIComponent(args.sceneRel) : "";
  const local = "http://127.0.0.1:" + args.port + "/" + q;
  console.log("Reel panel http://0.0.0.0:" + args.port + "/" + q);
  console.log("watching " + OUT_DIR);
  if (args.open) openEdge(local);
});
