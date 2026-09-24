# 雷达 / 声呐扫描（radar sweep）· 特效 16

> ⚠️ **本目录已于 2026-09-24 精简**：`variants/`、`qa/`、`probe/`、`evidence/`、`table/` 已按使用者决定删除，
> 现只保留 `index.html` + `README.md`；成片与过程产物不入库，需要时用 `capture.mjs` 从 `index.html` 重导。
> **下文提到的备选实现、取证帧与复现命令已不在磁盘上**，但**结论与实测数字仍然有效**
> （它们本来就是为了支撑这些结论才做的）。本库入口见 [`../INDEX.md`](../INDEX.md)。


**一句话**：一个圆形雷达，同心圈 + 方位刻度 + 扫描扇形匀速旋转；扫描前沿扫到目标时该光点「亮起」并留下余辉，右侧列表在**同一时刻**同步长出那一条；转完一圈多之后扫描减速停住，五个目标全部常亮、列表完整。

```
雷达扫描/
  index.html            主方案（自包含单文件，成片源）     out.mp4      5.000s / 150 帧
  qa/                   capture 自动抽帧
  sheet.png             15 格缩略图（verify 生成）
  probe/                定点复核帧（0 / 1.0 / 2.5 / 3.7 / 4.96）
  variants/variant-a.html  SVG 雷达（<path> 扇形）          variant-a.mp4
  variants/variant-b.html  DOM + CSS conic-gradient 扇形    variant-b.mp4
  evidence/             独立复算 + 换路径负控 + 假 DOM 语法自检
  README.md
```

`REEL = { duration: 5.0, fps: 30, width: 1280, height: 720 }`

---

## 1. 核心：扫描角是唯一真值源

全片只有**一个**时间真值源 —— 累计转角 `Ω(t)`，扫描角是它的模：

```js
Ω(t) = ∫₀ᵗ ω(τ) dτ          ω 分段（0 → smoothstep 加速 → 峰值 → smoothstep 减速 → 0）
θ(t) = (θ₀ + Ω(t)) mod 2π    θ₀ = 0，Ω 单调不减
```

### 从 `ang = θ(t)` 派生的 5 个量（外加第 6 个）

| # | 派生量 | 公式 |
|---|---|---|
| ① | **扫描扇形的前后沿几何** | 第 i 片扇区恒跨 `[ang-(i+1)SW, ang-iSW]`，`SW = TRAIL/SLICES` |
| ② | **余辉尾巴（含每个光点的余辉）** | 落后角 `Δθ = (ang - aᵢ) mod 2π`，亮度 `= exp(-Δθ / 0.62)` |
| ③ | **光点是否已被扫亮** | 累计扫过次数 `passes = floor((Ω - aᵢ)/2π) + 1`，`≥1` 即已捕获（不是布尔状态） |
| ④ | **圈数读数 REV** | `floor(Ω / 2π)` |
| ⑤ | **方位读数 BEARING** | `ang / DEG`（0–359.9°，跨 360 自动回绕） |
| ⑥ | **右侧列表第 i 条的入场时刻** | `tᵢ = Ω⁻¹(aᵢ)`（Ω 单调不减 → 48 步二分反解），入场进度 `span(t, tᵢ, tᵢ+0.6)` |

③ 的累计圈数写法比布尔标志强在：目标被**重扫**时会再闪一次（片尾 T-01 在 Ω=402° 又亮一次），
不需要任何额外状态；而且它对 seek 天然正确 —— `floor()` 是 `Ω` 的纯函数。

### 解析式余辉（不允许覆盖式）

```js
// ✅ 某点的亮度 = f((ang - 该点方位角) mod 2π)
var age  = mod2pi(ang - A[i]);           // 落后前沿的角差
var glow = Math.exp(-age / REV_DECAY);   // REV_DECAY = 0.62 rad ≈ 35.5°
var al   = captured ? Math.max(0.52, glow) : 0.20;   // 0.52 = 「已捕获」常亮地板

// ❌ 覆盖式（跨帧状态，seek 必坏）
// trailCtx.fillStyle = 'rgba(0,0,0,0.14)'; trailCtx.fillRect(...)   // 每帧把上一帧压暗
```

覆盖式的问题不是「不好看」，而是**画面成了「被调用过多少次 / 间隔多久」的函数，不是 `t` 的函数**：
seek 到 `t=2.5` 之前经过多少个采样点，尾巴长度就不同。§4 给了最小对照实证。

---

## 2. 常见写法为什么在本 skill 里会坏

| 常见写法 | 坏在哪 | 本 skill 的 seekable 改法 |
|---|---|---|
| `ang += ω * dt` | 累加器。ω 不是常数，`ang` 变成调用次数的函数 | `Ω(t)` **闭式分段积分**（`∫ω·ss = ω·W·(u³-u⁴/2)`），`θ = Ω mod 2π` |
| `ctx.fillStyle='rgba(0,0,0,.15)'; fillRect()` 做余辉 | 覆盖式拖尾，依赖上一帧画布 | 每片扇区亮度 `exp(-Δθ/0.62)`，整条尾巴每帧从 `ang` 重画 |
| `animation: spin 2s linear infinite` | `infinite` 被 lint 直接判 FAIL；而且 seek 后相位不可控 | 全片零 CSS animation，只有 `reelDraw(t)` |
| `transition: transform 1s` 转扇形 | 墙钟补间，seek 不会等它跑完 | 同上 |
| `target[i].lit = true` 布尔状态 | 「已亮」与「何时亮」两条时间线，seek 后会错 | `passes(Ω, aᵢ) ≥ 1`，且入场进度用 `Ω⁻¹(aᵢ)` 反解的时刻 |
| `Math.random()` 放目标方位 | 每次加载目标位置都不同 | 字面量数组 `A_DEG = [42,128,205,296,350]` |
| CSS 动扇形 + JS 动读数 | 两条独立时间线，seek 后对不上（同一量只能有一个真值来源） | 读数与扇形在**同一次** `reelDraw(t)` 里算出来 |
| 每帧 `el.textContent = 角度` | Chromium 字形栅格化 1/255 抖动（PATTERNS §6.1） | 主方案把全部文字画进 `<canvas>`；两个 variant 改成**几何指示器**（指针 / 格数），一个字的文本都不改 |
| `Date.now()` / 无时钟 rAF / `setInterval` | 时间来源不唯一 | 只有 `reelDraw(t)` |

`SKILL.md` 说「扫光/扫描线被看成分割线，或只是与内容无关的装饰时，删掉」。
本特效是**反例的正面版**：扫描角不是装饰，它是唯一真值源 —— 目标何时亮、列表何时出、
圈数读数是多少，全部是「扫描前沿有没有越过这个方位角」的推论。删掉扇形，画面就没了因果。

---

## 3. 关键技术点（主方案核心代码）

### 3.1 解析积分 + 反解（`index.html`）

```js
var T_HOLD = 0.40, T_RAMP = 1.10, T_DEC0 = 3.60, T_DEC1 = 4.60, W_PEAK = 2.1625;
var WB = T_RAMP - T_HOLD, WD = T_DEC1 - T_DEC0;
var OB = W_PEAK * WB * 0.5;                 // 43.37°   ∫ω·ss(u)   = ω·WB·Fs(1) = ω·WB/2
var OC = OB + W_PEAK * (T_DEC0 - T_RAMP);   // 353.12°  + 匀速段
var OD = OC + W_PEAK * WD * 0.5;            // 415.07°  ∫ω·(1-ss) = ω·WD·(1-Fs(1)) = ω·WD/2
function Fs(u) { return u*u*u - 0.5*u*u*u*u; }   // ∫smoothstep，闭式
function Omega(t) {
  if (t <= T_HOLD) return 0;
  if (t < T_RAMP) return W_PEAK * WB * Fs((t - T_HOLD) / WB);
  if (t < T_DEC0) return OB + W_PEAK * (t - T_RAMP);
  if (t < T_DEC1) { var u = (t - T_DEC0) / WD; return OC + W_PEAK * WD * (u - Fs(u)); }
  return OD;                                  // 末帧冻结 → 定格 0.4s
}
function passes(Om, a) { return Math.floor((Om - a) / TAU) + 1; }   // 累计扫过次数
var HIT_T = A.map(function (a) {              // 列表入场时刻 = Ω 的反解（同一个 Ω）
  var lo = 0, hi = 5, k;
  for (k = 0; k < 48; k++) { var m = (lo + hi) * 0.5; if (Omega(m) < a) lo = m; else hi = m; }
  return hi;
});
```

`ω` 只在「状态文案」里用到（`ω = 0.00 rad/s` ↔ `锁定 LOCKED`），位置一律走 `Omega()`。

### 3.2 扇形余辉：角向 × 径向分离

角向走解析式，径向走一张 **load 时建好的** 渐变 —— 两者相乘，没有硬环、没有覆盖：

```js
SWPG = ctx.createRadialGradient(CX, CY, R * 0.06, CX, CY, R);
SWPG.addColorStop(0.00, 'rgba(255,164,54,0.13)');
SWPG.addColorStop(0.52, 'rgba(255,164,54,0.20)');
SWPG.addColorStop(0.80, 'rgba(255,164,54,0.36)');
SWPG.addColorStop(1.00, 'rgba(255,164,54,0.31)');

ctx.globalCompositeOperation = 'lighter';
for (i = SLICES - 1; i >= 0; i--) {
  back = (i + 0.5) * SW;
  ctx.globalAlpha = Math.exp(-back / REV_DECAY);      // ← 角向：解析余辉
  if (ctx.globalAlpha < 0.02) continue;
  ctx.beginPath();
  ctx.arc(CX, CY, R,  ang - (i+1)*SW - HALF_PI, ang - i*SW - HALF_PI);
  ctx.arc(CX, CY, rIn, ang - i*SW - HALF_PI, ang - (i+1)*SW - HALF_PI, true);
  ctx.closePath();
  ctx.fillStyle = SWPG; ctx.fill();                   // ← 径向：同一张缓存渐变
}
```

### 3.3 光点 = 解析余辉 + 爆闪环，都从 `age` 派生

```js
age  = mod2pi(ang - A[i]);
glow = Math.exp(-age / REV_DECAY);     // 0.62 rad 的余辉
ping = Math.exp(-age / PING_DECAY);    // 0.22 rad 的爆闪
cap  = passes(Om, A[i]) >= 1;
al   = cap ? Math.max(0.52, glow) : 0.20;
ctx.arc(tp.x, tp.y, 7 + (1 - ping) * 30, 0, TAU);   // 扩散环半径也是 age 的函数
```

**重扫会自动再爆闪一次** —— 不需要「事件表」，因为 `age` 本身在每圈归零。

### 3.4 时间轴（唯一的另一组字面量）

| 时刻 | 事件 | 画面 |
|---|---|---|
| 0 – 0.40 | 静止壳（ω=0） | 盘 / 圈 / 刻度 / 5 个未亮光点 / 空列表全在位，扫描线停在 000° |
| 0.40 – 1.10 | smoothstep 加速 | ω: 0 → 2.16 rad/s，前沿开始走 |
| 1.089 / 1.783 / 2.405 / 3.139 / 3.575 | **5 次捕获** | 光点按方位角被依次扫亮，列表同步长出该条 |
| 1.10 – 3.60 | 峰值 2.16 rad/s（123.9 °/s） | 主体扫描段 |
| 3.60 – 4.60 | smoothstep 减速 → 0 | 前沿滑到 415.07°（θ=55.07°），4.08s 时 T-01 被重扫再亮一次 |
| 4.60 – 5.00 | Ω 冻结 | 定格：全部常亮、列表 5/5、状态 `锁定 LOCKED`、ω=0.00 |

---

## 4. 三个方案对比

| | **index.html（主方案）** | variant-a（SVG） | variant-b（DOM+CSS） |
|---|---|---|---|
| 雷达怎么画 | `<canvas>`，每帧 36 片扇区 × `fill()` | SVG：64 片**嵌套** `<path>`，整组只改 **1 个 `transform`** | DOM：`conic-gradient` 扇形 + `radial-gradient` mask |
| 余辉怎么来 | 角向 `exp(-Δθ/0.62)` × 径向缓存渐变 | 剖面刚性附着前沿 → opacity **load 时算一次** | conic 的 47 个 stop 在 load 时按同一条解析式采样 |
| 每帧写几次 DOM/canvas | ~90 次 `fill/stroke` + 若干 `fillText` | **1 次** `setAttribute('transform')` + ~140 次小属性 | ~105 次 style 写 + 每帧重解析 47 stop 的 conic |
| 读数呈现 | canvas `fillText`，**有具体数字** | 指针 + 格数（几何指示器） | 指针 + 格数（几何指示器） |
| 复用性 | 中：几何/配色都硬编码在 canvas 里，改色要动代码 | 高：`<path>`/`<circle>` 是 DOM，CSS 可直接改色 | 最高：皮全在 CSS，扇形只靠一条 `conic-gradient` |
| 可读性 | 中：绘制顺序即语义顺序 | 中：结构清楚，但 64 片重复元素噪音大 | 高：HTML 结构 + CSS 一眼看懂 |
| 清晰度 | 最好（`lighter` + 缓存渐变，无接缝） | 好：嵌套层边界干净，角向有 ~5% 的 64 级台阶 | 好：有轻微 mask 边缘 |
| 依赖风险 | 无 | 无 | 依赖 `mask-image` + `mix-blend-mode: screen`（headless 实测可用，但属于需要实测的能力） |

实测（同机、`--jobs 1`、包含 ffmpeg 编码的全量导出 150 帧）：

| 方案 | 全量导出墙钟 | 每帧的「写入次数」（静态数出来的） |
|---|---|---|
| index.html | 110 s | ~180 次 canvas 绘制调用（36 片 `fill` + 前沿 3 次 + 5 个光点 + 面板约 50 + 仪表约 12） |
| variant-a | 117 s | **1 次** `transform` + ~112 次小属性（64 片 path 只重栅格化，不重写属性） |
| variant-b | 97 s | 1 次 `conic-gradient` 字符串（47 个 stop 每帧重解析）+ ~124 次 style 写 |

> **墙钟时间不能当 CPU 指标**：97–117s 的差异主要来自 CDP 截图 / PNG 编码 / x264，
> 不是页面渲染；本机同时还有别的子代理在跑 capture，这个数字波动很大。
> 真正有意义的对比是「每帧写多少次」：variant-a 靠「剖面刚性附着前沿」把 64 片退化成 1 次写，
> 是三者里 DOM 写最少的一个 —— 但它仍然要重栅格化 64 个 `<path>`。

### 推荐

**推荐主方案 `index.html`**：

1. 它是三者里唯一把「角向 + 径向」两条曲线都做到连续无台阶的（一张缓存径向渐变 × 逐片 `globalAlpha`），
   细节最干净；而且文字走 canvas，天然规避 §6.1 的字形栅格化非确定性 —— verify 的三条确定性一次通过。
2. 性能足够（见上表），单帧 36 次 `fill` 没有压力。
3. 代价是复用性最差：换配色要改 JS。若以后要做成可换皮组件，应当**抄 variant-b 的皮**、
   抄 variant-a 的性能技巧（见下）。

**variant-a 的这个技巧值得单独抄走**：因为余辉剖面**刚性附着在扫描前沿上**，
「第 i 片落后多少度」与 `t` 无关，所以整套 opacity 可以在 load 时算一次，
每帧只写一个 `transform`。解析式拖尾相对覆盖式拖尾的**额外红利**就是这个 —— 
SVG 版因此成为三者中每帧 DOM 写最少的一个。它的缺点是 64 级角向台阶（约 5%）和几何化读数。

**variant-b 适合当模板**：代码最短、皮最好改；但它每帧要重解析一条 47 stop 的 conic-gradient，
且依赖 `mask-image` / `mix-blend-mode` 两个需要实测的渲染能力。

---

## 5. 踩坑记录（都是实际撞到并修掉的）

### 5.1 `var lab` 把 `function lab()` 覆盖掉 → SVG 版只画出静态壳

**症状**：variant-a 在 `--at 0 / 2.5 / 4.96` 截出来的 PNG **sha256 完全相同**，而且都是「t=0 的静态画面」：
键盘/刻度/列表都在，标题和仪表整块不见了，指针停在 000°。

**根因**：目标循环里写了 `var lab = E('text', ...)`（元素），下半段又写了
`function lab(x, y, str, anchor)`（工具函数）。函数声明被提升，但循环跑完之后
`lab` 这个**变量**已经被赋成 SVG 元素，于是调用点报：

```
TypeError: lab is not a function
    at <anonymous>:176:3
```

异常发生在 `gHud` / `gT` 建好之前 → `window.reelDraw` 从未定义 → 页面永远停在初始 SVG。

**怎么抓到的**：写了一个假 DOM（`evidence/domcheck.mjs`，把 `document.createElementNS` /
`setAttribute` / `appendChild` / `getContext` 做成最小替身，并检查 `setAttribute` 里没有
`undefined`/`NaN`）离线跑一遍页面脚本，异常立刻现形：

```
# 已不在库里：for f in index.html variants/variant-a.html variants/variant-b.html; do node evidence/domcheck.mjs $f; done
index.html                 OK: 脚本无异常，reelDraw 在 6 个 t 上跑通
variants/variant-a.html    OK: 脚本无异常，reelDraw 在 6 个 t 上跑通
variants/variant-b.html    OK: 脚本无异常，reelDraw 在 6 个 t 上跑通
```

**这个自检值得保留**：canvas 版出错会白屏，DOM/SVG 版出错只缺一块，肉眼很容易漏。

### 5.2 `∫₀ᵗ` 在 Noto 里是豆腐块

**症状**：画面底部公式读成 `θ(t) = (θ0 + ∫▯▯ω dτ) mod 2π`，两个方框。

**根因**：`₀`(U+2080) 与 `ᵗ`(U+1D57) 不在 `Noto Sans Mono CJK SC` 的覆盖范围内，
canvas `fillText` 直接画成 .notdef 方框。
**修法**：把上下标全部换成 ASCII（`θ0`、`∫ω`）。裁图放大确认过没有残留方框。

### 5.3 SVG 扇形：相接出暗缝，描边补缝又变成亮线

**症状 A**：24 片首尾相接的 `<path>` 做角向渐变 → 每条共边都有一条暗色细缝（抗锯齿各出一半覆盖率），
远看像一把 24 骨的扇子。
**症状 B**：给每片加 `stroke="url(#gSwp)" stroke-width="1"` 去补缝 → 相邻两片**都**描这条边，
叠加后变成 64 条**亮线**，比原来更难看。

**修法**：楔形改成**嵌套**（第 i 片恒跨 `[前沿-(i+1)SW, 前沿]`，大而暗的先画），
边界就只剩「上层盖下层」的单条边，没有共边问题。叠加公式
`α_visible(区域 j) = 1 - Π_{i≥j}(1-a_i)` 反解出每层透明度：

```js
tj  = 0.55 * Math.exp(-j * SW / REV_DECAY);
tj1 = 0.55 * Math.exp(-(j + 1) * SW / REV_DECAY);
aj  = 1 - (1 - tj) / (1 - tj1);        // 逐层解得目标剖面
```

### 5.4 canvas 扇形内外带之间出现硬环

**症状**：主方案第一版把扇形分「内带 (0.08R–0.62R) / 外带 (0.62R–R)」两档画，两档之间
在 0.62R 上留下一条很硬的圆弧分界，看着像画错了。
**修法**：改成「一张缓存的径向渐变 × 逐片 `globalAlpha`」——角向由 `globalAlpha` 承担、
径向由渐变承担，两边都连续。

### 5.5 CSS `radial-gradient` 的 100% 不是圆盘边缘

**症状**：variant-b 的余辉径向剖面明显不对（外圈偏暗、亮带位置偏内）。
**根因**：`radial-gradient(circle at 50% 50%, …)` 的默认尺寸是 **farthest-corner**：
472px 的方盒里它是 333.8px，而圆盘半径只有 236px = **70.7%** —— 我的 stop 有 30% 落到了盘外。
**修法**：显式写 `circle closest-side at 50% 50%`，让 100% 正好等于内切圆半径。

### 5.6 variant-b 的光点标签被推到 2 倍半径处

**症状**：`T-01 / T-02 / T-03` 飘到画面上方、右侧、下方的莫名其妙的位置。
**根因**：标签挂在 `.tg` 里，而 `.tg` 的原点**已经**在目标点上了；我却又写了
「半径 r+16 的绝对偏移」，于是总位移 ≈ 2r。
**修法**：只给「相对目标点」的偏移：`lx = sin(a)·(r+16) - tx`。

---

## 6. 验收结论

当时的机器验收已不在出片闭环。出片按 SKILL.md。
```
[PASS] lint: .stage 尺寸与 REEL 一致 (1280x720)
[PASS] lint: 无 CSS animation（全部走 reelDraw/WAAPI）
[PASS] lint: REEL = 5s @30fps 1280x720
[PASS] mp4: 成片 1280x720 30.00fps 5.000s 150帧 586KB
[PASS] mp4: 全片解码无错误
[PASS] determinism: 同一 t 两次截帧逐字节一致（5 个采样点）
[PASS] determinism: 采样帧互不相同（5/5 唯一）
[PASS] determinism: 换 seek 路径同一 t 仍逐字节一致（先经 0/25% 到达 vs 直接到达）
[PASS] sheet: contact sheet（带帧号）: …/雷达扫描/sheet.png
[PASS] density: 最长静止段 0.40s（12 帧）/ 静止占比 17%
[PASS] deliver: 有 README.md
[PASS] deliver: 有 index.html

结果: 0 FAIL / 0 WARN  ->  合格
```

三条「确定性」是三种不同的东西，这里都单独过了：

| 检查 | 本片结果 | 说明 |
|---|---|---|
| 同一 `t` 截两次逐字节一致 | ✅ 5/5 个采样点 | 可复现 |
| 换 seek 路径同一 `t` 一致 | ✅ | 真值是 `t` 的函数（抓累加器） |
| 静态 lint（禁 rAF / Date.now / setInterval / infinite / transition / Math.random） | ✅ 无 CSS animation | 时间来源只有一个 |

`density` 的 0.40s / 17% 与时间轴吻合：起手静止壳 0.4s + 收尾定格 0.4s，都是**设计要的**，
低于 1.0s 的 WARN 线。

### 肉眼复核（sheet.png 当 15 张封面看）

- 0–1 格：**完整静态壳**。雷达盘、4 条同心圈、12 根辐条、36 个刻度、000/090/180/270 方位字、
  5 个未亮光点（空心小圈）、空列表 5 行（`待扫描`）、读数 `000° / 圈数 0 / 0/5`、状态 `待机 STANDBY`。
  扫描线停在 000°，**余辉尾巴在它后方、朝逆时针铺开约 137°**（t=0 就满长，长度全程恒定）。
- 2 格 `014°`：前沿刚离开 000°，尾巴跟着转；仍是 0/5。
- 3 格 `050°`：T-01 刚被扫亮（爆闪环 + 行高亮），列表第 1 条长出，`1/5`。
- 5 格 `138°`：T-02 亮，`2/5`。
- 7 格 `225°`：T-03 亮，`3/5`。
- 9 格 `312°`：T-04 亮，`4/5`。
- 10 格 `353°`：T-05 亮，`5/5`。
- 11–12 格 `031°/052°`：`REV` 从 0 翻到 **1**（Ω 越过 2π 的时刻 t=3.656s），进入减速段。
- 13–14 格 `055°`：**末帧定格**。ω=0.00，状态 `锁定 LOCKED`，5/5 全亮，T-01 带着最新余辉，
  连线指向它那一行；尾巴稳定地从 278° 铺到 55°。不是全黑，也没有回到第 0 帧。

定点复核帧（`probe/`，`--at 0.0 / 1.0 / 2.5 / 3.7 / 4.96`，我用 `read_image` 逐张看过）：

| t | θ | Ω | REV | 捕获 | 尾巴范围 | 画面 |
|---|---|---|---|---|---|---|
| 0.00 | 000° | 0° | 0 | 0/5 | 222° → 000° | 静态壳，线在正上方 |
| 1.00 | 031° | 031° | 0 | 0/5 | 254° → 031° | 刚开始转，还没扫到任何目标 |
| 2.50 | 217° | 217° | 0 | 3/5 | 079° → 217° | 尾巴在**线后方**（顺时针方向的后面），长度 137.5° 不变 |
| 3.70 | 005° | 365° | 1 | 5/5 | 228° → 005° | 刚跨过 000°，T-05 最新捕获、行星环还在扩 |
| 4.96 | 055° | 415° | 1 | 5/5 | 278° → 055° | 末帧定格，全亮，不是全黑 |

### 换路径负控（`evidence/`，实测输出）

同一套 Ω(t)，只把余辉换成覆盖式，其余逐字相同：

```
trail-analytic.html   路径 A（0 → 1.25 → 2.5）: 46a9f6e099e1ff6cca24
                      路径 C（第一次 seek 直奔 2.5）: 46a9f6e099e1ff6cca24   → 一致 ✅

trail-accum.html      路径 A（0 → 1.25 → 2.5）: b75151115bff5cb78a8c
                      路径 C（第一次 seek 直奔 2.5）: 5f51ed87c09e3bbe257d   → 不一致 ❌
```

当时用 `evidence/path-check.mjs` 跑了 4 次串行 capture（约 40s）；这些脚本已不在库里。
另有 `evidence/phase.mjs` 用独立脚本重算 Ω、5 个捕获时刻、末帧余辉与逐帧读数表，
可与画面一一核对。

---

## 7. 视觉质量评分表（自评）

| # | 检查项 | 自评 | 依据 |
|---|---|---|---|
| 1 | 主体唯一 | ✅ | 一眼是「雷达在扫」，扇形是唯一运动主体 |
| 2 | 首帧成壳 | ✅ | t=0 盘/圈/刻度/光点/列表/读数全在位，扫描线停在 000° |
| 3 | 末帧成图 | ✅ | 定格 0.4s：5/5 常亮、`锁定 LOCKED`、ω=0.00，界面完整 |
| 4 | 节奏三段 | ✅ | 0.4s 静止壳 → 加速/峰值 → 减速 → 定格；ω 从 0 到 2.16 再回 0 |
| 5 | 留白呼吸 | ✅ | 左 64 / 右 64 / 上 70 / 下 64px；盘右缘 608 与面板 676 留 68px |
| 6 | 对比达标 | ✅ | 标题 36px、行名 18px、方位 12px、注释 11px；`#dceaf2`/`#6d93a3` on `#04101a` |
| 7 | 配色克制 | ✅ | 深海军蓝底 + 青灰网格 + 琥珀强调（3 主色 + 中性文字） |
| 8 | 排版有层级 | ✅ | 36 / 19 / 18 / 12 / 11，标题与正文比 2.0；面板左右两栏同基线 |
| 9 | 动效不炫技 | ✅ | 只有扇形旋转、光点余辉/爆闪、列表入场；每个都在讲「扫到哪了」 |
| 10 | 无装饰性扫光 | ✅ | 扇形承载方位与进度：目标点亮时刻、圈数、列表入场全部由它推出 |
| 11 | 承接可辨 | ✅ | 单一构图贯穿全片，只有内容在长 |
| 12 | 中文排版 | ✅ | 无孤行标点、无全角空格凑位；公式里的上下标已改 ASCII |

**12/12 达标**（要求 ≥8）。

## 8. 两条给未来的备注

1. **场景内仪表规则**：本片里的「方位 / 圈数 / 已捕获 / 状态」是**场景内仪表**（与扇形同源，
   末帧到终点值 5/5、状态是结束态 `锁定 LOCKED`、分母用字面量 `T_DEC1 = 4.60` 而不是
   `t / REEL.duration`）。如果以后要把多个特效 concat 成整片，这些仪表应当改走 kit 的
   `gbar.json` + `REEL.offset`，否则会和 kit 的底栏打架。本片**没有**写 `gbar.json`、没有字幕、没有音轨。
2. 目标名、方位、`距离 x.xx R`、信号格数都是**示意数据**，画面右下角已标 `示意数据 · SCHEMATIC`；
   它们不是任何真实测量值。