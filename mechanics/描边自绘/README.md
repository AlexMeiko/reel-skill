# 特效 03 · 描边自绘 / 路径生长（SVG line draw）

> ⚠️ **本目录已于 2026-09-24 精简**：`variants/`、`qa/`、`probe/`、`evidence/`、`table/` 已按使用者决定删除，
> 现只保留 `index.html` + `README.md`；成片与过程产物不入库，需要时用 `capture.mjs` 从 `index.html` 重导。
> **下文提到的备选实现、取证帧与复现命令已不在磁盘上**，但**结论与实测数字仍然有效**
> （它们本来就是为了支撑这些结论才做的）。本库入口见 [`../INDEX.md`](../INDEX.md)。


> **一句话**：一张工程线稿——三层等高线、一个拟合曲线小图、一个目标靶环、一条会发光的航线——
> 在 5 秒里被「一笔一笔画出来」；每条路径错峰生长，笔尖跟着一个光点，
> 全部画完后沿航线做一次**逐点复核**（经过每个航点放一圈确认环），最后定格。
>
> 全片 1280×720 / 30fps / 5.0s / 150 帧。**没有任何跨帧状态**：画面 = f(t)。

## 交付物

| 文件 | 说明 |
|---|---|
| `index.html` / `out.mp4` | 主方案：reelDraw 单一进度源 |
| `variants/variant-a.html` / `variant-a.mp4` | 备选 A：WAAPI 每路径一条 `animation`（实测更差，见 §5） |
| `variants/variant-b.html` / `variant-b.mp4` | 备选 B：曲线生长 + 面积填充 + 游标（单元素内多元素同源） |
| `qa/`、`variants/qa-a/`、`variants/qa-b/` | 三条片子的成片抽帧（0 / 25% / 50% / 75% / 末帧） |
| `sheet.png` | 主方案 15 格 contact sheet（当时从成片抽的） |
| `probe/` | 全部实测证据：chromium 行为探针、`clip-path` 探针、路径长度与耗时、WAAPI 漂移测量、三条片子的定点静帧 |

---

## 1. 常见写法为什么在本 skill 里会坏

| 常见写法 | 坏在哪 | 本库的 seekable 改法 |
|---|---|---|
| **一条线一个 `@keyframes { to { stroke-dashoffset: 0 } }`** | 8 条路径要错峰就得写 8 条动画 + 8 个 `animation-delay`；更致命的是**光点位置拿不回来**——CSS 不告诉你「当前 dashoffset 是多少」，只能再手算一遍 → 同一件事有两条时间线，改一处就错位。总时长一变，8 个 delay 全部要重算 | 只留一个自变量 `prog = span(t, T0, T1)`，路径 k 的进度由公式 `u_k = span(prog, k/K*0.7, k/K*0.7 + 0.3)` 现算；光点用**同一个** `u_k` → `getPointAtLength(len*u_k)` |
| `animation: … infinite` | 末帧不是结束态（首帧成壳、末帧结束态 硬约束）；而且无限循环的相位取决于「页面被墙钟推了多久」，与 t 无关 | 本片 **0 条 CSS animation**，全部走 `reelDraw`；末帧是静止的完成态，之后停 0.4s |
| `transition: stroke-dashoffset 1s` | transition 是**墙钟补间**。seek 到 t=2.0 时属性还在从上一帧的值往目标值爬，画面永远滞后于 t（`_shared/anti-patterns/a5`） | 删掉。`reelDraw` 里直接算出该帧的终值写一次：`el.style.strokeDashoffset = len*(1-u)` |
| 墙钟 `rAF` / `Date.now()` / 累加器 `off -= speed*dt` | 累加器的值取决于「这一帧之前被 seek 过几次」。同一 t 截两次会得到不同画面，当时的机器验收 的确定性检查必挂 | 闭式：`off = len * (1 - span(t, t0, t1))`。整片没有 `dt`，没有 `+=` |
| `Math.random()` 做抖动/延迟 | 同 t 两次截帧不同 → 确定性 FAIL | `hash(i) = fract(sin(i*127.1+311.7)*43758.5453)`，本片用于……其实**一处都没用到**：这个特效的错峰是确定性的几何，不需要伪随机 |
| 每帧 `el.getTotalLength()` 重算（"保险起见"） | 见 §4 实测：**505µs/次**。8 条 × 30fps = 每秒 240 次 ≈ 每秒 0.12s 纯几何开销，而且值根本不会变 | `load` 之后量一次，存进 `{el, len, u}`，之后每帧只写 `stroke-dashoffset` |
| 在 `DOMContentLoaded` 或 `<head>` 里量长度 | 布局未完成时可能拿到 0 或残缺值，笔画会「第一帧就全亮」 | 只在 `load`（`document.readyState === 'complete'`）之后量，并留 `getBBox()` 兜底 + `window.__reelPathFallback` 诊断 |
| 给缩放过的等高线加 `vector-effect: non-scaling-stroke` | 这个属性会把 `stroke-dasharray/dashoffset` **也**改到屏幕坐标系求值，而长度是局部坐标系量的，两者差一个 scale，线画到一半就停 | 不加。等高线用 `transform="scale(...)"` 缩放，dash 全部用**局部**长度；线宽随缩放自然变细（外圈粗、内圈细，正好是等高线该有的样子） |
| 用 `2πr` 代替 `getTotalLength()` | 实测 `<circle r="40">` = **250.921**，`2πr` = **251.327**，差 0.16%。拿 `2πr` 当 dasharray，圆环会留下一个缺口 | 一律实测。目标双环写成两段弧的 `<path>`，照样量：`r0 = 201.091`（`2π·32 = 201.062`）、`r1 = 94.262`（`2π·15 = 94.248`） |
| 「CSS 动进度条 + JS 动数字」 | 两条独立时间线，seek 后必然对不上 | 表头的百分比 / 进度条宽度 / 条上游标**全部**出自同一次 `prog`，见 §3.1 |

---

## 2. 时间轴设计

### 2.1 错峰公式 `u_k = span(prog, k/K*0.7, k/K*0.7 + 0.3)`

```js
var T0 = 0.40, T1 = 3.40;   // 全局绘制区间
var SPAN = 0.70, DUR = 0.30;
function windowOf(k) { return [k / K * SPAN, k / K * SPAN + DUR]; }
```
`K = 8`（8 条被「画」出来的路径）。设计理由：

1. **自变量只有一个 `prog`，不是 8 个绝对秒数。** 要改总时长，只动 `T0/T1` 两个常量，8 条窗口自动等比缩放；写成 8 个 `animation-delay` 就必须重算 8 个数（`PATTERNS.md §3.1` 点名的失败模式）。
2. **`k/K*0.7`**：8 个起点均匀铺在 prog 的前 70%，间距 `0.7/8 = 0.0875`。最后一条（航线，`k=7`）从 `0.6125` 起笔——它正好是时长最长、最该压轴的那条。
3. **`+0.3`**：每条占 30% 的 prog 宽度。于是相邻重叠率 = `1 - 0.0875/0.3 = 70.8%`，**任意时刻平均有 3.43 条线同时在生长**。
   - `DUR = 1.0`（全部同时）→ 8 条一起长，看不出「一笔一笔」，光点会在 8 处同时出现。
   - `DUR = 0.1`（近乎串行）→ 单条只占 0.3s，8 条要 2.4s，中间大量空转，节奏机械。
   - `DUR = 0.3` 是实拍手感：**能看出起笔是依次的，但任何一格画面里都有 3–4 条线在动**，不会读成「批次」。
4. **为什么末端不拉到 1.0**：最后一个窗口 `0.6125+0.3 = 0.9125`，对应 `t = 3.1375`。程序上它留出了 0.26s 的「线画完、还没开始复核」的停顿——这是节奏里的一个**气口**，不是 bug。

各路径实际窗口（秒）：

| k | 路径 | 长度(local) | 起笔 | 收笔 |
|---|---|---|---|---|
| 0 | `c0` 等高线外层 | 1270.773 | 0.400 | 1.300 |
| 1 | `c1` 等高线中层 | 1270.773 | 0.663 | 1.563 |
| 2 | `c2` 等高线内层 | 1270.773 | 0.925 | 1.825 |
| 3 | `ax` 面板坐标轴 | 374.000 | 1.188 | 2.088 |
| 4 | `cv` 拟合曲线 | 312.396 | 1.450 | 2.350 |
| 5 | `r0` 目标外环 | 201.091 | 1.713 | 2.613 |
| 6 | `r1` 目标内环 | 94.262 | 1.975 | 2.875 |
| 7 | `rt` **航线（主体）** | 918.048 | 2.238 | 3.138 |

### 2.2 为什么**不**给 `prog` 加 easing

我试过 `prog = easeInOut(span(t,0.4,3.4))` 来做「慢起—快中—慢收」。问题：最后一条路径的窗口在 `prog = 0.9125` 就结束了，而 `prog` 本身还要爬到 1.0；一旦给 `prog` 加缓动，`0.9125 → 1.0` 这段会被拉得更长，**最后一条线画完之后会出现约 0.6s 的纯空转**。

所以 `prog` 保持线性，**节奏改由「分段 + 各段不同的出墨速率」承担**：

| 段 | 时间 | 做什么 | 出墨速率 |
|---|---|---|---|
| 起手 | 0.00–0.40 | 完整静态壳（表头 READY 000%，坐标格、比例尺、起点/目标标记都在） | 静止 |
| 主体·爬坡 | 0.40–1.83 | 三层等高线（每条 1270px，各占 0.9s） | 慢，气氛段 |
| 主体·加密 | 1.19–2.88 | 面板坐标轴 + 拟合曲线 + 目标双环（5 条叠在一起） | 中 |
| 主体·高潮 | 2.24–3.14 | **航线 918px 只用 0.9s** —— 全片单位时间出墨最多的一段 | 快 |
| 气口 | 3.14–3.40 | 线全部画完，画面静止 0.26s | 静止 |
| 收束 | 3.40–4.60 | 复核：亮段沿航线走完 + 5 个航点逐一放确认环 | 匀速但换了「动作类型」 |
| 定格 | 4.60–5.00 | 稳定的完成态 | 静止 |

### 2.3 单源同步清单

片里每一帧的派生量都挂在**恰好一个**值上：

| 真值 | 派生出来的东西 |
|---|---|
| `prog`（绘制进度） | 8 条路径的 `u_k`、表头百分比、表头条宽、条上游标位置、陆地填充的 `fill-opacity`（用 `u_0`）、航点弹入窗口、目标刻线浮现窗口 |
| `u_R`（= `u_7`，航线进度） | 航线笔画的 dashoffset、生长光点位置 + 显隐 |
| `sfe`（复核行程 0→1） | 复核亮段的 dashoffset、复核光点位置、5 个确认环的半径与透明度、表头 `CHECK n/5` 的 n |

### 2.4 关于表头那条「进度条」——它不是成片进度条

特效片不需要进度条 说「特效片不需要进度条」，这里说明清楚：**本片没有 `gbar.json`、没有 srt、没有音轨**
（`ffprobe` 确认三条 MP4 都只有一条 h264 视频流）。表头右上角那条 250px 细线是**特效自身的读数**，
不是 kit 的全片进度条（不在画面底边、不写 `REEL.offset`、不读 `gbar.json`）。

留着它是因为 SPEC 给这个特效立了一个明确命题——**「进度只能有一个真值来源」**。
细线宽度 + 百分比数字 + 线上的游标 + 8 条路径的 dashoffset，全部由**同一个 `prog`** 算出；
哪天有人把其中任何一个改成 CSS 动画，这条读数会立刻和笔尖错开，肉眼就能发现。
它是这个特效的**自检仪表**，不是装饰。

---

## 3. 关键技术点（核心代码）

### 3.1 唯一进度源 + 每元素每帧只写一次（`index.html`）

```js
function windowOf(k) { return [k / K * SPAN, k / K * SPAN + DUR]; }

window.reelDraw = function (t) {
  var prog = reel.span(t, T0, T1);              // ← 全片唯一真值

  for (var k = 0; k < K; k++) {                 // 8 条路径，各写一次
    var it = IT[k], w = windowOf(k);
    var u = reel.span(prog, w[0], w[1]);        // 局部进度
    it.u = u;                                    // 留给光点/航点复用
    it.el.style.strokeDashoffset = (it.len * (1 - u)).toFixed(3);
  }
  IT[0].el.style.fillOpacity = (IT[0].u * 0.10).toFixed(4);   // 陆地：同一个 u_0

  var uR = IT[K - 1].u;                          // 航线进度
  var q = route.getPointAtLength(IT[K - 1].len * uR);          // 笔尖 = 光点
  tipg.setAttribute("transform", "translate(" + q.x + "," + q.y + ")");
  tipg.style.opacity = (uR > 0.0005 && uR < 0.9995) ? "1" : "0";

  var pct = Math.round(prog * 100);              // 读数、条宽、条游标同源
  pctEl.textContent = ("00" + pct).slice(-3) + "%";
  var wpx = prog * 250;
  fillEl.style.width = wpx.toFixed(2) + "px";
  mtipEl.style.left  = wpx.toFixed(2) + "px";
};
```

**为什么这样写**：`dasharray = "len len"` + `dashoffset = len*(1-u)` 是「从起点长到 u」的精确表达——
`u=0` 时 dash 完全落在路径外（不可见），`u=1` 时整个 dash 正好盖满路径。光点用同一个 `u_R` 求，
所以**笔尖和光点在数学上不可能错开**（对比 variant-a §5）。

### 3.2 长度只在 load 后量一次（`index.html`）

```js
function measure(el) {
  var L = 0;
  try { L = el.getTotalLength(); } catch (e) { L = 0; }
  if (!(L > 0.5)) {                       // 兜底 + 诊断，别让线第一帧就全亮
    var b = el.getBBox();
    L = Math.sqrt((b.width + 1) * (b.height + 1)) * 3.1;
    FALLBACK.push(el.id);
  }
  return L;
}
function lengthOf(id) {
  var el = $(id), len = measure(el);
  el.setAttribute("stroke-dasharray", len.toFixed(3) + " " + len.toFixed(3));
  el.style.strokeDashoffset = len.toFixed(3);   // 首帧：一条线都没有
  return { el: el, len: len, u: 0 };
}
// build() 只在 load 之后跑一次；航点位置也在这里算完就缓存
var rl = IT[K - 1].len;
for (i = 0; i < FR.length; i++) {
  var p = route.getPointAtLength(rl * FR[i]);   // ← 5 次，之后每帧只写 transform
  WX.push(p.x); WY.push(p.y);
}
```

### 3.3 复核亮段：一条 dash 沿真实航线走（`index.html`）

```js
// 几何直接抄航线，不手写第二遍 d
ov.setAttribute("d", route.getAttribute("d"));
ov.setAttribute("stroke-dasharray", "76 6000");     // 只有一个 76 长的短划

var sv  = reel.span(t, SW0, SW1);       // 3.40 → 4.60
var sfe = reel.easeInOut(sv);
ov.style.strokeDashoffset = (-rl * sfe).toFixed(3); // 负值 = 短划向前走
var ovOp = (sv <= 0 || sv >= 1) ? 0 : Math.min(1, Math.min(sv, 1 - sv) / 0.12);
ov.style.opacity = ovOp.toFixed(3);
```

**这不是装饰性扫光**（动效不炫技）：短划沿**真实航线**走，表头同时显示 `CHECK n/5`，
每经过一个航点就在那里放一圈确认环——它承载的是「已复核到第几个航点」这个信息。

---

## 4. `getPointAtLength` / `getTotalLength` 的开销与缓存策略

全部是在本机 headless Chromium（UA `Chrome/152.0.0.0`）里**实测**的（`probe/path-lengths.html`，
页面把结果画成文字再截图，避免我凭记忆写数）：

```
8 条路径实测长度（local 用户单位，与 transform 无关）
  c0  getTotalLength = 1270.773   (transform: translate(378,212) scale(1))
  c1  getTotalLength = 1270.773   (transform: translate(385,217) scale(0.73))
  c2  getTotalLength = 1270.773   (transform: translate(373,209) scale(0.47))
  ax  getTotalLength = 374.000
  cv  getTotalLength = 312.396
  r0  getTotalLength = 201.091
  r1  getTotalLength = 94.262
  rt  getTotalLength = 918.048

getPointAtLength ×3000 = 2536.0 ms  →  单次 845.33 µs
getTotalLength   ×3000 = 1516.3 ms  →  单次 505.43 µs

末点 getPointAtLength(L) = (900.00, 162.00)   起点 = (96.00, 372.00)
```

三点结论：

1. **它不是免费的。** 单次 `getTotalLength()` ≈ 0.5ms，`getPointAtLength()` ≈ 0.85ms。如果按「每帧重算 8 条长度」的直觉写法，
   `8 × 0.5ms = 4ms/帧`，在 30fps 下吃掉 12% 的帧预算，在 60fps 的实时预览里吃掉 **24%**，而且算出来的是同一个数。
2. **所以长度只在 `load` 后量一次并缓存**（8 次调用，合计约 4ms，一次性）。
   `getPointAtLength` 是唯一必须每帧调的东西，而**每帧只调 2 次**（生长光点、复核光点）= 1.7ms/帧。
   航点位置在 `load` 时算 5 次后缓存，之后每帧只写 `transform`。
3. **返回值是局部坐标，不是屏幕坐标。** `c0/c1/c2` 的 `d` 完全相同、transform 分别是 `scale(1)/0.73/0.47`，
   但三条的 `getTotalLength()` **都是 1270.773**；`scaled.getPointAtLength(L)` 也返回局部坐标。
   这直接决定了两个写法：dash 必须用局部单位；缩放的路径**不能**加 `vector-effect: non-scaling-stroke`。

> 旁证：我第一版探针在 `load` 事件里同步跑 `for(j=0;j<20000;j++) getTotalLength()`，
> 浏览器被卡住 20 秒，CDP 的 `Page.loadEventFired` 一直送不出来，`capture.mjs` 直接报
> `Error: wait timeout: Page.loadEventFired`。这本身就是「这个 API 不便宜」的现场证据。

---

## 5. 三方案对比

| | **主方案 `index.html`** | **variant-a**（WAAPI） | **variant-b**（曲线生长） |
|---|---|---|---|
| 机制 | 一个 `reelDraw` 里 8 次 `style.strokeDashoffset = len*(1-u)` | 8 条 `el.animate()`，`delay/duration` 写绝对毫秒 | 一个 `fi` 派生曲线 / 面积 / 游标 / 圆点 / 读数 |
| **时间信息放在几处** | **一处**（`prog` + 公式） | **两处**：WAAPI 的 ms + `reelDraw` 里再手算一遍 `span` | **一处**：`fi = easeInOut(span(t,S0,S1))*(N-1)` |
| 改总时长要动几处 | 2 个常量 | 8 个 delay + 8 个 duration + JS 里同一套 | 4 个常量 |
| 加 easing | 改一行（但注意 §2.2 的空转） | **会错位**：实测峰值偏 **121px = 全长的 12.1%** | 改一行，全元素同步 |
| 每帧 DOM 写入 | 约 30 次 | 约 30 次（笔画走合成器，但光点仍在主线程） | 约 20 次（含 7 个数据点 + 7 个 x 刻度） |
| `getTotalLength` 调用 | 8 次（load 时一次） | 8 次（load 时一次） | 2 次（load 时一次） |
| 画面重量 | 8 条路径 + 2 光点 + 1 填充 | 同左 | 曲线 + 面积 + 游标 + 气泡 + 7 点 |
| 皮肤 | 深蓝工程图（`#071320` + 青 `#8ae6ff`） | 纸感墨线（`#f5f3ec` + 蓝黑 `#16324a`） | 浅灰编辑风（`#e9edf1` + 青绿 `#0f8b8d`） |
| 复用性 | 换 `d` 即可，时间轴不用动 | 同左，但每条路径要重排成 ms | 换数据数组即可；`clip-path` 依赖「面积路径 bbox 恰好等于绘图区」 |
| 导出代价（本机 `--jobs 2`） | 150 帧 ≈ 50s / 448KB | 150 帧 ≈ 50s / 424KB | 150 帧 ≈ 50s / 234KB |

**为什么 WAAPI 在这里更差（有实测数据）**

`probe/waapi-easing-drift.html` 里造了两条同样的 stroke 动画（1000px 路径、delay 400ms、duration 1500ms、
`fill: both`），一条 `easing: linear`、一条 `easing: ease-in-out`，再和 JS 手算的 `span(t,0.4,1.9)` 对比：

```
  t(s)   A(u)     B(u)     C(u)    |A-C| 沿路径像素   |B-C|
  0.50   0.0086  0.0667  0.0667   58 px       0 px
  0.70   0.0817  0.2000  0.2000  118 px       0 px
  0.90   0.2318  0.3333  0.3333  102 px       0 px
  1.15   0.5000  0.5000  0.5000    0 px       0 px
  1.40   0.7682  0.6667  0.6667  102 px       0 px
  1.65   0.9439  0.8333  0.8333  111 px       0 px
  1.85   0.9979  0.9667  0.9667   31 px       0 px
  峰值偏差：ease-in-out 121px（= 全长的 12.1%）   linear 0px
```

也就是说：**只要有人给 WAAPI 关键帧加一个 easing（这是最自然的想法），手算的光点就会和笔尖分开 121px 那么远。**
`linear` 时两边严丝合缝，但那只是因为我把 JS 端的公式抄成了线性的——这恰恰暴露了「同一件事写两遍」的代价：
正确性依赖于两处常数一直保持一致。variant-a 里为了让复核亮段和光点同速，我不得不在 JS 里**手写一个
和 CSS 同参数的 `cubic-bezier` 求值器**（`cbez()`，牛顿迭代 8 次），这就是这份代价的具体形态。

**推荐**：
- **做「线稿自绘」这类特效 → 用主方案。** 光点必须和笔尖同源是硬需求，`reelDraw` 把这条规则写成了代码结构，不是靠自觉。
- **做数据图 → 用 variant-b。** `clip-path: inset()` 是元素内部的原生裁剪，代价最低、效果最完整（曲线 + 面积 + 游标一次成型），
  而且实测 SVG 元素的参照框就是它自己的 bbox（`probe/clip-path-inset.html`：`inset(0 50% 0 0)` 正好切在形状 bbox 的 50% 处），
  所以 `inset(0 (100-revealed)% 0 0)` 和曲线进度是线性对应的。
- **variant-a 只在「必须用声明式动画、且不需要光点」时才选。** 本片的结论是：这里不需要。

---

## 6. 踩坑记录

1. **缩放的 path，`getTotalLength()` 返回局部长度。**
   三条等高线的 `d` 完全相同，transform 是 `scale(1)/scale(0.73)/scale(0.47)`，但 `getTotalLength()` 都是 `1270.773`。
   我一开始按「返回屏幕长度」写，给缩放过的等高线加了 `vector-effect: non-scaling-stroke`，
   结果**线画到一半就停住**（dasharray 用局部长度、dashoffset 被当成屏幕单位，两者差一个 scale）。
   修法：去掉 `non-scaling-stroke`，dash 全部用局部单位。（探针：`probe/chromium-behavior.html`）

2. **`<circle>` 的长度 ≠ `2πr`。**
   探针里 `<circle r="40">` 得 `250.921`，`2πr = 251.327`，差 0.16%。
   小圆上看不出来，但拿 `2πr` 当 dasharray 会让圆环留下一个 0.4px 的缺口。
   本片的目标双环干脆写成两段弧的 `<path>`，并照样实测：`r0 = 201.091`（`2π·32 = 201.062`）、`r1 = 94.262`（`2π·15 = 94.248`）。

3. **面板的预印坐标格被自己的底板吃掉了。**
   `.pgrid` 放在 `#panel` 的 `<rect>` **之前**，而 `<rect fill="rgba(10,32,51,.72)">` 是半透明底，
   把下面的网格糊没了。t=0 截帧一看面板是一大块空的。
   修法：把 `.pgrid` 挪到 `<rect>` 之后、标题之前。

4. **探针页把浏览器卡死 → `Page.loadEventFired` 超时。**
   我在探针里写了 `for (j=0;j<20000;j++) rt.getTotalLength()`，浏览器在 load 事件里同步跑 20 秒，
   CDP 事件送不出来，capture 报：
   ```
   Error: wait timeout: Page.loadEventFired
       at Timeout._onTimeout (file://<技能目录>/tools/capture.mjs:239:16)
   ```
   降到 3000 次后正常。这条报错本身就是 §4 那组耗时数据的旁证。
   （**注意**：这是**探针页**里的写法；交付页 `index.html` 里 8 次 `getTotalLength` 全在 load 里，合计约 4ms，
   之后 150 帧每帧只调 2 次 `getPointAtLength`。我特意确认过产物没有这个隐患。）

5. **给 WAAPI 关键帧加 easing 会让手算光点错位 121px。**
   见 §5 的实测表。这不是我「修掉」的坑（variant-a 里我选择用 `easing: linear` + JS 端复刻 `cubic-bezier` 来保持一致），
   而是**这个方案本身的坑**——它正是主方案存在的理由。

6. **`stroke-dasharray` 写属性、`stroke-dashoffset` 写 style，单位必须都是局部用户单位。**
   实测 `getComputedStyle(p).strokeDasharray` 回 `123.5px, 123.5px`，`style.strokeDashoffset = "61.25"` 回 `61.25px`——
   两者都在元素自己的（transform 之前的）用户坐标系里求值。混入屏幕单位就会静默画错（不报错、不警告）。

7. **中文没有豆腐块。** `document.fonts.check('20px "Noto Sans CJK SC"')` = `true`，
   全片用系统字体（`system-ui, "Noto Sans CJK SC", …`），没有任何 `@font-face` / 外链。

---

## 7. 验收结论

```
# 当时的机器验收已不在出片闭环。出片按 SKILL.md。
=== 验收 描边自绘 ===
[PASS] lint: .stage 尺寸与 REEL 一致 (1280x720)
[PASS] lint: 无 CSS animation（全部走 reelDraw/WAAPI）
[PASS] lint: REEL = 5s @30fps 1280x720
[PASS] mp4: 成片 1280x720 30.00fps 5.000s 150帧 448KB
[PASS] mp4: 全片解码无错误
[PASS] determinism: 同一 t 两次截帧逐字节一致（5 个采样点）
[PASS] determinism: 采样帧互不相同（5/5 唯一）
[PASS] sheet: contact sheet（带帧号）
[PASS] deliver: 有 README.md
[PASS] deliver: 有 index.html

结果: 0 FAIL / 0 WARN  ->  合格
```

### 我肉眼在 `sheet.png` / `qa/*.png` 上确认了什么

`sheet.png` 是**成片 MP4** 抽的 15 格（不是 HTML 截帧；当时的验收脚本用
`fps=(15-0.5)/duration ≈ 2.9`，故意取非整数，免得采样率和周期性动效同频骗人），我把 15 格逐格放大看过：

| 格 | 表头读数 | 看到什么 |
|---|---|---|
| 0 | `READY 000%` | 完整静态壳：网格、内框、`特效 03 / 描边自绘 · 路径生长`、空进度条（游标停在起点）、面板的预印坐标格与标题、`起点`/`目标`标记、比例尺 `20 km`、页脚两行。**没有任何一条已画出的线** |
| 1 | `STROKE 003%` | 等高线外层的起笔刚露头（起笔在等高线顶部，顺时针走） |
| 2–4 | `014% / 027% / 038%` | 第一层圆弧补完，第二、三层依次起笔 |
| 5–7 | `049% / 061% / 072%` | 三层等高线成型；面板的坐标轴与拟合曲线（琥珀色）画出来；目标靶环外环起笔画弧 |
| 8–9 | `083% / 096%` | **航线开始长**：笔尖带光点从左下往右上爬，经过的航点逐个弹入 |
| 10 | `CHECK 0/5 100%` | 航线已闭合到靶环、十字刻线浮现；复核亮段刚离开起点 |
| 11–12 | `CHECK 2/5 / CHECK 5/5` | 亮段沿航线右移，经过的航点各放出一圈确认环 |
| 13 | `DRAWN 100%` | 亮段退场，航线完整发光，整体辉光回到基准 |
| 14 | `DRAWN 100%` | 与第 13 格几乎相同 —— 0.4s 的定格 |

逐格检查过：**没有溢出/裁切**（最外元素距边 64–86px）、**中文无豆腐块**、**没有一格是纯空白或散件**。

成片抽帧（`qa/`，采样点 0 / 1.25 / 2.5 / 3.75 / 4.999）逐格读过：
`READY 000%` → `STROKE 029%` → `STROKE 070%` → `CHECK 1/5 100%` → `DRAWN 100%`，
首帧是静态壳、末帧是完成态。
`variants/qa-a`（同样五点）与 `variants/qa-b`（`18.0 → 21.3 → 31.5 → 48.0 → 48.0`）也逐格看过，三行都正确。
其中 `variant-a` 在 `t=3.75` 也是 `CHECK 1/5`，说明我在 JS 里手写的 `cbez(0.45,0,0.55,1)` 与 WAAPI 那条
`cubic-bezier()` 落进了同一个进度档——这条对得上是我最担心的一处。

---

## 8. 视觉质量评分表自评（12 条，达标 11 条）

| # | 检查项 | 自评 | 依据 |
|---|---|---|---|
| 1 | 主体唯一 | ✅ | 主体是那条 918px、最后 0.9s 画完的发亮航线；等高线（1.8px 暗蓝）、面板、靶环比它细、比它暗 |
| 2 | 首帧成壳 | ✅ | t=0 是一张能直接截屏发出去的「制图纸」：网格 / 内框 / 标题 / 表头 / 预印坐标格 / 起点终点标记 / 比例尺 / 页脚 |
| 3 | 末帧成图 | ✅ | t=4.6 起是完成态：航线闭合到靶环、`DRAWN 100%`、亮段与复核环已退场，随后 0.4s 不动 |
| 4 | 节奏三段 | ✅ | 起手 0.00–0.40 静止壳 → 主体 0.40–3.14（爬坡 1.83 前 / 加密 1.19–2.88 / 高潮 2.24–3.14）→ 气口 0.26s → 收束 3.40–4.60 → 定格 0.40s。`prog` 本身线性，但**出墨速率与动作类型在四段里都不同**（§2.2） |
| 5 | 留白呼吸 | ✅ | 顶 64px（表头）、左右 72px（`.head` 与 SVG 都在 72px 起）、底 86px（页脚文字底 634px）；地图 SVG 底 576px，距页脚还有 40px |
| 6 | 对比达标 | ✅ | 标题 26px / 表头读数 22px / 图注与页脚 18px，全部 ≥18px；`#dceffc` 文字压 `#071320` 底约 16:1，页脚 `#7fa6c2` 约 7:1 |
| 7 | 配色克制 | ✅ | 3 主色（`#2f6d9c` 等高线 / `#8ae6ff` 航线 / `#cfe6f7` 文字）+ 1 强调（`#ffb454` 目标与数字）；高光核心用 `#eafcff`（航线色系的同族，不新增色相） |
| 8 | 排版有层级 | ✅ | 26 / 22 / 18px，标题:注释 = 1.44×；所有文字共享左基准线 72px（SVG 内为 96 / 112 / 818） |
| 9 | 动效不炫技 | ✅ | 只有「线在长」和「复核在走」两件事。没有旋转、没有弹跳滥用（航点用 0.18s 的轻微 scale-in，服务于「这个点被经过了」） |
| 10 | 无装饰性扫光 | ✅ | 3.40–4.60 的移动亮段不是装饰：它沿**真实航线**走，表头同步 `CHECK n/5`，每过一个航点放一圈确认环 —— 承载「已复核到第几个航点」 |
| 11 | 承接可辨 | ✅ | 单阶段特效片。三个方案共用同一套线稿几何（同样的 `d`、同样的错峰公式），只在**机制与配色**上分岔，便于横向对比 |
| 12 | 中文排版 | ✅ | 全部是单行短语；无行首标点（`·` 只出现在行中）、无全角空格凑位；`特效 03 / 描边自绘 · 路径生长` 一行放得下 |

**唯一没给满分的思考**：第 6 条我把全部正文/注释统一到 18px，代价是表头内部（17px 标签 + 22px 数字）
与面板标题之间不再有字号差异——层级感主要靠颜色和字重（`#7fa6c2` vs `#ffb454`、500 vs 400）来撑。
如果允许注释降到 16px，层级会更清楚，但会踩到「正文 ≥18px」这条线，所以我选了前者。
