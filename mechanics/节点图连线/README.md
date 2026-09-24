# 特效 21 · 节点图连线（node graph / data flow）

> ⚠️ **本目录已于 2026-09-24 精简**：`variants/`、`qa/`、`probe/`、`evidence/`、`table/` 已按使用者决定删除，
> 现只保留 `index.html` + `README.md`；成片与过程产物不入库，需要时用 `capture.mjs` 从 `index.html` 重导。
> **下文提到的备选实现、取证帧与复现命令已不在磁盘上**，但**结论与实测数字仍然有效**
> （它们本来就是为了支撑这些结论才做的）。本库入口见 [`../INDEX.md`](../INDEX.md)。


**一句话**：一张素材处理管线的节点图 —— 节点按时间表逐个浮现，**连线只有在两端节点都浮现完之后才开始生长**（边的时刻由节点时刻推导，不是手写的），长完的边上数据包按取模相位循环流动，最后关键路径被高亮并用一道脉冲从入口走到出口。

产物目录：`<技能目录>/mechanics/节点图连线/`

| 文件 | 说明 |
|---|---|
| `index.html` / `out.mp4` | 主方案：SVG 路径 + `getTotalLength()`/dash 生长 |
| `variants/variant-a.html` / `variant-a.mp4` | 备选 A：canvas 画贝塞尔（60 段折线）+ 流向箭头 |
| `variants/variant-b.html` / `variant-b.mp4` | 备选 B：正交折线（曼哈顿路由）+ 工程图皮 |
| `evidence/derive.mjs` | 对照实验脚本（从 HTML 原文抽真身代码求值，不抄公式） |
| `evidence/late-node.html` | 实验组：只把「合成」节点的 `t0` 从 1.20 改晚到 1.95 |
| `evidence/exp-a/` `evidence/exp-b/` | 对照实验的两帧截图 |
| `evidence/transition/` | 「节点先出现、边后连上」的过渡态截图（3 帧） |
| `probe/` `qa/` `variants/qa-a/` `variants/qa-b/` | 抽帧 |

1280×720 / 30fps / 5.0s，无音频、无字幕、无进度条。

时间轴（全部相对 `NODES[i].t0` 推导）：

```
0.00–0.45  起手：纸底网格 + 标题 + 图例 + 页脚，图上一个节点都没有
0.45–1.65  7 个节点按 t0 错峰浮现（每个 0.30s，步进 0.15s）
0.90–2.05  7 条边生长（每条 0.40s，起点 = max(两端节点完成时刻)）
2.05–2.35  只有数据包在流
2.35–2.80  关键路径高亮：非关键边/节点淡出，关键边加粗 + 发光
2.80–3.90  连通脉冲从「素材」走到「编码」，经过的关键节点扩一圈
3.90–5.00  稳态：4 条关键边持续流动数据包，末帧是稳定的循环相位
```

---

## 1. 本特效的命门：边的生长时刻 = max(两端节点完成时刻)

**边的时刻表是推导出来的，不是写出来的。** 全片只有一处定义，在 `buildPlan()`：

```js
function buildPlan(nodes, edges, appear, grow) {
  var done = {}, i;
  for (i = 0; i < nodes.length; i++) done[nodes[i].id] = nodes[i].t0 + appear;   // 节点「完成浮现」的时刻
  var out = [];
  for (i = 0; i < edges.length; i++) {
    var e = edges[i];
    var t0 = Math.max(done[e.from], done[e.to]);   // ← 唯一定义：两端都完成，这条边才允许开始
    out.push({ key: !!e.key, t0: t0, t1: t0 + grow });
  }
  return out;
}
```

数据侧因此可以干净到只有「节点时刻 + 拓扑」：

```js
var NODES = [
  { id: "a", label: "素材", x: 144,  y: 350, t0: 0.45, key: true  },
  ...
];
var EDGES = [                       // 边一个时刻字段都没有，只有拓扑
  { from: "a", to: "b", key: true  },
  ...
];
```

`reelDraw` 里也只读推导结果：

```js
for (i = 0; i < EDGES.length; i++) {
  var E = PLAN[i].E;
  var eu = reel.span(t, E.t0, E.t1);          // E.t0 来自 buildPlan，不是字面量
  E.el.style.strokeDashoffset = (E.len * (1 - eu)).toFixed(3);
}
```

### 1.1 反例：给边单独手写一张时间表会怎样

如果写死 `EDGES = [{from:"d", to:"f", t0:1.45, t1:1.85}, ...]`，那么一旦把「合成」的 `t0` 从 1.20 改到 1.95（完成于 2.25s），这条边会在 **t=1.45s 就开始往一个还没出生的节点上画**，中间有 **0.80s** 的画面是「线连着不存在的节点」。
本方案里同样的改动，`d→f`、`e→f`、`f→g` 三条边**自动**改到 2.25s 开始（见 §4 的实测表）。

### 1.2 连带把「高亮开始时刻」也变成推导量

`T_KEY = 2.35` 是设计值（字面量），但整体不得早于最后一条边长完：

```js
var lastT1 = 0;
for (i = 0; i < PLAN.length; i++) if (PLAN[i].E.t1 > lastT1) lastT1 = PLAN[i].E.t1;
T_KEY_AT  = Math.max(T_KEY, lastT1 + 0.22);   // 原时刻算出 2.35（设计值生效）
T_WAVE_AT = T_KEY_AT + KEY_FADE;              // 改晚后自动变 2.87
```

场景内仪表自洽 说「一个特效里不要出现两个开始/结束时刻」。本片只有**一个**：`NODES[i].t0`。
边、高亮、脉冲、节点环全部从它派生。等效于「单一时间轴」，把节点表整体平移，全片一起平移。

---

## 2. 常见写法为什么在本 skill 里会坏

| 天真写法 | 坏在哪 | 本片的 seekable 改法 |
|---|---|---|
| 边的时刻手写成第二张表 | 改节点时刻后边脱节 → 线连着还没出生的节点 | `t0 = max(done[from], done[to])`，一处定义（§1） |
| `stroke-dashoffset` 用 CSS `@keyframes` 动画 | 节点时刻一改，keyframes 的 delay 全部要手改，且和 JS 里的数字两套时间线 | 每帧在 `reelDraw(t)` 里按 `eu = span(t, E.t0, E.t1)` 写一次 `strokeDashoffset` |
| `offset += speed * dt` 让数据包流动 | 累加器 = 跨帧状态，seek 到同一 `t` 得到历史相关的画面（PATTERNS §8 的致命盲区） | `p = ((t - E.t1 - k*per/NP) / per) % 1`，取模相位 |
| 每帧 `path.getPointAtLength()` 定位数据包 | 7 条边 × 2 个包 × 每帧的 DOM 几何量测，30fps 导出明显变慢；而且是同一个量反复量 | load 时把每条边采成 65 点弧长表缓存，每帧只做表内线性插值 |
| `transition: stroke-dashoffset .4s` | transition 是墙钟补间，seek 不会等它跑完 → 画面滞后于 `t`（lint 直接 FAIL） | 无 transition，全部由 `reelDraw(t)` 写 |
| `animation: ... infinite` 让脉冲循环 | 末帧不是结束态（lint FAIL） | 脉冲只在 `[T_WAVE_AT, T_WAVE_AT+1.10]` 内跑一次 |
| `Math.random()` 抖动数据包相位 | 同一 `t` 两次截帧不一致（lint FAIL） | `hash(i*7.7+13.3)` 只给每条边一点固有周期差，是纯函数 |
| 用 rAF 做「生长动画」 | 墙钟驱动，画面与 `t` 无关（反例 A1） | 不需要 rAF；`reelDraw` 是纯函数 |

---

## 3. 其余关键技术点

### 3.1 曲线生长：dash + load 时缓存长度

水平出入的三次贝塞尔，控制点让出入都是水平的：

```js
function edgeD(x1, y1, x2, y2) {
  var dx = Math.min(120, Math.max(44, (x2 - x1) * 0.45));
  return "M" + x1 + "," + y1 +
         " C" + (x1 + dx) + "," + y1 + " " + (x2 - dx) + "," + y2 + " " + x2 + "," + y2;
}
var len = path.getTotalLength();                 // load 时量一次
path.setAttribute("stroke-dasharray", len + " " + len);
// 每帧：dashoffset = len * (1 - u)，u = span(t, E.t0, E.t1)
```

`getTotalLength()` 在该元素进入 DOM 之后才有意义，所以整个 `build()` 挂在 `window.load` 上。

### 3.2 数据包：取模相位（本特效第二个必须证明的点）

```js
var age = t - P.t1;                       // 边长完之前，这条边上不可能有数据包
for (k = 0; k < NP; k++) {
  var a = age - k * (P.per / NP);         // 第 k 个包的出生时刻（相对 t1 再错峰）
  if (a < 0) { g.setAttribute("opacity", "0"); continue; }
  var p  = (a / P.per) % 1;               // ← 取模，不是 s += v*dt
  var pt = pointAt(P, P.len * p);         // 从缓存的弧长表取点，永远贴在线上
  g.setAttribute("transform", "translate(" + pt.x.toFixed(2) + "," + pt.y.toFixed(2) + ")");
}
```

三个后果：
1. **数据包只在边长完之后出现**，与「边不连到不存在的节点」是同一条纪律；
2. `p` 只是 `t` 的函数，seek 到任何一个 `t` 都得到同一相位 —— 这也是 当时的机器验收 的「换 seek 路径」检查能过的原因；
3. 每条边的相位差来自 `E.t1`（即节点时刻），不需要额外写一张相位表。

### 3.3 `getPointAtLength` 的缓存

```js
function sampleTable(path, len) {           // load 时调用 SAMPLES+1 = 65 次
  var pts = [], i;
  for (i = 0; i <= SAMPLES; i++) {
    var p = path.getPointAtLength(len * i / SAMPLES);
    pts.push(p.x, p.y);
  }
  return pts;                               // 之后每帧只查表 + 线性插值
}
```

采 64 段时弦长 ≈ `len/64 ≈ 3px`，对半径 12px 的圆点来说弦高误差 ≈ 0.01px，肉眼不可见；换来的是每帧 0 次 DOM 几何调用。

### 3.4 关键路径连通脉冲：一个映射同时决定亮段与节点环

亮段用「叠加一条同 `d` 的路径 + dash 只留一段」实现，`[a0, a1]` 是全局弧长窗口在本边上的投影：

```js
var s = reel.span(t, T_WAVE_AT, T_WAVE_AT + WAVE_DUR) * KEL;   // 关键路径总弧长 KEL
var local = s - KE.cum;                                         // 本边上的行程
var a0 = Math.max(0, local - COMET), a1 = Math.min(KE.len, local);
var D = a1 - a0;
KE.comet.setAttribute("stroke-dasharray", D + " " + (KE.len + 2));  // 只留一段
KE.comet.setAttribute("stroke-dashoffset", (-a0));                  // 可见区间 = [a0, a0+D]
```

关键节点扩环的**时刻**用的是同一个线性映射（`tArrive = T_WAVE_AT + cum/KEL * WAVE_DUR`），
所以环一定在脉冲真正走到该节点的那一帧亮起 —— 不是第二条时间线（场景内仪表自洽）。

### 3.5 无场景内仪表

全片没有数字/百分比读数，页脚三行是静态文案。因此 §7.6 的「文案与数字同源」「末帧到终点值」两条不适用。
**若以后把本特效 concat 进整片**：页脚那行会与 kit 的 `gbar.json` 底栏抢位置，届时应删掉页脚或改走 `gbar.json` + `REEL.offset`（本片没有 `gbar.json`，底栏默认关闭）。

---

## 4. 对照实验：故意把一个节点的时刻改晚

当时用 `evidence/derive.mjs`（已不在库里）—— 它**从 HTML 原文里抽出 `NODES`/`EDGES` 字面量和 `buildPlan()` 的函数源码**，在 Node 里用同一份代码求值（不是抄一遍公式），然后把「合成」节点的 `t0` 从 1.20 改到 1.95 生成对照页，两张表并排比对。

**静态断言**（三条全 PASS）

```
PASS  EDGES 字面量里没有 t0/t1/时刻字段
PASS  buildPlan 里取出「两端都完成」的 max
PASS  reelDraw 用的是 PLAN 推出来的 E.t0 / E.t1
```

**A · 原时刻**

```
  边              由谁决定          t0(开始)  t1(完成)  开始帧
  素材→解码        max(done)=解码     0.90      1.30      27   [关键]
  素材→分离        max(done)=分离     1.05      1.45      32
  解码→增强        max(done)=增强     1.20      1.60      36   [关键]
  分离→混音        max(done)=混音     1.35      1.75      41
  增强→合成        max(done)=合成     1.50      1.90      45   [关键]
  混音→合成        max(done)=合成     1.50      1.90      45
  合成→编码        max(done)=编码     1.65      2.05      50   [关键]
```

**B · 只把「合成」`t0` 改晚 0.75s**

```
  增强→合成        max(done)=合成     2.25      2.65      68   [关键]
  混音→合成        max(done)=合成     2.25      2.65      68
  合成→编码        max(done)=合成     2.25      2.65      68   [关键]
  （其余 4 条边一动不动）
```

```
差值：d→f  t0 1.50 → 2.25 (+0.75s, 开始帧 45 → 68)
      e→f  t0 1.50 → 2.25 (+0.75s, 开始帧 45 → 68)
      f→g  t0 1.65 → 2.25 (+0.60s, 开始帧 50 → 68)
共 3 条边自动改期（全部是连着「合成」的边）
```

注意 `f→g` 只晚了 0.60s 而不是 0.75s —— 因为它的起点此前由「编码」的完成时刻（1.65）决定，改晚后换由「合成」（2.25）决定。**决定者是谁也是算出来的**（表里 `max(done)=` 那一列就是它），这正是「推导」的证据。

**截两帧证明**（`evidence/exp-a/` 与 `evidence/exp-b/`）

| 帧 | 画面 |
|---|---|
| `exp-a/at-00-2_00s.png`（原时刻 t=2.00s） | 全图完整：`合成→编码` 这条边已经长出来（u=87.5%），编码节点已在位 |
| `exp-b/at-00-2_00s.png`（改晚后 t=2.00s） | 「合成」才刚浮现 17%，“增强→合成 / 混音→合成 / 合成→编码” **三条边一条都没有**；如果边写死时刻，这里就会看到线连到一个几乎不存在的节点上 |
| `exp-b/at-01-2_70s.png`（改晚后 t=2.70s） | 「合成」已完全浮现，三条边这时才长出来（u=100%），全片整体往后顺延 |

**逐帧不变式**（脚本对 150 帧逐帧扫）

```
A index.html：扫 150 帧，0 次违反 ✅
B late-node.html：扫 150 帧，0 次违反 ✅
边开始帧 − 最后一个端点完成帧（最小值）：A = 0 帧，B = 0 帧（≥0 即从未提前）
```

即：**没有任何一帧出现「边连着还没出生的节点」**。

---

## 5. 过渡态复核：节点先出现、边后连上

用 `--at 0.90,1.35,1.45` 抽了 3 帧（`evidence/transition/`），我逐张看过：

| 帧 | 时间 | 画面（肉眼） | 有没有「边连到不存在的节点」 |
|---|---|---|---|
| `at-00-0_90s.png` | 0.90s | 「素材」完全在位，「解码」刚完成，「分离」只浮出一半（半透明、略小）；**画面上一根线都没有** | 没有 —— `素材→解码` 的 t0 正好是 0.90，此帧 u=0 还不可见；`素材→分离` 要等 `done(分离)=1.05` |
| `at-01-1_35s.png` | 1.35s | 「增强」完全在位、右侧端口是**空圈**（放大图 `evidence/zoom-port.png`）；「合成」刚浮现约 50%（缩小 + 半透明）；从增强/混音进「合成」的两条边**一个像素都没有** | 没有 —— 端口空着，说明算法确实在等 `done(合成)=1.50` |
| `at-02-1_45s.png` | 1.45s | 放大图 `evidence/transition/zoom-145.png`：`素材→解码`、`素材→分离` 已长完并**正好接上**端口；`解码→增强` 长到约 62%、`分离→混音` 约 25%（都停在半路，「增强」右端口 /「混音」左端口仍是空的）；「合成」已接近满尺，它的端口也是空的 | 没有 —— 进「合成」的三条边要等 `done(合成)=1.50`，此帧尚未开始 |

（t=1.45 帧里各边的进度与 `buildPlan` 算出来的 `u = span(1.45, t0, t1)` 完全对得上：`素材→解码` 1.00、`素材→分离` 1.00、`解码→增强` 0.625、`分离→混音` 0.25、其余 0。同一帧里有两条边停在**不同**的进度上，说明各边各自服从自己的 `max(...)`，不是一整批同时画 —— 这是「边的时刻来自节点表」最直接的旁证。）

我还放大看了两条边的端口（`evidence/zoom-port.png`）：节点框、左侧色条、端口圆都画出来了，端口外**干净无残留**；数据包放大图（`evidence/zoom-packet.png`）里两个包都**精确压在曲线中心线**上（包的位置来自与路径同一张弧长表，不是另一套几何）。

---

## 6. 三方案对比

| | 主方案 `index.html` | variant-a `variant-a.html` | variant-b `variant-b.html` |
|---|---|---|---|
| 边怎么画 | SVG `<path>` + `stroke-dashoffset` | canvas 2D：生长段 60 段折线 `lineTo`，长完改用 `bezierCurveTo` 画真曲线 | SVG `<path>`：`M/H/V` 正交折线 + `Q` 倒圆角 |
| 曲线求长 | `getTotalLength()` 一次 | 自己按 60 段折线累计弧长 | `getTotalLength()` 一次 |
| 数据包定位 | 缓存弧长表（65 点） | 同一张折线弧长表 | 缓存弧长表（65 点） |
| 额外视觉 | 关键路径连通脉冲 + 节点扩环 | **流向箭头**（切线方向）+ 脉冲 + 扩环 | 正交边、方形节点、端口引线、脉冲 + 扩环 |
| 每帧成本 | 7×2 次属性写 + 2 次 dash 写 | `clearRect` + 每帧重描全部边（≤60 段×7）+ 箭头填充 + 圆点 | 同主方案 |
| 文字清晰度 | 原生 SVG 文本，最锐 | 节点仍是 SVG（只把边交给 canvas），同主方案 | 原生 SVG 文本 |
| 代码量 | 456 行 / 18.7 KB | 419 行 / 16.1 KB | 413 行 / 16.3 KB |
| 成片体积 | 254 KB | 277 KB | 227 KB |
| 观感 | 示意图：节点 + 平滑 S 曲线，最像「节点编辑器」 | 有明确流向箭头，**适合讲"数据往哪走"**；折线在 720p 下肉眼看不出与真曲线的差别 | **工程图/电路图**味道；正交路由占位规整、不浪费空间，但拐角让「生长」的推进不如曲线顺滑 |
| 适用 | 通用首选 | 需要强调流向、或要画在 canvas 上做后处理时 | 结构化管线、需要突出「列/层」时 |

**推荐主方案。** 理由：
1. 曲线出入是水平的，生长时「笔尖」的推进速度沿弧长均匀，看起来像被画出来；正交路由在拐角处切线突变，生长读感会"卡"一下。
2. SVG 属性写在 30fps 导出下最省 —— 没有每帧 `clearRect` 与重描；本机可用内存只有 ~0.9 GB，当时那台机内存不足，导出被迫 `--jobs 1`。出片按 SKILL.md 用 `$(nproc)`。
3. 三者共用同一份 `buildPlan()`（三份 HTML 里是同一段源码），所以边时刻推导这个"命门"在三个方案里都被验证了；换皮不换时间轴（承接可辨）。

variant-a 的价值在于它用**完全不同的弧长实现**（自己采样，不调 `getPointAtLength`）得到了同一个时间轴与同一套线形 —— 这反过来证明「边的时刻来自节点表」这件事与用什么渲染器无关。

---

## 7. 踩坑记录

### 7.1 canvas 的「脉冲亮段」一开始画成了整条边

variant-a 里我第一版写的是：

```js
CX.globalAlpha = 0.16; CX.lineWidth = 10;
strokePath(KE, a1);          // ❌ strokePath 画的是 [0, a1] 整段已生长部分
```

结果柔光段不是 `[a0, a1]` 那一小截，而是整条边从起点到脉冲头部全被加粗成橙色 —— 观感上像「整条关键路径都被点亮」，脉冲的前沿反而消失了（和 PATTERNS §1.3 里「用寿命百分比导致前沿消失」是同一类错误）。修法是补一个只画窗口的函数：

```js
function strokeSeg(E, a0, a1) {           // ✅ 只画弧长窗口
  var T = E.T, p0 = atLen(T, a0), p1b = atLen(T, a1);
  CX.beginPath(); CX.moveTo(p0.x, p0.y);
  for (i = 1; i <= SEG; i++) if (T.S[i] > a0 && T.S[i] <= a1) CX.lineTo(T.X[i], T.Y[i]);
  CX.lineTo(p1b.x, p1b.y); CX.stroke();
}
```

### 7.2 一条非法 CSS 声明被浏览器静默丢弃

variant-b 的图例里我打错了一个色值：

```css
.lg .ln { background: #8f8straight; }     /* ❌ 非法值，浏览器整条声明丢掉，不报错 */
```

页面不报错、控制台干净，但图例里的「正交边」样例线**完全不显示** —— 正是 AGENTS.md 说的「静默失败」。这类坑只能靠看图发现（我是在看 variant-b 的抽帧时发现图例里少了一根线才回头查的；修复后的图例见 `variants/qa-b/legend.png`）。

### 7.3 证据脚本自己先坏了：`new Function` 拿到 `undefined`

`evidence/derive.mjs` 第一版从 HTML 里抽函数源码时忘了写捕获组：

```js
const fnSrc = slice(src, /function buildPlan\(...\) \{[\s\S]*?\n  \}/, "buildPlan");  // 没有 ( )
// m[1] === undefined  →  new Function("return undefined")()  →  undefined
```

报错原文：

```
TypeError: v.buildPlan is not a function
    at frameAudit (…/evidence/derive.mjs:56:18)
```

修法：把整个模式包进捕获组 `/(function buildPlan…\n  \})/`。
之所以坚持「抽真身」而不是「在脚本里抄一遍 max 公式」，就是为了让这张证据表不可能与页面里跑的代码不一致 —— 抄一遍的脚本迟早会和页面漂移。

### 7.4 其它预防性决定（没出事，但值得写下来）

- `build()` 挂在 `window.load`：`getTotalLength()` 需要元素已经在 DOM 里；`seek.js` 的首次 `__reelSeek(0)` 发生在 load 之后两个 rAF，顺序是安全的。
- 全片没有任何每帧变化的**文本**：所有节点名 / 编号 / 页脚都是 load 时写一次。PATTERNS §6.1 的「字形缓存 1/255 抖动」只在每帧改 `textContent` 时出现，本片从结构上避开了它（当时的机器验收 的 determinism 三条全绿也印证了这一点）。
- 当时那台机总内存 3.6 GB、可用不足 0.9 GB，采集被迫 `--jobs 1`、串行。出片按 SKILL.md 用 `$(nproc)`。

---

## 8. 验收结论

（见本节末尾的 当时的机器验收 原始输出）

**我肉眼在 `sheet.png` / `qa/` 上确认的**：
- 首帧（t=0）：纸底网格 + 标题「节点图连线 · 素材处理管线」+ 图例 + 页脚，图上一个节点、一根线都没有 —— 是一张能当封面的空图纸。
- 中段：节点一个接一个浮现，连线随后从源节点端口「长」到目标节点；`qa-01`（t=1.25）里「合成」还没出生，通往它的线一根都没有。
- 关键路径高亮后：4 条关键边是青色并加粗，2 条非关键边（素材→分离、分离→混音）和两个非关键节点（分离、混音）淡到很浅，主次一眼可辨。
- 连通脉冲：`qa-03`（t=3.75）里橙色亮段正走在「增强→合成」上，同时「增强」有一个快散完的环、「合成」有一个刚扩开的环 —— 环与亮段同步。
- 末帧（t=4.995）：完整构图，关键路径高亮到位，数据包仍在流（稳定循环相位），没有回到第 0 帧。
- 中文没有豆腐块；标点在行内，没有行首标点。

### 十二条自评

| # | 检查项 | 自评 | 说明 |
|---|---|---|---|
| 1 | 主体唯一 | ✅ | 主体是「节点 + 连线生长」这一张图；数据包是它的附属，不抢戏 |
| 2 | 首帧成壳 | ✅ | t=0 是完整的图纸构图（网格/裁切标记/标题/图例/页脚） |
| 3 | 末帧成图 | ✅ | 关键路径高亮 + 数据包在流，构图完整、不回第 0 帧 |
| 4 | 节奏三段 | ✅ | 起手 0.45s → 生长 1.6s → 高亮 0.45s → 脉冲 1.1s → 稳态 1.1s，不是匀速 |
| 5 | 留白呼吸 | ✅ | 标题左 72px、图例右对齐到 1208px、节点最右边缘 1216px（距右边界 64px）、页脚距底 66px |
| 6 | 对比达标 | ✅ | 正文/页脚 18px、节点名 21px、标题 30px；墨色 #26262b 压纸底 #f2eee4，对比 ≈13:1 |
| 7 | 配色克制 | ✅ | 纸 + 墨 + 灰（中性）／青 #0d7a84（主）／橙 #f2681f（唯一强调色） |
| 8 | 排版有层级 | ✅ | 30 / 21 / 18 / 12px，相邻比 ≥1.4；索引编号右对齐到节点右上角，形成统一基准 |
| 9 | 动效不炫技 | ✅ | 每个动画都在讲一件事：节点出现顺序、边只能连已存在的节点、数据沿边流动、关键路径是谁 |
| 10 | 无装饰性扫光 | ⚠️→✅ | 连通脉冲是一条会动的亮段，容易被当成"扫光"；它承载信息：把整条关键路径从入口走到出口，等于声明"这条链是端到端连通的"，不是与内容无关的光带。若复核认为它读起来仍像装饰，删掉它只需去掉 §3.4 那一段代码，时间轴不受影响 |
| 11 | 承接可辨 | ✅ | 三个方案共用同一套皮（同一纸底/墨色/青橙）与同一份时间轴，只有"边怎么画"不同 |
| 12 | 中文排版 | ✅ | 全片中文都在单行内，无行首标点、无全角空格凑位 |

**达标 11 项（第 10 项按"信息承载"判为达标，但标注为最可能被复议的一项），≥8 项。**

当时的机器验收原始输出如下（机器验收已不在出片闭环）：
```
=== 验收 节点图连线 ===
[PASS] lint: .stage 尺寸与 REEL 一致 (1280x720)
[PASS] lint: 无 CSS animation（全部走 reelDraw/WAAPI）
[NOTE] lint: 有 2 处每帧改 DOM 文本（已知高负载下会引发字形栅格化 1/255 抖动；
              若 determinism 偶发失败，先查这里，改画进 canvas —— 见 故障文字/README.md §5.1）
[PASS] lint: REEL = 5s @30fps 1280x720
[PASS] mp4: 成片 1280x720 30.00fps 5.000s 150帧 254KB
[PASS] mp4: 全片解码无错误
[PASS] determinism: 同一 t 两次截帧逐字节一致（5 个采样点）
[PASS] determinism: 采样帧互不相同（5/5 唯一）
[PASS] determinism: 换 seek 路径同一 t 仍逐字节一致（先经 0/25% 到达 vs 直接到达）
[PASS] sheet: contact sheet（带帧号）
[PASS] density: 最长静止段 0.43s（13 帧）/ 静止占比 9%
[PASS] deliver: 有 README.md
[PASS] deliver: 有 index.html

结果: 0 FAIL / 0 WARN  ->  合格
```

**FAIL 0 / WARN 0。** 三条「确定性」（三条确定性）都在：

| 检查 | 结果 | 含义 |
|---|---|---|
| 同一 `t` 截两次逐字节一致 | PASS（5 个采样点） | 可复现 |
| **换 seek 路径**同一 `t` 一致 | PASS | 画面是 `t` 的函数，不是历史的函数 —— 数据包用取模相位、没有累加器的直接后果 |
| 静态 lint（无 rAF / `Date.now` / `setInterval` / `infinite` / `Math.random` / 外链字体） | PASS | 时间来源只有一个 |

`density: 最长静止段 0.43s / 静止占比 9%` 与设计完全对得上：0.00–0.45s 是起手静态壳（13 帧 ≈ 0.43s），此后节点错峰重叠（0.30s 浮现 / 0.15s 步进）一路不中断，收束段靠数据包维持画面运动。

**关于那条 `[NOTE]`（2 处每帧改 DOM 文本）**：这是 lint 的静态启发式误报。这 2 处 `textContent` 都在 `build()` 里（load 时给 7 个节点写一次标签与编号），**不在 `reelDraw` 里、不是每帧写**：

```bash
$ awk '/function build\(\)/,/^  }$/' index.html | grep -c textContent
2                      # 两处都在 build() 内部
```

PATTERNS §6.1 的抖动只在「每帧改字」时出现；本片从结构上避开了它，determinism 三条全绿也印证了这一点。NOTE 不计入判定。

**variant-a / variant-b 的成片**（`variants/qa-a/`、`variants/qa-b/`，各 5 帧）我也逐帧看过：两者时间轴、节点位置、配色与主方案完全一致，只有「边怎么画」不同 —— 变体只换皮，不换时间轴。

---

## 9. 复现命令

```bash
cd <工作区根>
D=<技能目录>/mechanics/节点图连线

# 推导对照实验（会自动重写 evidence/late-node.html）
# 已不在库里：node $D/evidence/derive.mjs

# 成片导出（--jobs $(nproc)，产物写 reel-out/；variants 已不在库里）
node <技能目录>/tools/capture.mjs "$D/index.html" --out "$PWD/reel-out/$(basename "$D").mp4" --qa-dir "$PWD/reel-out/$(basename "$D")-qa" --jobs "$(nproc)"
# variants 已不在库里：node <技能目录>/tools/capture.mjs $D/variants/variant-a.html     --out $D/variants/variant-a.mp4  --qa-dir $D/variants/qa-a --jobs 1
# variants 已不在库里：node <技能目录>/tools/capture.mjs $D/variants/variant-b.html     --out $D/variants/variant-b.mp4  --qa-dir $D/variants/qa-b --jobs 1

# 对照实验两帧
node <技能目录>/tools/capture.mjs "$D/index.html" --at 2.0 --qa-dir "$PWD/reel-out/$(basename "$D")-evidence-a"
# evidence html 已不在库里：node <技能目录>/tools/capture.mjs $D/evidence/late-node.html --at 2.0,2.7 --qa-dir "$PWD/reel-out/$(basename "$D")-evidence-b"

# 过渡态三帧
node <技能目录>/tools/capture.mjs "$D/index.html" --at 0.90,1.35,1.45 --qa-dir "$PWD/reel-out/$(basename "$D")-evidence-transition"

# 客观验收
# 当时的机器验收已不在出片闭环。出片按 SKILL.md。
```