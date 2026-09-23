#!/usr/bin/env node
/**
 * timeline.json → sidecar subtitles (default SRT). Do not burn captions into HTML.
 *
 *   node subs.mjs reel-out/timeline.json --out reel-out/captions.srt
 *   node subs.mjs part-01.json part-02.json --out captions.srt
 *
 * Multiple files: timestamps accumulate by each file's `duration`
 * (or last cue end if duration missing).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const files = [];
  let out = null;
  let format = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out = argv[++i];
    else if (a === "--format") format = argv[++i];
    else if (a === "-h" || a === "--help") return { help: true };
    else if (a.startsWith("-")) die("unknown flag " + a, 64);
    else files.push(a);
  }
  return { files, out, format };
}

function loadTimeline(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const lines = Array.isArray(raw.lines) ? raw.lines : Array.isArray(raw) ? raw : [];
  const cues = [];
  for (const line of lines) {
    const text = String((line && (line.text || line.caption)) || "").trim();
    const t = line && line.t;
    if (!text || !Array.isArray(t) || t.length < 2) continue;
    cues.push({
      text,
      start: Number(t[0]),
      end: Number(t[1]),
    });
  }
  let duration = Number(raw.duration);
  if (!(duration > 0) && cues.length) duration = cues[cues.length - 1].end;
  return { duration: duration || 0, cues };
}

function srtTime(sec) {
  let ms = Math.round(Math.max(0, Number(sec) || 0) * 1000);
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  ms %= 1000;
  const pad = (n, w) => String(n).padStart(w, "0");
  return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + "," + pad(ms, 3);
}

function vttTime(sec) {
  return srtTime(sec).replace(",", ".");
}

function toSrt(cues) {
  return (
    cues
      .map((c, i) => i + 1 + "\n" + srtTime(c.start) + " --> " + srtTime(c.end) + "\n" + c.text)
      .join("\n\n") + (cues.length ? "\n" : "")
  );
}

function toVtt(cues) {
  return (
    "WEBVTT\n\n" +
    cues
      .map((c) => vttTime(c.start) + " --> " + vttTime(c.end) + "\n" + c.text)
      .join("\n\n") + (cues.length ? "\n" : "")
  );
}

function guessFormat(out, explicit) {
  if (explicit) return explicit;
  if (out && /\.vtt$/i.test(out)) return "vtt";
  return "srt";
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.files || !args.files.length) {
  console.log("Usage: node subs.mjs timeline.json [more.json] --out captions.srt [--format srt|vtt]");
  process.exit(args.help ? 0 : 64);
}

const all = [];
let offset = 0;
for (const f of args.files) {
  const tl = loadTimeline(resolve(f));
  for (const c of tl.cues) {
    all.push({ text: c.text, start: c.start + offset, end: c.end + offset });
  }
  offset += tl.duration || (tl.cues.length ? tl.cues[tl.cues.length - 1].end : 0);
}
if (!all.length) die("no cues in timeline");

const outPath = resolve(args.out || "captions.srt");
const format = guessFormat(outPath, args.format);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, format === "vtt" ? toVtt(all) : toSrt(all));
console.log(JSON.stringify({ ok: true, cues: all.length, format, out: outPath }, null, 2));
