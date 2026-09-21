/**
 * Load spoken cues for a scene HTML. Sidecar wins over window.REEL.captions.
 * Times are local to that HTML (same clock as REEL.duration).
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function srtStamp(s) {
  const m = String(s).trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

export function parseSrt(text) {
  const blocks = String(text).replace(/^\uFEFF/, "").trim().split(/\r?\n\r?\n+/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.length);
    if (lines.length < 2) continue;
    const idx = /-->/.test(lines[0]) ? 0 : 1;
    const m = lines[idx] && lines[idx].match(/(\S+)\s+-->\s+(\S+)/);
    if (!m) continue;
    const textLines = lines.slice(idx + 1).join("\n").trim();
    if (!textLines) continue;
    cues.push({ t: [srtStamp(m[1]), srtStamp(m[2])], text: textLines });
  }
  return cues;
}

export function cuesFromTimeline(raw) {
  if (!raw) return [];
  const lines = Array.isArray(raw.lines)
    ? raw.lines
    : Array.isArray(raw.captions)
      ? raw.captions
      : Array.isArray(raw)
        ? raw
        : [];
  const cues = [];
  for (const line of lines) {
    const text = String((line && (line.text || line.caption)) || "").trim();
    const t = line && line.t;
    if (!text || !Array.isArray(t) || t.length < 2) continue;
    cues.push({ t: [Number(t[0]), Number(t[1])], text });
  }
  return cues;
}

function readCues(abs) {
  if (!abs || !existsSync(abs)) return [];
  const src = readFileSync(abs, "utf8");
  if (/\.srt$/i.test(abs)) return parseSrt(src);
  try {
    return cuesFromTimeline(JSON.parse(src));
  } catch {
    return [];
  }
}

export function captionSidecars(htmlPath) {
  const dir = dirname(htmlPath);
  const stem = basename(htmlPath).replace(/\.html$/i, "");
  return [
    join(dir, stem + ".srt"),
    join(dir, stem + ".timeline.json"),
    join(dir, "captions.srt"),
    join(dir, "timeline.json"),
  ];
}

export function loadCuesForHtml(htmlPath) {
  for (const p of captionSidecars(htmlPath)) {
    const cues = readCues(p);
    if (cues.length) return { cues, file: p };
  }
  return { cues: [], file: null };
}

export function loadGbarForHtml(htmlPath) {
  const dir = dirname(htmlPath);
  const stem = basename(htmlPath).replace(/\.html$/i, "");
  const paths = [join(dir, stem + ".gbar.json"), join(dir, "gbar.json")];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const chapters = Array.isArray(raw.chapters)
        ? raw.chapters
        : Array.isArray(raw.gbar)
          ? raw.gbar
          : [];
      if (!chapters.length) continue;
      return { file: p, total: Number(raw.total) || 0, chapters };
    } catch {}
  }
  return { file: null, total: 0, chapters: [] };
}

export function injectSidecarJs(cues, gbar) {
  var js = "window.REEL = window.REEL || {};\n";
  if (cues && cues.length) {
    js += "window.REEL.captions = " + JSON.stringify(cues) + ";\n";
  }
  if (gbar && gbar.chapters && gbar.chapters.length) {
    js += "window.REEL.gbar = " + JSON.stringify(gbar.chapters) + ";\n";
    if (gbar.total > 0) js += "window.REEL.total = " + JSON.stringify(gbar.total) + ";\n";
  }
  js += "if (window.reel && window.reel.apply) window.reel.apply(window.__reelTime || 0);\n";
  return js;
}

export function injectCaptionsJs(cues) {
  return injectSidecarJs(cues, null);
}
