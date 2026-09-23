# Reel 生成规范

每段输出**一个完整 HTML 文档**，不要 markdown 围栏，不要解释。写入当前工作区 `reel-out/part-NN.html`（单段可用 `scene.html`），不要写进技能目录。有口播时先定稿台词 → TTS → 量时长 → 再写本文件。

## 骨架

宽高、时长写在 `window.REEL`；画面只放进 `.stage`。底色是占位，按题材换掉。

```html
<!doctype html>
<html lang="zh-CN"><!-- lang 按片子语言；这里只是中文示例 -->
<head>
  <meta charset="utf-8" />
  <script>
    window.REEL = {
      duration: 8,
      fps: 30,
      width: 1280,
      height: 720
      // offset：全片进度条用；口播写 sidecar srt；不要手画底栏
    };
  </script>
  <style>
    html, body { margin: 0; }
    .stage {
      position: relative;
      width: 1280px;
      height: 720px;
      overflow: hidden;
      font-family: system-ui, sans-serif; /* 需要中文时再加本机有的中文字体，不要外链 */
    }
  </style>
</head>
<body>
  <div class="stage"><!-- 所有可见元素 --></div>
  <script>
    function reelDraw(t) {
      // t 秒，[0, REEL.duration]
    }
  </script>
</body>
</html>
```

样例只抄契约：[contract.html](../examples/contract.html)。不要抄它的样子。

## 风格（你选，技能不指定）

视觉由内容决定，不要默认深色仪表盘或黑底紫光。题材可往哪靠（举例，非清单）：

| 题材 | 可以往哪靠 |
|---|---|
| 财报 / 数据 | 浅纸感编辑风、冷静浅灰；深色若对比够也行 |
| 概念 / 流程 / 架构 | 白板、纸、教材插图、轻示意图 |
| 产品 / UI | 跟产品界面接近 |
| 活动 / 情绪 | 大胆色块、大字报、胶片感，只要对比够 |

硬约束只有可读性：

- 底字要有对比；不要纯黑配纯灰、浅灰配浅灰。
- 同一时刻 ≤ 3 个信息点；主标题 ≤ 一行。
- 安全边距 ≥ 64px。口播默认贴 `#gbar` 上方一行、无底，不要为字幕空出一大截；`--reel-caption-bottom` 约 40px。颜色、字号用 `--reel-caption-fg` / `--reel-caption-size`。底、圆角、内边距默认不用；题材确实要托底时才用 `--reel-caption-bg` / `--reel-caption-radius` / `--reel-caption-pad`。不要自造第二套字幕。
- 不要 emoji 当主视觉；不要外链字体 / `<video>`。
- **禁止**把 `examples/` 的配色、字号、装饰当模板填空。

贴合皮肤只改变量：

```css
.stage {
  --reel-caption-size: 20px;
  --reel-caption-fg: currentColor;
  /* 默认不加底。要托底再设 --reel-caption-bg / radius / pad */
  --reel-bar-fill: currentColor;
}
```

## 台词稿与字幕

口播先写台词稿；TTS 量时写入该段 `part-01.timeline.json`（本地 t，从 0 起），再生成 srt：

```bash
node tools/subs.mjs reel-out/part-01.timeline.json --out reel-out/part-01.srt
```

句子**不要**写进 HTML。面板和截帧读 `part-01.srt`（或 `.timeline.json` / `captions.srt` / `timeline.json`）注入 kit，预览即成片。改词改 sidecar → 看面板 → 再截该段。字幕颜色、字号用 kit 变量；不要自己另放一套 `#reel-caption`。TTS、字幕、台词稿必须同一句。画面按镜头/意群切，不按句切。

## 全片进度条

要么不要条，要么用 kit 这条（满宽底栏、章名在格子里、填充从左往右）。不写 `reel-out/gbar.json` 就是关闭，不必再加开关。**不要手画**细线、竖标、飘字。

全片一份 `reel-out/gbar.json`，各段只写本段 `offset`（前面各段时长之和）。填充 `(offset + t) / total`，concat 后连续。

```json
{
  "total": 180,
  "chapters": [
    { "title": "开场", "t": [0, 14] },
    { "title": "过程", "t": [14, 90] },
    { "title": "收束", "t": [90, 180] }
  ]
}
```

```js
window.REEL = { duration: 22, fps: 30, width: 1280, height: 720, offset: 52.1 };
```

颜色可换，布局不要改：`--reel-gbar-fill` / `--reel-gbar-track` / `--reel-gbar-fg` / `--reel-gbar-fg-on`。条高默认是画面高度的 5%（`--reel-gbar-h`），字号默认是条高的一半（`--reel-gbar-fs`），换分辨率同比缩放。填充改成浅色时必须同时设 `--reel-gbar-fg-on`，盖住的字才会看得见。不要自动配色。

## 时间怎么写

把片子想成一条 0→duration 的轴；有配音时轴来自 timeline，每一镜头只做一件视觉事。

| 手段 | 用来 | 写法 |
|---|---|---|
| CSS `@keyframes` | 淡入、位移、缩放、画线 | `animation: name 800ms 200ms both` |
| WAAPI `el.animate(...)` | 同上，按 id 控制 | `{ duration, delay, fill: 'both', easing }` |
| `reelDraw(t)` | 计数、进度、canvas、折线、对齐 | 用 `t` 算值，不要累加器 |

**画线**：`stroke-dasharray: <len>` + `stroke-dashoffset` 从 len 到 0。  
**计数/进度条/游标**：必须在 `reelDraw(t)` 里用**同一次**插值更新，禁止 CSS `scaleX` 一条、JS 数字另一条。  
**运镜**：`.stage` 内一层 `.world` 做 `transform`，不要改 width/height。  
**结构**：看起来在卡片/窗口里的内容，必须是该容器的 DOM 子节点，不要在 `.stage` 上绝对定位叠上去。

`reelDraw` 里可用（kit 注入后存在）：`reel.span(t,t0,t1)`、`reel.lerp`、`reel.clamp`、`reel.easeOut` / `reel.easeInOut`、`reel.captionAt(t)`。

禁止：

- `infinite`（含 `animation: foo 1s infinite`）
- `transition` 当主时间轴
- `setInterval` / `Date.now()` / `performance.now()` 驱动运动
- rAF 用墙钟；必须 rAF 时只读 `window.__reelTime`
- 随机数参与主运动
- 数值到终点文案还是进行态（100% 配 LOADING）

扫光/扫描线被看成分割线，或只是与内容无关的装饰时，删掉。不要因此禁止所有扫光。

## 片型

### 短指标 / UI 演示（4–8 秒）

0.0–0.4s 空镜或完整静态壳，避免首帧就是高潮；主体一段；最后 0.4s 静止结束帧。

### 数据折线（按季 / 按月）

- 点序列放 `reelDraw` 旁的字面量数组 `{ label, value }`。
- SVG `polyline`/`path`，在 `reelDraw(t)` 里按进度截断，并同步当前点高亮、大数字、期别。不要 Chart.js 自带动画。
- 前 0.6s 画轴与标题；每点约 1.0–1.2s；最后 1.2s 静止 + 来源。`duration = n×1.1 + 3`（节奏参考，不是封顶）。
- 折线端点、大数字、期别同一时刻必须是同一 index。
- 角落一行口径；Y 轴从 0 或略低于最小值，不要截轴造假陡坡。
- 12 个点不要 12 行图例，只高亮当前点。
- 只披露季度就按季度，禁止拆成假月度。

### 概念 / 流程 / 架构讲解

- `duration` 抄 timeline 末句出点 + 结束静帧；时长不限，拆不拆段自己定。
- 台词稿定稿后 TTS 量时再出 srt，不要抄进 HTML。用语像对人讲话：有主语、有停顿、有「所以 / 也就是说」。
- 用 SVG / DOM 示意图，不要把解说全文堆在画面中央。
- 底栏用 kit + `gbar.json`，不要手画。
- 承接：下一段开头沿用上一段结束态（同一元素、构图或配色），不要每段换一套无关联的皮。

### 封面

成片再出两张静帧，皮与正片相同，版式按比例重排（不要裁正片画面）。

| 用途 | 文件 | 像素 |
|---|---|---|
| 16:9（如 B 站） | `cover-16x9.html` | 1920×1080 |
| 3:4（如抖音） | `cover-3x4.html` | 1080×1440 |

`REEL.duration` 取 1，`reelDraw(0)` 画出完整封面。不放进度条、字幕、时长。用 `capture.mjs --at 0` 出 PNG。

## 自检（写完过一遍）

- 有 `window.REEL`，宽高与 `.stage` 一致且为偶数
- CSS 动画带 `both`、有限次、delay+duration 落在 `duration` 内
- 数字/条/游标走同一次 `reelDraw(t)`；壳内元素是壳的子节点
- t=0 要么全空，要么完整静态壳（折线必须还没长出来）
- 字幕在 sidecar，面板/截帧注入 kit，不要写进 HTML
- 换句不必换图；换图时口播已讲到这一层
- 无外链字体、无 `<video>`、无 `infinite`
- 配色不是从 examples 抄的
- 多段时每段 HTML 的底/字/强调色与 knowledge.md 一致
- 封面是 1920×1080 与 1080×1440 两张 PNG，无进度条、字幕、时长
