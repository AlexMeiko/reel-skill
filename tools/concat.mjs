#!/usr/bin/env node
/**
 * Concat reel parts into one MP4. Stream copy only (no re-encode).
 * Parts must already match (size, fps, codec) — capture output does.
 *
 *   node tools/concat.mjs part-01.mp4 part-02.mp4 --out scene.mp4
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

function parseArgs(argv) {
  const files = [];
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out = argv[++i];
    else if (a === "-h" || a === "--help") return { help: true };
    else if (a.startsWith("-")) {
      console.error("unknown flag " + a);
      process.exit(64);
    } else files.push(a);
  }
  return { files, out };
}

function quote(p) {
  return "'" + resolve(p).replace(/'/g, "'\\''") + "'";
}

function run(cmd, args) {
  return new Promise((resolveP, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (c) => {
      err += c.toString();
    });
    p.on("close", (code) => {
      if (code === 0) resolveP();
      else reject(new Error(cmd + " exited " + code + "\n" + err.slice(-2000)));
    });
  });
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.out || !args.files || args.files.length < 2) {
  console.log("Usage: node concat.mjs a.mp4 b.mp4 [...] --out out.mp4");
  process.exit(args.help ? 0 : 64);
}

const outPath = resolve(args.out);
mkdirSync(dirname(outPath), { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "reel-concat-"));
const list = join(dir, "list.txt");
writeFileSync(list, args.files.map((f) => "file " + quote(f)).join("\n") + "\n");

try {
  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outPath,
  ]);
  console.log(JSON.stringify({ ok: true, mp4: outPath, parts: args.files.map((f) => resolve(f)) }, null, 2));
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
