#!/usr/bin/env node
/**
 * 反例实验室 —— 用实测证明「哪些禁用写法真的会破坏 seek 确定性」。
 *
 * 对每个 aN-*.html：同一批 t 截两遍，逐字节比对。
 * 抽帧和 evidence.json 写到 $PWD/reel-out/anti-patterns/，不要写进技能目录。
 * 结论已经写在 README.md。
 *
 * 用法: node run.mjs [--only a1,a4]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = resolve(HERE, "..", "..", "..", "tools", "capture.mjs");
const OUT = resolve(process.cwd(), "reel-out", "anti-patterns");
const TIMES = "0.0,1.0,2.0,3.0,3.9";
mkdirSync(OUT, { recursive: true });

const only = (() => {
  const i = process.argv.indexOf("--only");
  return i > 0 ? process.argv[i + 1].split(",") : null;
})();

const files = readdirSync(HERE).filter((f) => /^a\d+-.*\.html$/.test(f)).sort()
  .filter((f) => !only || only.some((k) => f.startsWith(k)));

function shoot(html, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(process.execPath,
    [CAPTURE, html, "--at", TIMES, "--qa-dir", outDir, "--jobs", "1"],
    { cwd: HERE, encoding: "utf8", timeout: 300000 });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || "").slice(-400) };
  return { files: readdirSync(outDir).filter((f) => f.startsWith("at-") && f.endsWith(".png")).sort() };
}
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const report = [];
for (const f of files) {
  const a = join(OUT, ".run-a"), b = join(OUT, ".run-b");
  const r1 = shoot(f, a), r2 = shoot(f, b);
  if (r1.error || r2.error) {
    report.push({ file: f, verdict: "ERROR", detail: r1.error || r2.error });
    console.log(`[ERROR] ${f}\n${r1.error || r2.error}`);
    continue;
  }
  const perT = [];
  let same = 0;
  for (let i = 0; i < r1.files.length; i++) {
    const eq = sha(join(a, r1.files[i])) === sha(join(b, r2.files[i]));
    if (eq) same++;
    perT.push({ t: r1.files[i].replace(/^at-\d+-|s\.png$/g, ""), equal: eq });
  }
  const verdict = same === r1.files.length ? "DETERMINISTIC" : "NON-DETERMINISTIC";
  report.push({ file: f, verdict, same, total: r1.files.length, perT });
  console.log(`[${verdict}] ${f}  (${same}/${r1.files.length} 采样点两次一致)  ` +
    perT.map((p) => `${p.t}${p.equal ? "=" : "!"}`).join(" "));
}
// 保留最后一组的 b 目录作为证据（其余清掉）
rmSync(join(OUT, ".run-a"), { recursive: true, force: true });
rmSync(join(OUT, ".run-b"), { recursive: true, force: true });
const evidence = join(OUT, "evidence.json");
writeFileSync(evidence, JSON.stringify({ times: TIMES, report }, null, 2));
console.log("\n-> " + evidence);
