# 特效 04 · 运镜与视差（camera / parallax）

> ⚠️ **本目录已于 2026-09-24 精简**：`variants/`、`qa/`、`probe/`、`evidence/`、`table/` 已按使用者决定删除，
> 现只保留 `index.html` + `README.md`；成片与过程产物不入库，需要时用 `capture.mjs` 从 `index.html` 重导。
> **下文提到的备选实现、取证帧与复现命令已不在磁盘上**，但**结论与实测数字仍然有效**
> （它们本来就是为了支撑这些结论才做的）。本库入口见 [`../INDEX.md`](../INDEX.md)。


**一句话**：黄昏山城 7 个深度层——远山雾脊 / 中景山脊 / 城市灯火 / 前景松林 / 最前景栏杆 / 漂浮尘埃——
由**同一个相机值**驱动位移与缩放，0.30s 起手轻推、1.00s 进入主体、4.45s 微过冲后定格；
layers 之间只差一个系数，永远对得齐。

```
index.html                 主方案（单相机值 + 每层系数，7 层）
out.mp4                    主方案成片 1280×720 / 30fps / 5.000s / 150 帧
qa/qa-00…04.png            截帧自检（首帧=完整静态壳，末帧=定格结束态）
probe/                     关键秒静帧（调参用，保留）
sheet.png                  contact sheet：15 格看全片
variants/variant-a.html    备选 A：CSS 3D perspective + translateZ + 真 3D 体块
variants/variant-a.mp4     备选 A 成片（同名规格）
variants/variant-b.html    备选 B：canvas 透视网格（相位 = travel % SPAN）
variants/variant-b.mp4     备选 B 成片
variants/sheet-a.png       备选 A 的 15 格 contact sheet（脚本另生成，见 §6）
variants/sheet-b.png       备选 B 的 15 格 contact sheet
```

复现：

```bash
cd <工作区根>
D=<技能目录>/mechanics/运镜视差
node <技能目录>/tools/capture.mjs "$D/index.html" --out "$PWD/reel-out/$(basename "$D").mp4" --qa-dir "$PWD/reel-out/$(basename "$D")-qa" --jobs "$(nproc)"
# variants 已不在库里：node <技能目录>/tools/capture.mjs $D/variants/variant-a.html --out $D/variants/variant-a.mp4 --qa-dir $D/variants/qa-a --jobs 2
# variants 已不在库里：node <技能目录>/tools/capture.mjs $D/variants/variant-b.html --out $D/variants/variant-b.mp4 --qa-dir $D/variants/qa-b --jobs 2
# 当时的机器验收已不在出片闭环。出片按 SKILL.md。
```

---

## 1. 常见写法为什么在这个 skill 里会坏，以及 seekable 改法

| 常见写法 | 坏在哪（本 skill 里会怎么死） | seekable 改法 |
|---|---|---|
| **每层各写一套 `@keyframes`**（各自的 delay / 缓动） | 层与层**永远对不齐**：缓动函数差一点就散架；而且 `reelSeek` 只看得到动画的当前时间，镜头曲线改一次要改 N 处 | **一个 `cam` + 每层系数 `f = 0.15 + depth`**，在**同一个** `reelDraw(t)` 里写一次（§2.1） |
| `animation: drift 8s infinite` 做云 / 粒子 | 验收器直接判 FAIL；`infinite` 的相位只取决于「页面开了多久」，与 t 无关，seek 过去是随机相位 | 循环量写成 `phase = (t*speed + phase0) % period`；本目录三个文件**一条 CSS animation 都没有** |
| 累加器做「前进」（`z += v*dt`、路面滚动、`drops[i]++`） | 必须知道上一帧；seek 到 3.0s 时无法从 0 重放，且帧率一变速度就变 | 对速度曲线做**解析积分**：`travel(t) = TOTAL·(2u³-u⁴)`，`u = span(t,0.30,4.45)`，再 `phase = travel % SPAN`（variant-b） |
| `Math.random()` 撒星点 / 粒子初相 | 每次截帧位置都不同 → 「同一 t 两次截帧逐字节一致」必挂 | `hash(i)` 纯函数（同一 i 永远同一结果）；三个文件共有 56+64 颗星、12 颗尘埃、40+ 棵松树，全部 hash 驱动 |
| `transition: transform .8s` 当镜头补间 | transition 是墙钟补间，seek 不会等它跑完 → 画面滞后于 t（`_shared/anti-patterns/a5`，verify 会 FAIL） | 全部走 `reelDraw`；本目录 **0 条 `transition`** |
| `requestAnimationFrame` + `Date.now()` 推进镜头 | 墙钟驱动，画面与 t 无关；连「同 t 两次截帧」都能骗过去（因为压根不动） | 不用 rAF；需要时只读 `window.__reelTime` |
| 改 `.stage` 的 `width/height` 来"推近" | 成片分辨率会跟着变，`.stage != REEL` 直接 FAIL | 只动 `.stage` 里 `.world`（以及各 `.layer`）的 `transform`，`.stage` 恒为 1280×720 |
| 「一层淡出、一层淡入」拼运镜 | 两个独立时间线，seek 后不同步 | 层位移只来自 `cam`；层的明暗是静态参数（空气透视），不参与时间轴 |

## 2. 关键技术点

### 2.1 单相机值：所有层共用同一个 `cam`，只差系数（主方案的核心）

```js
var F0 = 0.15;                                   // depth=0 的远景也保留 15%，避免"最远层完全不动"
function drawCam(c) {                            // c 由 camAt(t) 唯一算出，全片只有这一个相机
  for (var k = 0; k < LAYERS.length; k++) {
    var L = LAYERS[k], f = F0 + L.depth;         // depth: sky .00 far .06 mid .24 city .46 hill .66 rail .88 mote 1.00
    L.el.style.transform = 'translate3d(' + (c.x * f).toFixed(2) + 'px,' +
                           (c.y * f).toFixed(2) + 'px,0) scale(' + (1 + c.z * f).toFixed(6) + ')';
  }
  worldEl.style.transform = 'rotate(' + c.roll.toFixed(4) + 'deg)';  // 机身横滚同样只此一处
}
```

`translateX` 在 `scale` 左边 → 位移量不被缩放污染，于是「层间相对位移比例恒定」是**可验证的算术事实**，
不是观感。文件里留了自查钩子：

```bash
chromium --headless=new --no-sandbox --disable-gpu \
  --dump-dom "file://<技能目录>/mechanics/运镜视差/index.html#selftest" | grep -A60 'pre id="selftest"'
```

它把 6 个采样时刻、7 个层**实际写进 DOM 的 transform** 反算回来。实测（节选）：

```
t=2.50 camX=-113.9457 camZ=0.26587
   sky  depth=0.00 f=0.15 tx=-17.092 tx/camX=0.150000 (s-1)/camZ=0.150000
   rail depth=0.88 f=1.03 tx=-117.364 tx/camX=1.030000 (s-1)/camZ=1.030000
   mote depth=1.00 f=1.15 tx=-131.038 tx/camX=1.150000 (s-1)/camZ=1.150000
```

`tx/camX == (s-1)/camZ == 0.15 + depth`，6 位小数全中 → 「单相机驱动所有层」不是口号。

### 2.2 三段节奏：一个 e，三段接起来（rubric #4）

```js
var T_A0 = 0.30, T_A1 = 1.30, WA = 0.12;    // 起手：轻推 12%
var T_B0 = 1.00, T_B1 = 3.70, WB = 0.88;    // 主体：推近右移 88%
var T_C0 = 3.70, T_C1 = 4.45, WC = 0.04;    // 收束：+4% 过冲后回稳
function camEase(t) {
  var s = Math.sin(Math.PI * span(t, T_C0, T_C1));
  return WA * easeInOut(span(t, T_A0, T_A1))
       + WB * easeInOut(span(t, T_B0, T_B1))
       + WC * s * s;
}
```

两个细节是刻意的：

- **A/B 段重叠 0.30s**。若首尾相接（1.30 → 1.30），smoothstep 在两端导数都是 0，速度会在接缝掉到 0，
  看起来像"卡了一下"。重叠后 1.00–1.30s 两段同时加速，曲线单调、无顿挫。
- **收束用 `sin²`**：`sin²` 在 C=0 与 C=1 处导数都为 0 → 4.45s 到位即静止；
  中途（4.075s）e 冲到 1.040，再回落，末帧严格 1.000（`qa-04` 的 `EASE 1.000` 可证）。全程零抖动。

### 2.3 层的覆盖与几何：所有层都画成 1920×900，中心恰好落在画面中心

外层 `.layer` 是 `left:-320px; top:-90px; width:1920; height:900` → 它的**中心正好是 (640,360)**，
即画面中心，也是 `.world` 的 `transform-origin`。好处有三个：

1. 7 层的缩放/旋转基准点完全重合 → 不会出现"各层绕各自中心缩放"的错位；
2. 横向留 320px、纵向留 90px 余量，`scale` 最大 1.483 时四边仍然盖满；
3. 位移/缩放公式里不必出现 `transform-origin` 修正项。

远景/中景的"雾感"是 `feGaussianBlur`（2.6 / 1.0）加**颜色向天空色靠**：
`#7d6f9e @ .62` → `#4d4675 @ .9` → `#1b2140` → `#131a2f` → `#04060e`。
模糊走 SVG 滤镜而不是 CSS `filter`：滤镜是**静态栅格化一次**，之后每帧只改 transform，
不给 30fps 导出增加重绘压力。

### 2.4 太阳被山脊切掉一半：由山脊自己算出来，不是手调的

```js
var SUNX = 900, sunY = ridgeY(FAR, SUNX) + 16;   // 落日中心 = 远山脊线 + 16px
```
`ridgeY()` 在控制点之间线性插值。以后重调山形，太阳永远"半沉在山后"，不会飘到天上或埋进山里。

### 2.5 variant-b：透视网格的相位写法（取模，不是累加）

```js
var VMAX = 215, T_END = 4.45, DUR = T_END - 0.30;
var TOTAL = VMAX * DUR;                    // 892.25 世界单位
var CYCLES = 5, SPAN = TOTAL / CYCLES;     // 恰好在末帧走完整数个周期
function travelAt(t) {                     // ∫ smoothstep = u³ - u⁴/2，闭式
  var u = span(t, 0.30, T_END);
  return TOTAL * (2 * u * u * u - u * u * u * u);
}
// 第 k 条横线： z = k*SPAN - (travel % SPAN)
```
`travel % SPAN` 让网格**循环**却不依赖上一帧；`CYCLES = 5` 让末帧相位精确回到 `0.000`
（HUD 上第一格 `PHASE 0.000`、最后一格 `PHASE 0.000`），收尾是干净的结束态而不是随便停在半格。

## 3. 三方案对比

| | 主方案 index.html | variant-a.html | variant-b.html |
|---|---|---|---|
| 纵深手段 | 7 层 2D 伪视差：`translate + scale`，系数 `0.15+depth` | **真 3D**：`.world{perspective:1200px}`，层 `translateZ(-1150…-60)`，相机 = `.space` 的 `translate3d + rotateY + rotateX` | **几何投影**：canvas 针孔模型 `x=640+F((x-camX)/z - tanYaw)`，地平线 + 透视网格 |
| 遮挡关系 | DOM 顺序（近的层后画） | 真 3D 深度排序（`preserve-3d`），房子有正面/侧面/顶面 | 画家算法（远山→网格），网格在地平线以下 |
| 视差规律 | 近层位移大、远层位移小；**缩放中心是画面中心**，所以内容从画面右侧某点"扇开" | 平移 + 偏航两种规律**同时**成立：平移时近层走得快，`rotateY` 时远层扫得快（这才是真相机的样子） | 近处网格线几乎飞出去、远处贴住地平线；太阳几乎不动 |
| 观感 | 干净、可控，构图最好摆 | 有体积感，房子会"转出侧面"；代价是透视压缩让远景整体往画面中心挤 | 最有"前进"的生理冲击；但网格自相似，抽帧看容易显得"一直在动但没有故事" |
| 帧产物 | 7 个 `<svg>` 层 + 12 个粒子 div；每帧写 7 次 transform + 14 次属性 | 5 个 slab + 3 个体块（各 3 面）；每帧只写 1 次 `.space` transform | 每帧约 700 条 stroke（26 横线 + 27×9 纵线 + 18 跑道 + 22 虚线） |
| 代价 | 静态几何最多（山脊 64 点 ×3、楼群约 200 窗、40 棵松），但运行时最省 | 最贵：远景 slab 本地尺寸是 `1920×(1+Z/P)`，最大一张约 3758×2113 的栅格 | CPU 最贵（canvas 全量重绘）；三个文件里唯一不能"只改 transform"的 |
| 可读性 | 最好：一层一个 `<svg>`，坐标就是屏幕坐标 -320/-90 | 中：要同时读 design 空间、`P/(P+Z)` 缩放、face 的 3D 朝向 | 中：投影公式 10 行就够，但绘制循环长 |
| 复用性 | 最高：换成任何 7 层素材即可 | 高：slab 是 3D 版的主方案 | 低：整套投影要重写 |
| 适合 | 成片默认镜头运动 | 需要"东西有体积 / 会转出侧面"的镜头 | 标题段、合成波 / 赛博题材 |

**推荐：主方案。** 它把 SPEC 里"一个相机值驱动所有层"落成可验证的算术（§2.1），
构图最稳、运行时最省、复用性最好；variant-a 是它的 3D 升级版（有体积但要接受透视压缩），
variant-b 适合当片头/隔断，不适合全片（太自相似，看不出"镜头停在主体上"）。

## 4. 踩坑记录（都是实际撞到并修掉的）

1. **近景层会"沉出画面"**。`cam.y = +40` 且缩放以画面中心为原点时，末帧屏幕 y = `360 + (y0-360)×1.4326 + 41.2`。
   栏杆原按 svg y=720（屏幕 630）摆 → 末帧 780，**整根栏杆沉到画面外**，最强视差层反而在结尾消失。
   往上挪到 svg 578（屏幕 488，末帧 587）后，它整场留在下三分之一。**这个坑不做末帧映射计算是看不出来的。**
2. **variant-a 的窗格全变成通高黄条**。`background-image` 里**排在前面的在最上层**，我原本把"竖窗条"写在前、
   "横墙遮罩"写在后 → 遮罩被窗条盖住，每个盒子的整个正面都是黄条（第一版探针截图就是这样）。
   把遮罩换到第一条（`repeating-linear-gradient(180deg,#1b2140 0 14k,transparent 14k 24k)`）才对。
3. **variant-b 太阳的横栅看不见**。山脊线在屏幕 176~242，`r=98` 的太阳下半截正好被它盖住，而横栅就在下半截。
   修法两步：山脊在太阳所在世界 x≈180 处留一道**谷**（世界 y 520），并把太阳抬到 `scy = HOR-118` → 露出 3 条栅。
4. **variant-b 左边缘漏出天空亮带**。山脊第一个控制点在世界 x=-3200，投影到屏幕 x=57，于是屏幕 0~57 没有山，
   天空的橙色亮带直接落到"地平线"以下。控制点外扩到 ±5200 后消失。
5. **探针阶段前景粒子几乎看不见**（5px / opacity .22~.72 在 1280 宽里像脏点）。改成 7px + `0 0 20px 7px` 光晕 +
   opacity .30~.80，12 颗才读得出"镜头前的浮尘"，前景层才有了第四个视差信息。
6. **用 `chromium --dump-dom` 做自检时不要直接 grep 关键词**：dump 出来的是整篇 HTML（含 `<script>` 源码），
   `grep selftest` 先命中的是脚本里的注释行。要从 `<pre id="selftest">` 之后再取。

## 5. 验收结论

当时的机器验收已不在出片闭环。出片按 SKILL.md。
```
[PASS] lint: .stage 尺寸与 REEL 一致 (1280x720)
[PASS] lint: 无 CSS animation（全部走 reelDraw/WAAPI）
[PASS] lint: REEL = 5s @30fps 1280x720
[PASS] mp4: 成片 1280x720 30.00fps 5.000s 150帧 1242KB
[PASS] mp4: 全片解码无错误
[PASS] determinism: 同一 t 两次截帧逐字节一致（5 个采样点）
[PASS] determinism: 采样帧互不相同（5/5 唯一）
[PASS] sheet: contact sheet（带帧号）
[PASS] deliver: 有 README.md
[PASS] deliver: 有 index.html
结果: 0 FAIL / 0 WARN  ->  合格
```

三个 mp4 都另做了 `ffmpeg -f null -` 全片解码（无错误）与 `ffprobe`（均 1280×720 / 30fps / 150 帧 / 5.000s）。

### 我从 sheet.png / qa / variants/sheet-*.png 上肉眼确认了什么

**主方案 `sheet.png`（15 格，5×3）**

- 第 0–3 格（0–0.8s，`起手 · 广角`，EASE 0.000→0.238）：**15 格逐格看下来是完整构图**，
  山脊 / 太阳 / 高楼 / 松林 / 栏杆 / 尘埃六层都在位；红色塔尖信号灯压在落日前缘，是画面的锚点。
- 第 4–11 格（1.2–3.6s，`主体 · 推近右移`，EASE 0.308→0.89）：能直接看出**同一个镜头在动**——
  楼群整体变大右移、栏杆上移、太阳相对山脊左移；**塔尖从太阳右侧横穿到太阳左侧**，这是全片最直观的视差证据；
  山脊的明暗层次（远淡近浓）始终保持，没有哪一层跳出自己的深度。
- 第 12–14 格（4.4–5.0s，`收束 · 定格`，EASE 1.002→1.000）：三格几乎一致 —— 过冲 0.2% 后完全停住，
  末帧是稳定的结束态，不是闪回第 0 帧，画面里没有任何"进行中"的字样。
- 中文正常（Noto Sans CJK SC，无方框 / 豆腐块），`运镜与视差`「推近右移」等字样清晰；无溢出、无裁字。
- `qa/qa-00.png` 首帧即完整静态壳、`qa/qa-04.png` 末帧 `EASE 1.000`、`CAMERA X -180.0px Z 0.420 ROLL -0.90°`，
  与代码里的终值一致。

**variant-a `sheet-a.png`（15 格）**：0–3 格起手；4–14 格推进 + 偏航 5.5°，
三个体块的**侧面和顶面依次转出来**（真 3D 遮挡可见）；太阳相对远山几乎没有位移（远层平移小），
但山脊整体在偏航下明显左扫 —— 与主方案"近层走得快"的规律正好互为对照。

**variant-b `sheet-b.png`（15 格）**：横栅太阳始终在地平线上方，网格横线由远及近扫过，
跑道亮边与中线虚线把"前进"标死；HUD 的 `TRAVEL 0u → 892u`、`PHASE 0.000 → … → 0.000` 与画面同步。

## 6. 视觉质量评分表 —— 逐条自评

| # | 检查项 | 自评 | 依据 |
|---|---|---|---|
| 1 | 主体唯一 | ✅ | 全片只做一件事：一个镜头推近右移。锚点是「落日 + 塔尖」，其余五层都是纵深配角 |
| 2 | 首帧成壳 | ✅ | `sheet` 第 0 格即一张可当封面的完整黄昏构图；0–0.3s 相机完全静止（EASE 0.000） |
| 3 | 末帧成图 | ✅ | 第 14 格仍是完整构图；相位字「收束 · 定格」是结束态；相机定格 0.55s；无 LOADING 类字样 |
| 4 | 节奏三段 | ✅ | 起手 12% / 主体 88% / 收束 +4% 过冲回稳；A-B 段重叠 0.30s 避免顿挫；sheet 上前 4 格几乎不变、中 8 格剧变、后 3 格静止 |
| 5 | 留白呼吸 | ✅（有保留） | 所有文字距边 ≥64px（标题 72/64、相位右 72、读数左 72/下 64）；**风景本身是满幅出血**（山脊/栏杆触边），这是宽画幅建立镜头的刻意选择，不是文字顶格 |
| 6 | 对比达标 | ✅ | 正文（相机读数）18px `#c9d8f7`/数字 `#ffdfa4`，压深色天空；标题 36px 近白；最小字号是 12–13px 的等宽**注释行**，不是正文 |
| 7 | 配色克制 | ✅ | 深靛蓝 `#0b1334/#1d2450` + 暖橙金 `#d98b45/#ffd18a` + 近黑剪影 `#04060e`，强调色 `#ffdfa4` 与落日同族，共 3+1 |
| 8 | 排版有层级 | ✅ | 36 / 23 / 18 / 13 / 12 px，标题:正文 = 2.0；左栏全部 `left:72px`，右栏全部 `right:72px`，两条基线 |
| 9 | 动效不炫技 | ✅ | 唯一的"运动"是相机；其余是世界活性（窗光呼吸、塔灯闪、飞鸟、尘埃）各服务于"这是一座活的城"，没有旋转/弹跳/发光特效 |
| 10 | 无装饰性扫光 | ✅ | 全片没有 sweep / scanline / 光带；太阳的辉光标记落日方位，暖色带标记地平线，都承载信息 |
| 11 | 承接可辨 | ✅ | 单镜到底，三段共用同一构图与配色，塔尖-落日的关系连续演化，没有换皮 |
| 12 | 中文排版 | ✅ | 中文仅短标签，一行不折；无行首标点、无全角空格凑位 |

**12/12 达标**（第 5 条保留在"风景满幅出血"这一点上，如需可给山脊层加 64px 内缩遮罩）。
`variants/sheet-a.png`、`variants/sheet-b.png` 由 `ffmpeg -vf fps=3,scale=384:-2,tile=5x3` 单独生成
（verify 只对 `index.html + out.mp4` 出 sheet）。
