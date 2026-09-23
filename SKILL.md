---
name: reel
description: "把可 seek(t) 的 HTML/CSS/JS/SVG 变成 MP4：当前模型自己写页面、截帧、看抽帧、改。有配音时先定稿文案 → TTS → 量时长排时间轴 → 再画，禁止按字数估时先画再套 TTS。适用于讲解片、流程/架构动起来、按期数据折线、动态字幕、UI 演示。风格由内容自选。产物写当前工作区 reel-out/，不要写进技能目录。不要用于写实影视，也不要只出一张静图。出片本身不要外包给外部代理；查资料可用子代理。"
---

# Reel — 视觉模型出片

**你就是生成器**：自己写 HTML、自己截帧、自己看抽帧、自己改，不要把出片整个交给别的 agent。查资料、找数字可以用子代理。

把可 `seek(t)` 的网页变成 MP4。运动必须能按 `t` 精确 seek；禁止墙钟 `Date.now()` / 无时钟 rAF。

技能目录只读。产物一律写 **`$PWD/reel-out/`**，不要写进技能目录。

## 何时用

要视频/动画成片、把概念/流程/架构动起来、数据按期长出来时用。盒子和箭头可以，但要按时间出现、连线、高亮。

不用：只要一张与成片无关的静图；写实 / 人物 / 电影感。成片自带的封面不算「只要静图」。

## 产物

```
reel-out/knowledge.md          短索引：主题、调研、风格、分点目录、分段、承接、全片进度
reel-out/knowledge/01-*.md     分点资料（事实、来源）；script-part-NN.md 台词稿
reel-out/part-01.timeline.json 该段实测时间轴（t 从 0 起）
reel-out/part-01.srt           该段字幕（kit 注入，不要写进 HTML）
reel-out/tts/                  逐句音频
reel-out/gbar.json             全片进度条章节（可选）
reel-out/part-01.html / .mp4 / part-01-qa/
reel-out/scene.mp4             画面 concat
reel-out/scene-vo.mp4          混流成片
reel-out/cover-16x9.html/.png  16:9 封面（如 B 站）
reel-out/cover-3x4.html/.png   3:4 封面（如抖音）
```

中间文件（抽帧、临时音频、日志）也放 `reel-out/`。不要依赖 `/tmp`：每次 bash 调用的 `/tmp` 可能是独立的，下一条命令就找不到。

## 闭环

1. 开面板（默认 8766，用 `/api/progress` 探测）：
   ```bash
   OUT="$PWD/reel-out"; mkdir -p "$OUT"
   if ! curl -sf -o /dev/null http://127.0.0.1:8766/api/progress; then
     setsid node <技能目录>/tools/panel.mjs --dir "$OUT" --port 8766 --open \
       >"$OUT/panel.log" 2>&1 < /dev/null &
     sleep 0.6
   fi
   ls <技能目录>/tools/
   ```
   出片用 `capture.mjs` / `concat.mjs` / `subs.mjs` / `mux.mjs`。不要假设一定有搜索或 TTS 脚本。
2. 读 [prompt/generation.md](prompt/generation.md)。风格按题材选，写进 knowledge.md，不要抄 examples 的配色。**有口播就还不能画。**
3. 调研：先摸清主题有哪些维度、有没有可用数据/口径、大概能讲什么。结论写进 `knowledge.md` 顶部（短）。
4. 分点：按调研结果列大纲，定分段与承接，写进 `knowledge.md`。
5. 按分点搜资料。`knowledge.md` 只当短索引；每个分点的资料写 `knowledge/01-*.md`。搜索可用子代理（若可用）：一个分点一个任务，资料由子代理直接落文件，只回传结论和路径，不要囤 SERP。下一段先读索引 + 本段用到的分点文件。
6. 数字/术语先搜再写，不要用训练记忆编造。搜不到就写「未披露」。
7. 写台词稿（能念的句子，按镜头/意群，不要一条一个标语）。冻结后才 TTS。冻结后再改一句，从那句起按后续全片重建估，不要按「改一句」估。
8. 有配音：TTS → `ffprobe` 量时长 → 排该段 `timeline.json` → 生成 `part-NN.srt` → 再画。禁止按字数÷语速估时先画再套配音。
   - 环境里没有 TTS：问用户要音频/命令，或改无配音，不要默默估时。
   - 降级必须显眼：某句换音色/合成失败，不能只在 stderr 打一行就算成功——文件名要标出、结束汇总「本次 N 句降级」、必要时非零退出。
   - 句间用全片同一固定间隙。`REEL.duration` 与画面 delay 抄 timeline，不要另算。
   - 字幕用 `subs.mjs` 生成该段 `part-NN.srt`，且必须早于该段 MP4。不要写进 HTML，不要 libass 另烧一套字。没有该段 srt 时不要拿全片 `captions.srt` 充数（时基不同，后段会显示前段台词）。
   - 时长不限。拆不拆段、在哪拆由你定（写进 knowledge.md）。
9. 时间轴定了再写 `part-01.html`（单段可叫 `scene.html`）。数字用字面量数组。后段抄 knowledge 的皮和上一段结束态。认输入用完整文件名，不要把 draft、备份扫进正片，并回显读到了哪些文件。
10. 先探针再全量：`capture.mjs part-01.html --probe --qa-dir part-01-probe`，读图 + `probe.json`。只看某一秒用 `--at 20.5`。
11. 全量导出，单段也打满核：`--jobs $(nproc)`（上限 8）。导出后读 `qa-*.png` + `qa.json`。这一段画面不对，只改这一段再导，最多 3 轮。总时长、章节、字幕或 `gbar.json` 变了，烧进画面的段都要重导。画面互不依赖、且这些全局量已定的段可以同时导出。
12. 多段 concat，再 `mux.mjs` 混音（不要 `--burn`）。配音在这一步收成单声道，并归一到 -18.7 LUFS、真峰值 -1.5 dBTP。不要把单声道复制成左右声道后再交付。真立体声才加 `--keep-stereo`。
13. 成片抽帧终检（不可省，含各段衔接点）：接缝、gbar 是否连续、字幕、末帧。
14. 封面两张，和成片同一套皮，各自重排，不要把 16:9 裁成 3:4。
    - `cover-16x9.html`：1920×1080。`cover-3x4.html`：1080×1440。
    - 静帧：`REEL.duration` 取 1，`reelDraw(0)` 就是完整封面。不放进度条、字幕、时长。
    - 两张分开截，避免互相覆盖：`--at 0 --qa-dir reel-out/cover-16x9` 与 `--qa-dir reel-out/cover-3x4`。把 `at-00-0_00s.png` 交付成 `cover-16x9.png` / `cover-3x4.png`，不要导成片。
15. 交付成片路径、封面路径、分段、口径、成片抽帧结论。

## 契约

输出**一个**自包含 HTML：

1. `window.REEL = { duration, fps, width, height, offset? }`。有配音时 `duration` 抄 timeline 末句 + ~0.4s；宽高偶数。`offset` 是写进页面的字面量，等于前面各段时长之和；前面变了，后面的 HTML 和 MP4 一起过期。
2. 画面在 `.stage`，尺寸 = width×height，不用 `vw/vh`。`width/height` 就是成片像素，没有倍率；`.stage` 必须等于它。模板里的 1280×720 只是默认画布。文件名不影响分辨率。`--width` / `--height` 只改视口，不会把舞台放大。
3. 运动只能来自 CSS/WAAPI（`fill: both`，禁 `infinite`）、`reelDraw(t)`、`reelSeek(t)`。口播走 srt；进度条走 `gbar.json` + `REEL.offset`（要么不用），不要手画，不要 `REEL.chapters`。
4. 禁 `Date.now()` / `performance.now()` / 无时钟 rAF。rAF 只读 `window.__reelTime`。
5. 系统字体；不要外链字体 / `<video>` / 随机数当主运动。
6. 不要把技能目录、`scratch/`、`examples/` 当输出路径。

样例只抄契约：[examples/contract.html](examples/contract.html)。不要抄它的样子。

## 抽帧怎么判

| 看什么 | 失败就改 |
|---|---|
| 首帧是空舞台或完整壳，不是散件 | 壳内元素必须是壳的子节点，跟壳一起出现 |
| 数字/条/游标同一时刻一致 | 只在 `reelDraw(t)` 算一次进度，别 CSS 动条、JS 动数字 |
| 同一元素同一帧只写一次 | 多段区间打同一个元素时先逐帧取极值再写一次；顺序赋值会盖掉前面的区间 |
| 口播和画面同一意群 | 换句不必换图；换图时口播已讲到这一层 |
| 字幕在画面里且和面板一致 | 默认贴 `#gbar` 上方一行、无底；颜色和字号用 `--reel-caption-fg` / `--reel-caption-size`。不要自造第二套字幕 |
| 多段 concat 后底栏连续 | 不建 `gbar.json` 就是关。要用就 `gbar.json` + `REEL.offset`，不要手画。颜色只用 `--reel-gbar-fill/track/fg/fg-on`；浅色填充必须另设 `fg-on`，字要看得见。条高固定 36px |
| 有配音时时间来自实测 | delay / 章节点等于 timeline，禁止字数÷语速 |
| 下一段开头看得出延续 | 同一元素、构图或配色；不要每段换一套无关联的皮。承接不是半透明残影叠字，旧层要淡到看不见 |
| 不是实测的数要标明 | 示意、预测、口径不明写出来，不要装成已核实的数 |
| 数值到终点文案已是结束态 | 不要 100% 还写 LOADING |
| 没有竖线扫光被看成分割线 | 删 sweep/scan，用进度本身 |
| 末帧是结束态，不是闪回第 0 帧 | 去 infinite，补 both/forwards |
| 风格像又一份深色仪表盘但题材不是 | 换配色排版，不要套示例页 |

同一 `t` 截两次应一样。改 HTML，不要手调 PNG。

## 路由

- 默认本技能；流程/架构讲解做成会动的片。
- 只要一张静态流程图/架构图：不要用本技能出 MP4。
- 数学证明逐步变换：Manim。
- 写实 / 人物 / 电影感：拒绝。
