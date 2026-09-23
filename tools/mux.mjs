#!/usr/bin/env node
/**
 * Mix picture + optional voice. Captions are already in the picture
 * (panel/capture kit). Do not burn libass unless --burn.
 *
 *   node mux.mjs --video scene.mp4 --audio voice.wav --out scene-vo.mp4
 *   voice.wav is the full mix (joined line audio, or an external recording)
 *   node mux.mjs --video scene.mp4 --subs captions.srt --burn --out scene-vo.mp4
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    video: null,
    audio: null,
    subs: null,
    out: null,
    burn: false,
    soft: false,
    lufs: -16,
    keepStereo: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) die("missing value for " + a);
      return v;
    };
    if (a === "--video") args.video = next();
    else if (a === "--audio") args.audio = next();
    else if (a === "--subs") args.subs = next();
    else if (a === "--out") args.out = next();
    else if (a === "--burn") args.burn = true;
    else if (a === "--soft") args.soft = true;
    else if (a === "--lufs") args.lufs = Number(next());
    else if (a === "--keep-stereo") args.keepStereo = true;
    else if (a === "-h" || a === "--help") args.help = true;
    else die("unknown flag " + a, 64);
  }
  return args;
}

function run(cmd, argv) {
  return new Promise((resolveP, reject) => {
    const p = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"] });
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

function subtitlesFilter(abs) {
  const escaped = resolve(abs).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  return "subtitles=" + escaped;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.video || !args.out) {
  console.log(`Usage: node mux.mjs --video scene.mp4 [--audio full-mix.wav] --out scene-vo.mp4
  captions already live in the video from capture
  voice is downmixed to mono and normalized to -16 LUFS (TP -1.5). Override with --lufs, or --keep-stereo
  --burn --subs file.srt   optional ffmpeg/libass overlay
  --soft --subs file.srt   optional mov_text track`);
  process.exit(args.help ? 0 : 64);
}

const video = resolve(args.video);
const outPath = resolve(args.out);
if (!existsSync(video)) die("video not found: " + video);
const audio = args.audio ? resolve(args.audio) : null;
const subs = args.subs ? resolve(args.subs) : null;
if (audio && !existsSync(audio)) die("audio not found: " + audio);
if (subs && !existsSync(subs)) die("subs not found: " + subs);
if ((args.burn || args.soft) && !subs) die("--burn/--soft needs --subs");

mkdirSync(dirname(outPath), { recursive: true });

const ff = ["-y", "-i", video];
if (audio) ff.push("-i", audio);
if (subs && args.soft) ff.push("-i", subs);

ff.push("-map", "0:v:0");
if (audio) ff.push("-map", "1:a:0");
if (subs && args.soft) ff.push("-map", audio ? "2:s:0" : "1:s:0");

if (args.burn && subs) {
  ff.push("-vf", subtitlesFilter(subs), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18");
} else {
  ff.push("-c:v", "copy");
}
if (audio) {
  if (!(args.lufs < 0)) die("--lufs must be negative LUFS, got " + args.lufs);
  const chain = args.keepStereo
    ? "loudnorm=I=" + args.lufs + ":TP=-1.5:LRA=11"
    : "aformat=channel_layouts=mono,loudnorm=I=" + args.lufs + ":TP=-1.5:LRA=11";
  ff.push("-af", chain, "-c:a", "aac", "-b:a", "192k");
  if (!args.keepStereo) ff.push("-ac", "1");
}
if (subs && args.soft) ff.push("-c:s", "mov_text", "-metadata:s:s:0", "language=chi");
ff.push("-shortest", "-movflags", "+faststart", outPath);

try {
  await run("ffmpeg", ff);
} catch (err) {
  die(err && err.message ? err.message : String(err));
}
console.log(
  JSON.stringify(
    {
      ok: true,
      mp4: outPath,
      audio: audio || null,
      subs: subs || null,
      burn: Boolean(args.burn),
    },
    null,
    2
  )
);
