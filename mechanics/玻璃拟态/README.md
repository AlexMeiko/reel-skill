# 特效 11 · 玻璃拟态 / 背景模糊（glassmorphism）

> ⚠️ **本目录已于 2026-09-24 精简**：`variants/`、`qa/`、`probe/`、`evidence/`、`table/` 已按使用者决定删除，
> 现只保留 `index.html` + `README.md`；成片与过程产物不入库，需要时用 `capture.mjs` 从 `index.html` 重导。
> **下文提到的备选实现、取证帧与复现命令已不在磁盘上**，但**结论与实测数字仍然有效**
> （它们本来就是为了支撑这些结论才做的）。本库入口见 [`../INDEX.md`](../INDEX.md)。


> **一句话**：一块毛玻璃卡片浮在一条横向滚动的「视频测试卡」上方 ——
> 卡片外每一根 1px 色条分隔线、6px 横向细纹、11px 标签都锐利可数；
> 卡片覆盖处这些高频细节被**实时**糊成一片柔和的色浆，卡片内文字依旧清晰。
> 相机连同背景按景深轻微平移，测试卡从右往左匀速滑过玻璃。
>
> 全片 1280×720 / 30fps / **5.0s / 150 帧**。画面 = f(t)，没有任何跨帧状态。

**本特效交付价值的一半是一个实测结论：`backdrop-filter` 在本机 headless Chromium
的 CDP 截帧路径下【生效】。** 证据见 §5 与 `evidence/measurements.md`。

## 交付物

| 文件 | 说明 |
|---|---|
| `index.html` / `out.mp4` | **主方案**：真 `backdrop-filter: blur(22px) saturate(1.7)` |
| `variants/variant-a.html` / `variant-a.mp4` | 逃生方案 A：背景子树复制一份 + CSS `filter: blur()` + `clip-path: inset(… round 26px)` |
| `variants/variant-b.html` / `variant-b.mp4` | 逃生方案 B：同一个副本走 SVG `<feGaussianBlur>` + `<clipPath>` |
| `qa/`、`variants/qa-a/`、`variants/qa-b/` | 三条片子的成片抽帧 |
| `sheet.png` | 主方案 15 格 contact sheet（当时从成片抽的） |
| `variants/sheet-a.png`、`variants/sheet-b.png` | 两个备选方案的 15 格 contact sheet |
| `probe/` | 全部实测证据：backdrop-filter 探针与阴性对照、SVG 滤镜探针、像素统计脚本、定点静帧 |
| `evidence/measurements.md` | 上面所有数字的表格式汇总（含复现命令） |

---

## 1. 常见写法为什么在本 skill 里会坏

| 常见写法 | 坏在哪 | 本库的 seekable 改法 |
|---|---|---|
| `animation: drift 8s infinite` 让背景一直飘 | ① 契约禁 `infinite`；② **无限循环的相位取决于「页面被墙钟推了多久」**，与 `t` 无关 —— 同一 `t` 截两次相位不同，确定性检查必挂 | 色斑位置写成**闭式椭圆轨道**：`x = cx + rx·cos(w·t + φ)`。`t` 一给，位置唯一确定；`t` 从 0 起就在流动，首帧仍是完整静态壳（SPEC 明确要求「背景在流动」） |
| 测试卡滚动用 `el.style.transform = "translateX(" + (off -= v*dt) + "px)"` | 累加器。`off` 取决于「这一帧之前被 seek 过几次」，seek 到 t=3.0 得到的是巧合值 | **取模的循环相位**：`off = OFF_MAX * easeInOut(span(t, T0, T1))`，`translateX(-(off % PERIOD))`。零状态 |
| 卡片位移/数字/进度条各写一套 CSS `@keyframes` + `animation-delay` | 三条独立时间线。改总时长要手改所有 delay；`prog` 一缓动，数字和条立刻错开 | **单一真值 `off`**：数字、位移条宽度、条头游标、状态文案（`READY/SCROLL/SETTLED`）全部由**同一次** `easeInOut(span(...))` 算出，见 §3.2 |
| `transition: backdrop-filter .3s` 做「玻璃渐显」 | `transition` 是墙钟补间，seek 不会等它跑完 → 画面滞后于 `t`（`_shared/anti-patterns/a5`） | 不用。要动模糊半径就在 `reelDraw` 里直接写 `el.style.backdropFilter` |
| 每帧 `el.textContent = Math.round(off) + " px"` | **PATTERNS §6.1 实测坑**：Chromium 对字形栅格化有缓存，每帧改 DOM 文本会让同一段文字在不同帧走不同栅格化路径，末位差 1 个灰阶 —— 只在系统高负载时偶发，当时的机器验收 报「t=x 两次截帧不一致，maxdelta=1/255」 | 本片**会变的文字一律画进 `<canvas>`**（`ctx.fillText`）。DOM 里只剩静态文字，全片 0 处每帧 DOM 文本写入 |
| `Math.round(prog*100)` 当完成判定 | `Math.round(0.996*100) === 100` → 条还没满、数字已经到终点 | 未达成时把显示量夹到 `OFF_MAX - 1.5`（`Math.round` 后最多 447），`done` 时才写 448。见 §3.2 |
| 用 `t / REEL.duration` 当进度分母 | 末帧是 `(帧数-1)/fps`，永远差 `1/30` 秒 → 永远停在 99% | **字面量结束时刻** `T_S1 = 4.55`：`easeInOut(span(t, 0.45, 4.55))`，`t ≥ 4.55` 时精确为 1（场景内仪表自洽） |
| 卡片内文字直接压在忙碌的模糊背景上 | 毛玻璃后的背景是**中灰偏亮**的色浆，白字对比度不够（实测约 4.4:1） | 卡片自己带一层极淡的**纵向渐变`+`深色基色**（`rgba(12,18,40,.20)` + 上白下深的 `linear-gradient`），既保住玻璃质感，又把读数区的对比度拉到 9:1 以上；所有卡片文字再叠 `text-shadow: 0 1px 7px rgba(0,0,0,.5)` |
| 模糊一个「纯渐变」背景来演示毛玻璃 | 22px 的模糊作用在本来就平滑的渐变上**根本看不出差别** —— 这是这个特效最容易翻车的地方 | 背景必须自带高频：**13px 周期的 1px 同心细环 + 7px 节距点阵 + 34px 色条（带 1px 分隔线和 6px 横纹、11px 标签）**。四层高频叠在一起，模糊才有东西可糊 |
| 卡片内塞满五行读数 | 同一时刻 ≤ 3 个信息点 | 卡片只留三个信息点：① kicker + 标题 ② 两行材质参数 ③ 一行「背景位移」仪表 |

---

## 2. 时间轴设计

| 段 | 时间 | 做什么 | 谁来动 |
|---|---|---|---|
| **起手** | 0.00–0.45 | 完整静态壳：卡片已在位、读数 `READY / 0 px / 空条`；**背景色斑已在缓慢流动**（SPEC 要求首帧背景在流动） | 色斑轨道（`t` 从 0 起） |
| **主体** | 0.45–3.40 | 测试卡加速滑过玻璃（`easeInOut` 的加速半段）；相机按景深平移；色斑继续游走 | `off` + `cam` |
| **收束** | 3.40–4.55 | 测试卡减速停稳（`easeInOut` 的减速半段）；读数向 448px 收敛 | `off` + `cam` |
| **定格** | 4.55–5.00 | 结束态：`SETTLED` / `448 px` / 满条；只有色斑还在极慢地动 | 色斑轨道 |

`easeInOut` 的一条曲线同时承担「加速主体」和「减速收束」：速度在两端为 0，
中间最快，所以进度**不是匀速一条线**（节奏三段）。

### 2.1 唯一相机

```js
var camX = reel.lerp(0, -26, e), camY = reel.lerp(0, 8, e);
layBlob.style.transform  = "translate(" + (camX * 0.30) + "px," + (camY * 0.30) + "px)";  // 远
layPat.style.transform   = "translate(" + (camX * 0.65) + "px," + (camY * 0.65) + "px)";  // 中
layStrip.style.transform = "translate(" + camX + "px," + camY + "px)";                     // 近
```
**一个 `cam` 值，三层按景深共用**（PATTERNS §3.3）。每层各写一套 keyframes 是失同步的根源。
背景各层统一超画 80px（`left:-80px; width:1440px`），运镜时不会在边缘露底。

---

## 3. 关键技术点

### 3.1 唯一的动画函数（`index.html` 主体）

```js
window.reelDraw = function (t) {
  /* 真值 1：滚动进度 e。位移 / 仪表 / 条宽 / 状态文案全部出自它 */
  var e   = reel.easeInOut(reel.span(t, T_S0, T_S1));   // T_S0=0.45, T_S1=4.55（字面量）
  var off = OFF_MAX * e;                                 // OFF_MAX = 448

  /* 唯一相机：一个值，三层按景深共用 */
  var camX = reel.lerp(0, -26, e), camY = reel.lerp(0, 8, e);
  ... 三层各写一次 transform ...

  /* 测试卡滚动：取模，不是累加器 */
  stripEl.style.transform = "translateX(" + (-(off % PERIOD)).toFixed(3) + "px)";

  /* 色斑：闭式椭圆轨道，t 从 0 就在流动 */
  for (var k = 0; k < BLOBS.length; k++) {
    var b = BLOBS[k];
    var x = b.cx + b.rx * Math.cos(b.w * t + b.ph);
    var y = b.cy + b.ry * Math.sin(b.w * 1.27 * t + b.ph);
    blobEls[k].style.transform = "translate(" + (x - b.r) + "px," + (y - b.r) + "px)";
  }
  ... 画 canvas 仪表 ...
};
```

整片**没有任何 CSS `@keyframes`、没有 WAAPI、没有 `transition`、没有 `requestAnimationFrame`**。
`verify` 的 lint 因此输出「无 CSS animation（全部走 reelDraw/WAAPI）」。

### 3.2 场景内仪表自洽：文案 + 数字 + 条同源

```js
var done  = off >= OFF_MAX - 1e-6;
var phase = t < T_S0 ? "READY" : (done ? "SETTLED" : "SCROLL");
var shown = done ? OFF_MAX : Math.min(off, OFF_MAX - 1.5);   // 未达成时不许显示终点值(§6.2)

ctx.fillText(phase, 0, 52);                                   // 左：状态文案
ctx.fillText(Math.round(shown) + " px", 1080, 52);            // 右：读数
var w = 1080 * (shown / OFF_MAX);                             // 下：位移条宽度
ctx.fillRect(0, 96, 1080, 8); ctx.fillRect(0, 96, w, 8);
```
一个 `off` 派生出全部三样。末尾：`phase = "SETTLED"`、`448 px`、条满 ——
**文案是结束态，数字到终点值，没有「100% 配 LOADING」**。
`T_S0`/`T_S1` 是全片**唯一**一组开始/结束时刻，没有第二处各算各的。

> 若将来把多个特效 concat 成整片，这个卡片内仪表应当改走 kit 的 `gbar.json` + `REEL.offset`，
> 否则会和 kit 的底栏读数打架。本片**不写 `gbar.json`、不写 srt、不加音轨**
> （`ffprobe` 确认三条 MP4 都只有一条 h264 视频流）。

### 3.3 高频背景：模糊必须有东西可糊

```css
.rings  { background-image: repeating-radial-gradient(circle at 720px 440px,
            rgba(255,255,255,.30) 0 1px, rgba(255,255,255,0) 1px 13px); }   /* 13px 细环 */
.dots   { background-image: radial-gradient(rgba(255,255,255,.30) 1.5px, rgba(255,255,255,0) 1.6px);
          background-size: 7px 7px; }                                          /* 7px 点阵 */
.bar    { border-right: 1px solid rgba(255,255,255,.70); opacity: .78; }       /* 1px 分隔线 */
.striplines { background-image: repeating-linear-gradient(0deg,
            rgba(255,255,255,.28) 0 1px, rgba(255,255,255,0) 1px 6px); }      /* 6px 横纹 */
```
`.bar { opacity: .78 }` 这一行是调出来的：色条若完全不透明，近黑的 4 条会把底下的色斑
全挡住，**毛玻璃里只剩一块死灰**，很难看。留 22% 透光后，卡片内部才是有颜色的流动色浆。

### 3.4 玻璃卡片本体

```css
.card {
  border-radius: 26px;
  background-color: rgba(12,18,40,.20);
  background-image: linear-gradient(180deg, rgba(255,255,255,.20) 0%,
                                    rgba(255,255,255,.03) 46%, rgba(4,8,20,.26) 100%);
  -webkit-backdrop-filter: blur(22px) saturate(1.7);
  backdrop-filter: blur(22px) saturate(1.7);
  border: 1px solid rgba(255,255,255,.36);
  box-shadow: 0 24px 60px rgba(0,0,0,.42), inset 0 2px 0 rgba(255,255,255,.10);
}
.card::before {           /* 1px 内高光 */
  content: ""; position: absolute; left: 20px; right: 20px; top: 0; height: 1px;
  background: linear-gradient(90deg, rgba(255,255,255,0),
              rgba(255,255,255,.92) 24%, rgba(255,255,255,.92) 76%, rgba(255,255,255,0));
}
/* 万一 backdrop-filter 不被支持：退成实底，保证文字可读（不允许灰底灰字） */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .card { background-image: none; background-color: rgba(10,16,38,.86); }
}
```

---

## 4. 方案对比

| | 主方案 `index.html` | variant-a | variant-b |
|---|---|---|---|
| **模糊机制** | `backdrop-filter: blur(22px) saturate(1.7)` | 背景子树复制一份 + `filter: blur(22px) saturate(1.7)` | 同一副本 + SVG `<feGaussianBlur stdDeviation="22">` + `<feColorMatrix saturate 1.7>` |
| **裁剪机制** | 不需要（`border-radius` 自动生效） | `clip-path: inset(210px 330px 190px 330px round 26px)` | `<clipPath clipPathUnits="userSpaceOnUse"><rect rx="26">` + `clip-path: url(#cardclip)` |
| **模糊对象** | **当场合成出来的 backdrop** | 你复制的那份副本 | 同左 |
| **卡片内像素（无文字区）** | 基准 | `meanAbs 0.34–0.45 / 255`（≈0.15%） | 与主方案统计量逐位相同（§5.3） |
| **背景 DOM** | ×1 | **×2**（且每处动画都要写给两个 root） | ×2 |
| **新增图层要做什么** | 什么都不用做 | **必须同时加进副本**，忘了就静默失败 | 同左 |
| **卡片位移时** | 免费跟随 | 必须每帧重算 `clip-path` | 同左 |
| **圆角** | 原生 | 依赖 `inset()` 的 `round` 语法 | `<rect rx>` 原生支持 |
| **性能** | 只模糊卡片区域，由合成器处理 | 每帧模糊**整张 1440×880 图层**（≈1.3× 全画面），再裁剪 | 同上，且 SVG 滤镜走另一条渲染路径 |
| **可读性 / 复用性** | 一行声明，任何人一看就懂 | 需要在注释里解释「为什么有两棵一模一样的背景树」 | 更绕：滤镜必须在 `sRGB` 空间、区域必须放大（§5.3 两个坑） |
| **本片 150 帧导出** | 实测边际 **3463 ms/帧** | 实测边际 **3045 ms/帧** | 实测边际 **2936 ms/帧** |

> **上表最后一行怎么量的、以及它的可信度**：同一台机器、同一时段、都走 `capture.mjs --jobs 1`，
> 每个方案测「1 帧」与「11 帧」两个点，取 `(t₁₁ − t₁)/10` 作为**边际单帧成本**（扣掉 Chromium 冷启动）。
> 本机只有 ~4GB 内存且有别的作业在跑，**单次测量噪声很大**，因此只看**量级与排序**：
> 三者的渲染成本是同一个量级（约 3 秒/帧），带 `backdrop-filter` 的主方案略慢一点。
> 真正的结构性代价不是这几百毫秒，而是上表的「背景 DOM ×2 / 每处动画写给两个 root / 新增图层要手动同步」。
> 绝对耗时主要被 CDP `Page.captureScreenshot` 的整屏截图路径吃掉，而不是被模糊本身吃掉
> —— 这也是三个数字彼此接近的原因。

### 推荐

**推荐主方案（真 `backdrop-filter`）**，理由：
1. **本机实测它生效**（§5.1，边缘能量塌 2363 倍），没有理由不用。
2. 语义正确：模糊的是当场合成结果，**将来往背景里加任何东西都自动被玻璃糊掉，零维护**；
   两个逃生方案都是「你记得复制什么就模糊什么」，漏一层就是静默失败。
3. 代码量最小、可读性最好，且没有 `filter` + `clip-path` + `border-radius` 三者的相互作用要操心。

**逃生方案什么时候用**：目标浏览器/渲染器不支持 `backdrop-filter` 时。
两个逃生方案里**优先 variant-a**（CSS 方案）：它和主方案在卡片内部像素上几乎不可分辨（§5.2），
且不引入 SVG 滤镜的 `linearRGB` / filter 区域两个坑。
**variant-b 只在必须用 SVG 滤镜管线时才选**，选它就必须同时设
`color-interpolation-filters="sRGB"` 并把 `<filter>` 区域放大，否则颜色和边缘都会错（§5.3）。

---

## 5. `backdrop-filter` 实测结论（本特效的必做实测）

> 完整数字与复现命令见 **`evidence/measurements.md`**。这里只给结论。

### 5.1 结论：**生效**（`blur()` 与 `saturate()` 都生效）

探针页 `probe/backdrop-probe.html`：20px 周期高频彩色棋盘上横排 4 块等大面板，
**x 间距 300px = 20px × 15，四块底下的背景逐像素相同**，可以直接互比。

| 面板 | luma 标准差 | **边缘能量 tv** |
|---|---|---|
| P1 裸背景（对照） | 78.93 | **35.779** |
| P2 玻璃色 · 无 `backdrop-filter` | 67.79 | **30.716** |
| P3 `blur(22px) saturate(1.7)` | **0.15** | **0.013** |
| P4 `blur(22px)` | 0.20 | **0.005** |

`P3/P2 = 0.0004` → **边缘能量塌了 2363 倍**。

**阴性对照**（`probe/backdrop-control.html`，唯一改动 = 删掉 `backdrop-filter` 声明）：
P2/P3/P4 的 tv = `30.716 / 30.716 / 30.715`，**逐位相同**。
→ 差异被证明来自 `backdrop-filter` 本身，而不是探针页里的别的因素。

saturate 也生效：P3（含 `saturate(1.7)`）R=177.1 B=148.9，P4（只 blur）R=173.0 B=156.0 —— 同一背景同一模糊，R↑B↓ 正是提饱和。

### 5.2 总结：**逃生方案与真 backdrop-filter 的视觉差异**

把主方案的 PNG 与 variant-a 的 PNG 逐像素对照（`probe/row-profile.mjs`）：

- **卡片以外**：`meanAbs 0.054 / 255`，`maxAbs 1`，`pct>2 = 0%` → 逐字节等价。
- **卡片以内、无文字区**（y=320..480）：`meanAbs 0.34–0.45 / 255` → **肉眼不可分辨**。
- **唯一系统性差异**：卡片边界约 10–20px 的一条带（顶边 210/220 差 5.0/3.2，底边 510/520 差 3.0/5.4）。
  原因是真 `backdrop-filter` 在元素边界处**截断对 backdrop 的采样**，
  而 `copy + blur + clip` 是先把整个背景模糊完再裁剪，边缘反而「更正确」。
  这一条带被卡片自己的 1px 边框与内高光盖住，实际看不出来。

**两者语义上的不同（这才是关键，不是像素）**：
- 真 `backdrop-filter` 模糊的是**实时合成结果** —— 卡片底下不管是什么（另一个动画元素、
  以后加的 canvas、别人维护的图层），都自动进入模糊，**不需要任何人记得它存在**。
- 「复制背景 + clip」模糊的是**静态副本** —— 只是「你复制的那一刻的那几层」。
  本页为了公平对照把全部背景层都复制了，代价是背景 DOM ×2 且**每处动画都要写给两个 root**；
  一旦有图层只加进真背景，卡片上就会出现「锐利的新图层叠在模糊的旧背景上」，而且**不报错**。

**附带结论：variant-a 与 variant-b 的像素完全相同。**
把两条成片的同一定点帧逐像素对照：

| 对照区 | main vs a | main vs b | **a vs b** |
|---|---|---|---|
| 卡片内无字区 `372,320,566,20` | 0.306 | 0.306 | **0.000**（maxAbs 0） |
| 卡片外 `40,240,240,260` | 0.016 | 0.016 | **0.000**（maxAbs 0） |

也就是说 **CSS `filter: blur(22px) saturate(1.7)` 与「SVG `feGaussianBlur stdDeviation="22"`
+ `feColorMatrix saturate 1.7`、且 `color-interpolation-filters="sRGB"`、filter 区域放大」
在本机渲染出的像素逐字节相同**（最大通道差 0）。两者只在卡片标题文字上不同，那是刻意写的不同文案。
→ SVG 滤镜不是「另一种模糊」，配置正确时它就是同一种模糊；差异全在**配置**上（§5.3）。

### 5.3 variant-b 的 SVG 滤镜两个坑（都实测过）

探针 `probe/svg-filter-probe.html`：三个盒子内部花纹逐像素相同，只有模糊机制不同。

| 盒子 | 平均R | luma均值 | 边缘能量 tv |
|---|---|---|---|
| A · CSS `blur(22px) saturate(1.7)` | 83.6 | **142.6** | **0.531** |
| B · SVG 默认（`linearRGB` + 默认区域） | **150.8** | **174.8** | 0.399 |
| C · SVG `sRGB` + 区域放大到 160% | 83.6 | **142.6** | **0.531** |

1. **`color-interpolation-filters` 默认是 `linearRGB`，CSS `filter` 走 `sRGB`。**
   同一个 `stdDeviation="22"`，B 的 luma 比 A 高 **+32.2（+22.6%）**，红通道 83.6 → 150.8（**+80%**）。
   加上 `color-interpolation-filters="sRGB"` 后，C 与 A 的四个统计量**逐位相同**。
2. **`<filter>` 区域默认只有 bbox 的 `-10%..110%`，会把模糊光晕直接切掉。**
   盒子顶边 y=290 之上逐 6px 行带的 luma（远处纯底 = 13.6）：

   | y 带 | A · CSS | B · SVG 默认区域 | C · SVG 区域放大 |
   |---|---|---|---|
   | 266–272 | 33.4 | **13.6（光晕失踪）** | 33.4 |
   | 272–278 | 43.3 | 27.5 | 43.3 |
   | 278–284 | 55.3 | 65.6 | 55.3 |

   B 的硬边出现在 y≈276 = 290 − 14（14 = 140px 的 10%）。A 与 C 在所有行带上完全相同。

**所以 `variant-b.html` 里那个 `<filter>` 长这样**：
```html
<filter id="g22" x="-20%" y="-20%" width="140%" height="140%"
        color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="22" />
  <feColorMatrix type="saturate" values="1.7" />
</filter>
```

---

## 6. 踩坑记录

1. **第一版背景是「彩虹色条」，翻了两个车。**
   八个色相全开的色条 + `saturate(1.7)` → 毛玻璃里是一片脏兮兮的高饱和洋红/青，
   ① 违反 配色克制「≤3 主色，不是彩虹」；② 卡片上 18px 的白字压在洋红上根本读不出来。
   **修法**：改成**高亮度对比、低彩度**的配色 —— 4 条近黑 + 2 条冷白 + 2 条低饱和强调色（青/琥珀），
   品红只留在背景色斑里。模糊要看得见靠的是**明暗硬边**，不是彩虹。

2. **卡片内部曾经是一块「死灰」。**
   色条完全不透明时，近黑的 4 条把底下的色斑全遮住 → 毛玻璃背后只有灰。
   修法：`.bar { opacity: .78 }` 让 22% 的色斑透上来；再在卡片底下放两团
   （`b3`/`b4`）慢速游走的青/品红色斑，保证卡片里**任何时候都有流动的颜色**。

3. **白字对比度实测只有约 4.4:1。**
   模糊后的背景是「中灰偏亮」的色浆，纯白 42px 标题没问题（大字只要 3:1），
   但 17–18px 的参数标签不够。
   修法：卡片自带一层 `rgba(12,18,40,.20)` 深色基色 + 上白下深的 `linear-gradient`，
   读数区对比度拉到 9:1 以上；卡片内所有文字加 `text-shadow: 0 1px 7px rgba(0,0,0,.5)`。

4. **当时的机器验收 的 `.stage` 正则会被注释骗到。**
   我原本在 CSS 上方写了一句注释提到 `第一条 .stage{} 取值`，而 verify 的
   `/\.stage\s*\{([\s\S]*?)\}/` 会匹配到**注释里**那个 `.stage{`，捕到空串，
   于是报 WARN「.stage 未显式写 px 宽高」。
   修法：把注释改成不含 `.stage{` 字样的说法。
   （同理，`verify` 的 lint 只看「会执行」的代码，注释会被剥掉 —— 但它用的是**非贪婪到第一个 `}`**，
   所以连注释里的花括号也要避开。）

5. **`verify` lint 会报一条 NOTE「有 1 处每帧改 DOM 文本」——这是误报。**
   那处是 `build()` 里建 60 根色条时写 `tag.textContent`，**只在 `load` 时执行一次**，
   不在 `reelDraw` 里。NOTE 不计入判定（`fails/warns`），本片确定性实测通过（§7）。
   之所以不用 `innerHTML` 拼字符串，就是为了避免改 DOM 结构时引入别的差异；
   但 `textContent` 的正则仍然会命中一次性写入 —— 这是 linter 的已知粗糙处。

6. **variant-a 一开始和主方案有 0.3/255 的稳定差，查出来是我自己写错了。**
   我在 variant-a 里手抄色斑渐变时把第二个色标写成了 `.12`，主方案是 `.15`。
   表现是「卡片外的背景也有 0.298 的 meanAbs」—— 卡片外本应逐字节相同。
   修法：把中间色标的 alpha 抽成 `BLOB_A2` 数组并与 `index.html` 逐项对齐，
   卡片外 meanAbs 从 0.298 降到 **0.054**。
   **教训**：做 A/B 对照时，任何「非受控变量」都会污染结论，必须用数据把背景差异压到 0 附近才敢下判断。

7. **SVG 滤镜默认的 `linearRGB` 会让颜色完全对不上。**
   第一版 variant-b 直接 `<feGaussianBlur stdDeviation="22"/>`，出来的卡片明显比主方案**亮**。
   `probe/svg-filter-probe.html` 量出来：luma 174.8 vs 142.6（+22.6%），红通道 +80%。
   修法：`color-interpolation-filters="sRGB"`，并把 `<filter>` 区域从默认 `-10%..110%`
   放大到 `-20%..140%`（否则盒子外沿的模糊光晕被切出一个硬矩形边，见 §5.3）。

8. **探针页也必须用 `capture.mjs` 截，不能只看浏览器预览。**
   本特效的整个命题就是「CDP `Page.captureScreenshot` 路径下 backdrop-filter 生不生效」，
   浏览器里看着好看不等于截帧里好看。所有结论都来自 `capture.mjs` 产出的 PNG。

---

## 7. 验收结论

### 7.1 当时的机器验收输出（已不在出片闭环）

```
=== 验收 玻璃拟态 ===
[PASS] lint: .stage 尺寸与 REEL 一致 (1280x720)
[PASS] lint: 无 CSS animation（全部走 reelDraw/WAAPI）
[NOTE] lint: 有 1 处每帧改 DOM 文本（已知高负载下会引发字形栅格化 1/255 抖动；
             若 determinism 偶发失败，先查这里，改画进 canvas —— 见 故障文字/README.md §5.1）
[PASS] lint: REEL = 5s @30fps 1280x720
[PASS] mp4: 成片 1280x720 30.00fps 5.000s 150帧 13363KB
[PASS] mp4: 全片解码无错误
[PASS] determinism: 同一 t 两次截帧逐字节一致（5 个采样点）
[PASS] determinism: 采样帧互不相同（5/5 唯一）
[PASS] determinism: 换 seek 路径同一 t 仍逐字节一致（先经 0/25% 到达 vs 直接到达）
[PASS] sheet: contact sheet（带帧号）: .../玻璃拟态/sheet.png
[PASS] density: 最长静止段 0.10s（3 帧）/ 静止占比 4%
[PASS] deliver: 有 README.md
[PASS] deliver: 有 index.html

结果: 0 FAIL / 0 WARN  ->  合格
```

- **FAIL = 0，WARN = 0，结果「合格」。**
- 那条 **NOTE** 是 linter 的误报，不计入判定：它命中的是 `build()` 里建 60 根色条时的那一次
  `tag.textContent = …`，**只在 `load` 时执行一次**，不在 `reelDraw` 里。全片 0 处每帧 DOM 文本写入
  （所有会变的文字都画进 canvas）。
- **冻帧率（`density`）：最长静止段 0.10s（3 帧），静止占比 4%** —— 远低于 18% 的 PASS 门槛。
  这 3 帧对应末段 4.55–5.0s 的定格，属预期。
  （当时的机器验收 在我作业期间被更新过，`density` 行的措辞从
  「相邻帧完全相同 N/M 对」改成了「最长静止段 / 静止占比」；两次输出都是 PASS，结论不变。）

### 7.2 三条成片

| 片子 | 分辨率 | 帧率 | 时长 | 帧数 | 大小 |
|---|---|---|---|---|---|
| `out.mp4`（主方案） | 1280×720 | 30.00 | 5.000s | 150 | 13684058 B |
| `variants/variant-a.mp4` | 1280×720 | 30.00 | 5.000s | 150 | 13678005 B |
| `variants/variant-b.mp4` | 1280×720 | 30.00 | 5.000s | 150 | 13675107 B |

三条都只有一条 h264 视频流：**无音轨、无 srt、无 `gbar.json`**。

### 7.3 我在 `sheet.png` 上肉眼确认了什么

把 15 格当成 15 张封面逐格看：

1. **第 0 格（t=0）可以直接当封面**：卡片已在位、`READY / 0 px / 空条`、背景色斑已就位。
   不是空白，也不是散件乱飞。
2. **第 0→14 格是连续可见的变化**：测试卡一路右→左滑过（色条图案每格都不同），
   读数 `0 → 8 → 30 → 63 → 107 → 170 → 238 → 303 → 360 → 400 → 428 → 445 → 448 → 448`，
   位移条同步长满。**没有任何一格是「看着像没动」的。**
3. **卡片本身在 15 格里始终是一个干净的毛玻璃矩形**：四角圆角完整、没有被裁、没有溢出；
   卡片内是柔和的色浆，卡片外每一根色条的分隔线和标签都锐利可数 —— 「糊了 / 没糊」一眼可辨。
4. **末两格是稳定结束态**：`SETTLED / 448 px / 满条`，不是 99% 配 LOADING，也没有闪回第 0 帧。
5. **无豆腐块**：中文（特效 / 玻璃拟态 / 背景模糊 / 模糊半径 / 饱和度 / 背景位移）全部正常渲染，
   没有方框、没有缺字。
6. **无溢出、无顶格**：卡片四周留白充足；没有任何元素被舞台边缘裁掉。
7. `variants/sheet-a.png` / `variants/sheet-b.png` 同样逐格看过 —— 构图与主方案一致，
   只有卡片标题文案不同（`copy + blur + clip` / `feGaussianBlur`），
   圆角处**没有**出现 SVG 滤镜的硬边或漏光。

---

## 8. 视觉质量评分表 · 逐条自评

| # | 检查项 | 自评 | 依据 |
|---|---|---|---|
| 1 | **主体唯一** | ✅ | 全片只有一个主体：居中的玻璃卡片。背景是刻意「去主体化」的测试卡纹理 |
| 2 | **首帧成壳** | ✅ | t=0 就是完整构图：卡片在位、读数 `READY / 0 px`、空条、背景色斑已在流动（SPEC 要求） |
| 3 | **末帧成图** | ✅ | 末帧 `SETTLED / 448 px / 满条`，构图完整，文字是结束态，不飞走、不回第 0 帧 |
| 4 | **节奏三段** | ✅ | 静止起手 0.45s → `easeInOut` 加速主体 → 减速收束 → 定格 0.45s；速度两端为 0，不是匀速 |
| 5 | **留白呼吸** | ✅ | 卡片 x∈[330,950]、y∈[210,530]；四边余量 330/330/210/190 px，全部 ≥64px；卡片内边距 40px |
| 6 | **对比达标** | ✅ | 参数标签 18px、参数值 21px、卡片读数在 canvas 里按 2× 后备绘制（显示 25px）；读数区对比度 >9:1 |
| 7 | **配色克制** | ✅ | 主色 3 个（青 `#17b0a2` / 琥珀 `#c9913f` / 品红只在色斑里）+ 强调色冷白；黑灰为中性 |
| 8 | **排版有层级** | ✅ | 标题 42px / 参数值 21px / 标签 18px / 注释 17px；最大比 2.47 倍 ≥1.4；左对齐一条基准线（全部 left:40px） |
| 9 | **动效不炫技** | ✅ | 只有三种运动：测试卡横移、相机按景深平移、色斑慢速轨道。三者都服务于同一件事——「让玻璃背后的内容一直在变」，没有旋转/弹跳 |
| 10 | **无装饰性扫光** | ✅ | 全片没有任何扫描线/高光扫过。唯一的横线是测试卡自带的 6px 横纹，它承载「高频细节」这个信息 |
| 11 | **承接可辨** | ✅ | 单镜头特效，无分段。背景的测试卡与环靶从第一帧贯穿到最后一帧 |
| 12 | **中文排版** | ✅ | 中文全是短标签（模糊半径/饱和度/背景位移），无标点、无行首标点、无全角空格凑位置 |

**达标 12 / 12。**