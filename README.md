# reel-skill

> 把可 `seek(t)` 的 HTML/CSS/JS/SVG 逐帧截成 MP4 的 Agent Skill。

给 Agent 的一套出片流程：从选题到成片，每一步都有规范，主模型照着走。

## 它做什么

- **输入**：一段能按 `t` 精确 seek 的网页（HTML/CSS/JS/SVG）。
- **输出**：MP4，可带配音、字幕、全片进度条。
- **谁在干活**：调用本技能的主模型自己写页面、自己截帧、自己看抽帧、自己改。控制面板只预览磁盘上的场景和导出进度，不调用模型。

## 流程（核心）

```
调研 → 分点 → 收集资料 → 文案定稿 → TTS → 量时长排时间轴 → 写 HTML → 探针 → 截帧 → concat / 混流 → 终检
```

| 步骤 | 做什么 | 为什么 |
|---|---|---|
| 1 调研 | 先摸清主题有哪些维度、有没有可用数据 | 不知道有什么可讲，分点就是拍脑袋 |
| 2 分点 | 按调研结果列大纲 | 避免边写边想 |
| 3 收集资料 | 一个分点一个任务，落 `knowledge/` 分点文件 | 不把搜索结果堆进上下文 |
| 4 文案定稿 | 写成能念的口播 | TTS 和字幕都念这一份 |
| 5 TTS | 逐句合成 | |
| 6 量时长排时间轴 | `ffprobe` 实测，写 timeline / srt | 同一句 17 字可能是 3.2s 也可能是 4.7s，估时必翻车 |
| 7 写 HTML | 可 seek 的页面，时间抄 timeline | |
| 8 探针 | 关键节点静帧 | 全量几百帧前先看叠字、裁切、残影 |
| 9 截帧 | 浏览器 CDP + ffmpeg，单段也打满核 | |
| 10 concat / 混流 | 合并画面 + 混音 | 字幕已经在画面里 |
| 11 终检 | 成片抽帧，含各段衔接点 | 接缝、进度条连续、末帧 |

**有配音时顺序不可颠倒**：先定稿文案 → TTS → 量时长 → 再画。先按字数估时画出、再拿 TTS 去套，会导致句间空白不均，被迫整片重排、重导几千帧。

## 安装

Agent Skills 标准格式（`SKILL.md` + frontmatter），放进任一技能目录即可：

| 工具 | 目录 |
|---|---|
| pi | `~/.pi/agent/skills/` 或 `.pi/skills/` |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| 通用 | `~/.agents/skills/` |

```bash
git clone git@github.com:AlexMeiko/reel-skill.git ~/.pi/agent/skills/reel-skill
```

## 依赖

- Node 18+（用内置 WebSocket，无 npm 依赖）
- ffmpeg
- 带 DevTools 协议的 Chromium 内核浏览器（Chrome / Chromium / Edge）

## 用法

控制面板（预览舞台、拖时间轴、看导出进度）：

```bash
node tools/panel.mjs --dir "$PWD/reel-out" --port 8766
```

出片：

```bash
# 关键节点探针，不出 MP4
node tools/capture.mjs "$PWD/reel-out/part-01.html" --probe --qa-dir "$PWD/reel-out/part-01-probe"

# 全量导出，单段也打满核
JOBS=$(nproc); [ "$JOBS" -gt 8 ] && JOBS=8
node tools/capture.mjs "$PWD/reel-out/part-01.html" \
  --out "$PWD/reel-out/part-01.mp4" \
  --qa-dir "$PWD/reel-out/part-01-qa" --jobs "$JOBS"

# 只看某一秒
node tools/capture.mjs "$PWD/reel-out/part-01.html" --at 20.5 --qa-dir "$PWD/reel-out/part-01-shots"

# 字幕、合并、混音
node tools/subs.mjs reel-out/part-01.timeline.json --out reel-out/part-01.srt
node tools/concat.mjs reel-out/part-01.mp4 reel-out/part-02.mp4 --out reel-out/scene.mp4
node tools/mux.mjs --video reel-out/scene.mp4 --audio reel-out/voice.wav --out reel-out/scene-vo.mp4
# voice.wav = 整轨配音：逐句音频按 timeline 拼成，或外部给的录音

# 成片终检：含各段衔接点
node tools/capture.mjs --from-mp4 reel-out/scene.mp4 --qa-dir reel-out/scene-qa --qa-at 0,19.5,40
```

容器 / root 下浏览器起不来时，`capture.mjs` 会自动加 `--no-sandbox --disable-dev-shm-usage`；也可手动 `--no-sandbox` 或 `REEL_CHROME_FLAGS`。

## 产物

成片和中间文件都写在**当前工作区** `reel-out/`，不写进技能目录：

```
reel-out/knowledge.md          短索引：主题、调研、风格、分点、分段、承接
reel-out/knowledge/01-*.md     分点资料；script-part-NN.md 台词稿
reel-out/part-01.timeline.json 该段实测时间轴
reel-out/part-01.srt           该段字幕
reel-out/tts/                  逐句音频
reel-out/part-01.html / .mp4 / part-01-qa/
reel-out/scene.mp4             画面 concat
reel-out/scene-vo.mp4          混流成片
reel-out/cover-16x9.png        16:9 封面（如 B 站，1920×1080）
reel-out/cover-3x4.png         3:4 封面（如抖音，1080×1440）
```

## 文档

- `SKILL.md` — 工作流与契约（模型加载的入口）
- `prompt/generation.md` — HTML / `window.REEL` / 时间写法
- `runtime/` — seek 与 kit（字幕、进度条注入）
- `tools/` — capture / concat / mux / subs / panel
- `examples/` — 契约样例，只抄结构不抄皮肤

## 不是什么

- 不是 AI 生成像素的视频（写实 / 人物 / 电影感不做）。
- 不是静态流程图工具：只要一张与成片无关的静图，别用这个。成片封面是两张静帧（16:9 与 3:4），算在交付里。
- 运动全部来自 `seek(t)`，同一 `t` 截两次必须一样；禁止墙钟 `Date.now()` / 无时钟 rAF。
