# 特效 12 · 印章盖下（STAMP IMPACT）

> ⚠️ **本目录已于 2026-09-24 精简**：`variants/`、`qa/`、`probe/`、`evidence/`、`table/` 已按使用者决定删除，
> 现只保留 `index.html` + `README.md`；成片与过程产物不入库，需要时用 `capture.mjs` 从 `index.html` 重导。
> **下文提到的备选实现、取证帧与复现命令已不在磁盘上**，但**结论与实测数字仍然有效**
> （它们本来就是为了支撑这些结论才做的）。本库入口见 [`../INDEX.md`](../INDEX.md)。


> 一枚朱砂印章从画面上方加速落下，在 **t = 1.350s** 这一个精确时刻接触纸面；
> 接触瞬间画面震动、一圈冲击波扩散、印泥从边缘向外渗开、印缘毛边被挤开、纸屑飞出、
> 纸面受压起一道涟漪；随后印章「变成」一枚已经盖好的印迹。
> 1280×720 / 30fps / 5.0s。

产出三个可 seek 的方案（三者的 `T_IMPACT` 逐字相同，都是 `1.35`）：

| 文件 | 做法 | 成片 |
|---|---|---|
| `index.html` | **字面量冲击时刻 + canvas 确定性毛边 mask** | `out.mp4` |
| `variants/variant-a.html` | **SVG `feTurbulence` × 2 级 `feDisplacementMap` 毛边** | `variants/variant-a.mp4` |
| `variants/variant-b.html` | **逐像素坐标扭曲墨渗（canvas ImageData）** | `variants/variant-b.mp4` |

配套缩略图阵列：`sheet.png`（主）/ `variants/sheet-a.png` / `variants/sheet-b.png`；
关键秒静帧：`probe/`（含冲击前后三帧）；抽帧：`qa/`、`variants/qa-a/`、`variants/qa-b/`。

---

## 1. 核心：`T_IMPACT` 必须是一个字面量常量

这是本特效唯一的、也是最重要的教学点。

```js
var T_DROP   = 0.55;   // 印章开始下落
var T_IMPACT = 1.35;   // ★ 接触时刻 —— 字面量，全片唯一「事件」
var T_TAIL   = 0.55;   // 冲击瞬态窗口长度
var T_SETTLE = 4.85;   // 墨渗/余振真正停止的时刻（末帧终点值在这里已满）
```

**为什么不能「检测碰撞」**：`capture.mjs` 是**逐帧 seek** 的 —— 它会直接跳到 `t = 3.17`
去渲染第 96 帧。如果代码写成

```js
// ❌ 在 seek 架构里必然坏掉
if (sealY >= paperY && !hit) { hit = true; shakeAcc = 6; shockProgress = 0; }
```

那么 `t = 3.17` 那一帧根本不会经过「下落 → 接触」的过程，`hit` 永远是 `false`，
震动、冲击波、墨渗全都不会出现。这跟「掉帧」无关，是**架构性的**：
`f(t)` 里不允许有 `f(上一帧)`。

**seekable 改法**：把接触时刻写成常量，之后所有派生量都相对它归一化：

```js
var u  = span(t, T_IMPACT, T_IMPACT + T_TAIL);   // 冲击瞬态 0→1
var us = span(t, T_IMPACT, T_SETTLE);            // 慢过程   0→1（墨渗）
```

只要「接触」在时间轴上被钉死成一个数，任意 `t` 都能一次算清这一帧。

## 2. 冲击之后的 6 个派生量，全部写成 `f(u)` / `f(us)`

> 要求：冲击后的一切都必须是 `u = t − T_IMPACT` 的函数，**不允许累加、不允许逐帧衰减**。
> 下面是全部派生量的闭式表
> （`u = span(t,1.35,1.90)`，`us = span(t,1.35,4.85)`，
> `soak = 0.55·easeOut(min(us/0.1,1)) + 0.45·us`）。
> **没有任何一个式子依赖上一帧**；把 `t` 单独喂进来就能算出这一帧的全画面。

| # | 派生量 | 闭式 `f(u)` | 落到哪里 | u=0（接触瞬间） | u=1（瞬态结束） |
|---|---|---|---|---|---|
| 1 | **画面震动** | `shake(u) = 6·e^(−9u)·sin(52u)` | `.world → translate3d(shake, 0.62·shake)` | `0` | `6e⁻⁹·sin52 ≈ 0.0006px` |
| 2 | **印章缩放回弹** | `s(u) = 1 − 0.055·e^(−7u)·sin(26u)`，落体拉伸 `sy=s·(1+0.075·vn)`、`sx=s·(1−0.035·vn)`，`vn=(t<T_IMPACT)?dropP³:0` | `.sealBox → scale(sx, sy)` | `1` | `1 − 0.055e⁻⁷sin26 ≈ 1` |
| 3 | **冲击波（两圈）** | `r_k = IR + (190+130k)·easeOut(u_k)`，`α_k = (1−u_k)^1.7·{0.85, 0.44}`，`u_k = span(t, 1.35+0.09k, 1.35+0.46+0.40k)` | `#fx` 画布两个同心圆 | `130px / α .85` | `320 / 450px, α = 0` |
| 4 | **墨迹扩散** | `m(us) = 1 + 0.056·soak`（mask-size），`inkA(us) = 1 − 0.085·us` | `.seal → mask-size` / `opacity` | `100%, 1.00` | `105.6%, 0.915` |
| 5 | **纸张形变** | `w(u) = 1 + 0.0035·e^(−7u)·sin(30u+0.5)`，`ρ(u) = IR + 190·easeOut(u)` | `.sheet → scale(w)`，`#ripple` 径向渐变 | `1.0017, 130px` | `≈1, 320px` |
| 6 | **灰尘粒子 / 印缘毛边 / 墨渗前沿** | 灰尘 `R_i = r0_i + (60+190h_i)·easeOut(u_i)`、`y_i += 52u_i²`、`α_i = (1−u_i)²·0.78`；纤维 `fiber_j = (7+21h_j)·(0.20·easeOut(u_f)+0.80·soak)`；前沿 `wbase = R_RING + 14 + 150·easeOut(uw)` | `#fx` 画布 34 个圆点 + 20 根纤维 + 1 条不规则闭合轮廓 | 灰尘 `α=0`；前沿 `uw=span(t,1.97,4.45)` 尚未启动 | 灰尘消失；纤维与前沿继续缓慢推进 |

**关键点**：第 1、2、5 条是**衰减正弦** `A·e^(−k·u)·sin(w·u)`。
它最容易被写成「每帧乘一个衰减系数」的惯性震动 ——

```js
// ❌ 累加器：seek 到 t=1.6 时 shakeAcc 是 0 还是 6，取决于之前 seek 过哪些帧
shakeAcc = shakeAcc * 0.82;
world.style.transform = `translateX(${shakeAcc}px)`;
shakeAcc += (Math.random() - 0.5) * 3;
```

**`A·e^(−k·u)·sin(w·u)` 三参数的手感**（在 `index.html` 里调过 5 轮）：

- `A` = 「一眼看到多大动静」。震动用 `A = 6`（px）；印章回弹用 `A = 0.055`（无量纲缩放增量）。
  大于 8px 就开始像画面在抽搐，小于 4px 在 contact sheet 上完全看不出来。
- `k` = 停得多快。震动 `k = 9` → 约 0.35s 后肉眼不可见；回弹 `k = 7` → 略长一点，让压扁有个余味。
  `k` 调小到 4 会「震个不停」，调大到 20 就只剩一帧的抖动、像坏帧。
- `w` = 抖得多碎。震动 `w = 52` → 四分之一周期 `2π/52/4 = 0.030s ≈ 1 帧`，
  所以「咔」的一下是**单帧级**的，而不是被均匀摊到 0.5s 上；回弹 `w = 26` → 约 2 帧一振。

## 3. 关键技术点

### 3.1 确定性毛边 mask（canvas + `hash`，load 时生成一次）

```js
function hash(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); }

// ① 先用矢量几何画出印面（外圈 / 内细圈 / 五角星 / 两条弧字），白 on 透明
g.fillStyle = '#fff'; g.strokeStyle = '#fff';
g.lineWidth = SR * 0.072; g.beginPath(); g.arc(cx, cy, SR * 0.945, 0, TAU); g.stroke();
arcText(g, '视觉特效库', cx, cy, SR * 0.688, -Math.PI/2 - 0.98, -Math.PI/2 + 0.98, true, fs1);
arcText(g, '印章盖下', cx, cy, SR * 0.645,  Math.PI/2 + 0.64,  Math.PI/2 - 0.64, false, fs2);

// ② 再用 destination-out 沿外圈环带 + 印面内部「挖掉」hash 决定的斑点 = 毛边 / 做旧
g.globalCompositeOperation = 'destination-out';
for (i = 0; i < 2200; i++) {
  a  = hash(i * 1.7 + 0.31) * TAU;
  rr = SR * (0.888 + hash(i * 3.3 + 1.1) * 0.135);        // 只打在外圈环带上
  g.globalAlpha = 0.06 + hash(i * 7.1 + 4.4) * 0.62;
  g.beginPath(); g.arc(cx + Math.cos(a)*rr, cy + Math.sin(a)*rr,
                       0.6 + hash(i * 5.7 + 2.3) * 2.6, 0, TAU); g.fill();
}
```

canvas 用 `toDataURL()` 变成一个 data URL，挂到 CSS 自定义属性 `--sealmask`，
由 `.seal / .bleed / .ghost ×2` 四个元素共用。生成只发生一次（PATTERNS §4 的要求），
之后每帧只改一个标量 `mask-size`。**同一个 `i` 永远得到同一个斑点**，
所以两次渲染逐字节一致（当时的机器验收 的 determinism 项两次都 PASS）。

> ⚠️ 中国公章是**朱文**：红的是圈、星、字，纸色是底。所以 mask 里**不填**印面内部。
> 第一版填了，结果看起来是一枚「红色实心圆盘」，不像印章。这个坑在缩略图上非常明显。

### 3.2 `filter: blur()` 不能写在带 `mask` 的元素上（静默失败）

墨渗光晕需要一个「被模糊的印面」。第一版写成：

```css
/* ❌ 模糊完再被 mask 边界裁掉，光晕根本出不来 */
.bleed { -webkit-mask-image: var(--sealmask); filter: blur(7px); }
```

CSS 里 mask 作用在 filter **之后**，模糊外溢的那部分被 mask 剪掉，只剩一个硬边色块 ——
不报错、不警告，纯粹「看起来没效果」。正确做法是**在 mask 外面套一层 wrapper**：

```css
.bleedBox   { filter: blur(7px); }                            /* 外层负责模糊 */
.bleedBox > .bleed { -webkit-mask-image: var(--sealmask); }   /* 内层负责形状 */
```

### 3.3 同一帧只写一次 + 单一真值来源

```js
var u  = span(t, T_IMPACT, T_IMPACT + T_TAIL);
var us = span(t, T_IMPACT, T_SETTLE);
var soak = 0.55 * easeOut(Math.min(us / 0.10, 1)) + 0.45 * us;
// 先把这一帧所有值求完，再各写一次 DOM；没有「顺序赋值互相覆盖」
sealBox.style.transform = 'translate3d(0,' + n3(dy) + 'px,0) scale(' + n3(sx) + ',' + n3(sy) + ')';
sealEl.style.maskSize   = n3(100 + 5.6 * soak) + '% ' + n3(100 + 5.6 * soak) + '%';
sealEl.style.opacity    = n3(1 - 0.085 * us);
```

`.sealBox` 的 `transform`（位置/缩放）与 `.seal` 的 `mask-size`/`opacity`（墨迹）
是两块互不覆盖的职责，落在两个不同元素上，所以不存在同帧二次写入。
三份 HTML 里**没有一条 CSS `@keyframes`**（`reelDraw` 之外没有第二条时间线），
也**没有一处 `transition`**。

### 3.4 全片没有一处会变的 DOM 文本

PATTERNS §6.1 记录过：每帧往 DOM 写变化的文本会触发 Chromium 字形缓存栅格化的
1/255 抖动，**只在系统高负载时偶发**。本特效的做法是**干脆不写**：
画面里所有文字都是静态的，唯一带「数」的一行 `T_IMPACT = 1.350s` 是常量。
所以主方案的 lint 里连一条「每帧改 DOM 文本」的 NOTE 都没有
（variant-a 一开始有一条 —— 那是在 `arcChars()` 里 `t.textContent = …`；
它是 **load 时建印章**用的，不在 `reelDraw` 里。为消除这个静态误报，
已改成 `appendChild(document.createTextNode(...))`）。

## 4. 方案对比

| | **主方案 `index.html`** | **variant-a** | **variant-b** |
|---|---|---|---|
| 毛边技术 | load 时 canvas 画一次 → data URL mask，运行时只改 `mask-size` | SVG `feTurbulence`(两级) + `feDisplacementMap`，每帧改两个 `scale` | canvas `ImageData` 逐像素坐标扭曲 + 双线性采样 |
| 每帧实际工作量 | 1 次 mask 缩放 + 约 10 次 transform/opacity 写入 | 每帧重跑 2 遍 displacement，作用在约 340² 的印面区域 | 400²=160 000 像素的 alpha 重写 + 边缘窄带约 15 000 像素的双线性采样 + 1 次 `putImageData` |
| 相对耗时 | 基准 | 明显更慢（每帧要过一遍 SVG 滤镜） | 最慢（纯 JS 逐像素，但已把窄带从 160k 裁到 15k） |
| 观感 | 干、脆；毛边是「被纸吃掉的缺口」 | 润、抖；边缘是「波浪 + 颗粒」，**三者里最像湿印泥** | 最像「墨沿纤维爬」；毛边是有机团块，最接近真印 |
| 可控性 | 形状在 load 时冻结，运行期**只能整体缩放**，不能逐帧改形状 | `scale` 是连续量、可任意调；形状不可局部控制 | 每个像素都可控：可以只处理指定区域、也可以按笔画分别给不同渗速 |
| 复用性 | **最高**：换一张 mask 图就换图案；一张 mask 给 4 个元素共用 | 中：滤镜链挂在 SVG 上，复用要给每个 `<svg>` 复制一份 defs | 最低：底版、噪声场、band 索引都是为本特效专用 |
| 代码量 | ~370 行 | ~350 行 | ~400 行 |
| `verify` determinism | PASS | PASS | PASS |
| `density` | 最长静止段 0.53s，静止占比 14% | 0.53s，21% | 0.53s，21% |

> 「相对耗时」一栏没有写绝对秒数：本机没有单独计时，只从三次后台导出作业的完成顺序看，
> a 与 b 都明显长于主方案。不写没实测过的数字。

**推荐主方案。** 毛边图案在 load 时一次定死，运行期只剩一个 `mask-size` 标量，
是三者里最不可能出现非确定性的；同一张 mask 被主印面、墨渗光晕、两个下落残影四个元素复用，
改图案只改一处；而且它每帧只写十来个属性，对 150 帧的导出最友好。

**如果只看画面，variant-a 的观感其实最好** —— 两级 `feTurbulence`（低频 0.028 管轮廓手抖、
高频 0.16 管墨沿颗粒）给出的湿印泥边缘比主方案的「缺口式」毛边更接近真印章。
它的代价是每帧重跑滤镜，是我唯一担心「换 Chromium 版本会变样」的方案
（本机实测 determinism PASS，并且 verify 新增的「换 seek 路径」项也 PASS）。

**variant-b 适合需要「同一枚印章在不同纸上渗得不一样」的场景** ——
它可以把 `NOISE` 换成纸的纤维走向图、也可以按笔画给不同渗速。
代价是每个像素都要自己算，且必须像本方案一样**主动裁剪计算区域**（160k → 15k）。

## 5. 踩坑记录

1. **`filter: blur()` + `mask-image` 同元素 → 光晕消失**（见 §3.2）。
   第一版墨渗光晕完全看不见，既不报错也没警告。改成 wrapper 承担 `filter` 后立刻出现。

2. **灰尘粒子从印章中心飞 → 被印章自己挡住，一帧都看不见**。
   第一版 `dust_i` 的起点是 `(IX, IY)`（冲击点＝印面中心），而印面是不透明 DOM 元素、
   z-index 又在 canvas 之上，于是所有粒子被盖住。改成从**印缘**出发：
   `r0_i = IR · (0.86 + hash(i·11.3+6.6) · 0.22)`。

3. **毛边画成「放射状直线」→ 像蜘蛛腿 / 划痕**。第一版用 24 根从印缘射出的直线，
   在 contact sheet 上看起来像纸被抓花了。改成「沿外圈挤出的墨疙瘩（13 段圆弧）
   + 20 根很短的纤维（7–28px）」才像印泥被压出来。

4. **`t ≈ 3.0 后完全静止` 会让 `density` 直接 FAIL**（与 SPEC 的偏差，重点说明）。
   SPEC 原方案写「`t≈3.0` 后完全静止」，但 5.0s × 30fps = 150 帧，
   若 3.0→5.0 完全冻结，相邻帧相同对 = 59/149 ≈ **40% > 35% → FAIL**。
   改法不是「加无意义的动」，而是给「盖完之后」一个**物理上真的存在**的慢过程：
   墨继续往纸纤维里渗（`soak` 从 0 走到 1，跨 1.35→4.85）、
   印缘纤维继续爬、墨渗前沿缓慢外扩（1.97→4.45）。
   视觉上仍是干净的结束态（末帧就是一枚盖好的印章），
   实测**最长静止段 0.53s**、静止占比 **14%**（静止帧全部来自开场 0.55s 的静态壳）。

5. **墨渗前沿第一版画成一个硬边圆**，结果它在 2→4s 变成画面第二抢眼的元素，
   像一条跟内容无关的圆环。改成「不规则闭合轮廓（角度解析式手抖）+ 前方淡湿晕」后，
   它才读起来像「墨已经润到哪儿」的边界，而不是画上去的圆。

6. **开场静态壳一开始给了 0.8s，太长**：按当时的密度判据（相邻帧 `YMAX ≤ 2` 的占比）
   已经到 17%、离 WARN 线只剩 5 个百分点。把 `T_DROP` 从 0.80 收到 0.55
   （首帧成壳、末帧结束态 建议 0.3–0.5s 静止起手），同时把下落缓动从 `u³` 换成 `u⁴`
   （下落窗口 0.55→1.35 共 0.8s，末端速度 `4·260/0.8 = 1300px/s ≈ 43px/帧`，
   比原来更冲）。**加长下落窗口必须同步加陡缓动，否则冲击会变软。**
   （后来验收器的密度判据换成了 `YAVG`，本片当前是「最长静止段 0.53s / 静止占比 14%」。）

7. **`Math.round(prog*100)` 类陷阱**：本片**没有场景内仪表**（没有进度条、没有百分比读数），
   所以不存在「文案说完成、数字说 99%」。场景内仪表自洽 要求的「末帧必须到终点值」
   由 `T_SETTLE = 4.85` 保证：末帧是 `149/30 = 4.9667s > 4.85`，`us` 已经死在 1。
   **若以后要把本特效 concat 进整片**：本片没有手画进度条，不建 `gbar.json` 就是关，
   没有任何场景内仪表需要迁移到 `REEL.offset`。

8. **`variant-a` 的 `verify` lint 曾报一条 NOTE：「有 1 处每帧改 DOM 文本」**。
   这是静态正则的误报（`arcChars()` 只在 load 时建印章时写一次 `textContent`），
   但既然代价只是换成 `createTextNode`，就顺手消掉了。

## 6. 验收结论

当时的机器验收原始输出如下（已不在出片闭环）：

```
=== 验收 印章盖下 ===
[PASS] lint: .stage 尺寸与 REEL 一致 (1280x720)
[PASS] lint: 无 CSS animation（全部走 reelDraw/WAAPI）
[PASS] lint: REEL = 5s @30fps 1280x720
[PASS] mp4: 成片 1280x720 30.00fps 5.000s 150帧 1546KB
[PASS] mp4: 全片解码无错误
[PASS] determinism: 同一 t 两次截帧逐字节一致（5 个采样点）
[PASS] determinism: 采样帧互不相同（5/5 唯一）
[PASS] determinism: 换 seek 路径同一 t 仍逐字节一致（先经 0/25% 到达 vs 直接到达）
[PASS] sheet: contact sheet（带帧号）: .../印章盖下/sheet.png
[PASS] density: 最长静止段 0.53s（16 帧）/ 静止占比 14%
[PASS] deliver: 有 README.md
[PASS] deliver: 有 index.html

结果: 0 FAIL / 0 WARN  ->  合格
```

> 那 0.53s 的静止段就是开场静态壳（0.00→0.55s），是我故意留的 ——
> 契约要求 0.3–0.5s 静止起手，§7.5 #2 要求首帧成壳。判据线是 1.0s WARN / 1.5s FAIL。

两个备选方案（在 `variants/` 下当时对 variants 跑过机器验收）：

```
variant-a:  mp4 1280x720 30fps 5.000s 150帧 1344KB / 全片解码无错误
            determinism 5/5 逐字节一致 + 换 seek 路径一致
            density 最长静止段 0.53s（16 帧）/ 静止占比 21%
            —— 除「目录里没有 README.md / index.html」这两条目录级检查外，0 FAIL
               （这两条是因为 target 指向 variants/ 里的文件，不是方案本身的问题）

variant-b:  mp4 1280x720 30fps 5.000s 150帧 1319KB / 全片解码无错误
            determinism 5/5 逐字节一致 + 换 seek 路径一致
            density 最长静止段 0.53s（16 帧）/ 静止占比 21%
            —— 同上，0 FAIL
```

**关于「静止占比」14% vs 21% 的差异（诚实记录）**：
主方案的墨迹外扩是 `mask-size` 缩放一张位图 mask，缩放会重采样整条印缘的亚像素过渡，
每帧都有成片的像素值微动；variant-a 是 SVG 滤镜 `scale` 漂移、variant-b 是逐像素
`amp` 漂移，它们改变的是**边缘的局部形状**，整屏平均像素差更小，所以被
`YAVG < 0.02` 判为静止的帧更多。三者的**最长静止段都是 0.53s（同一段开场壳）**，
判据（>1.0s WARN / >1.5s FAIL）都过得比较宽裕。这也说明密度指标只能兜底，
真正的「动没动」还是要看 `sheet.png`。

### 6.1 冲击时刻逐帧复核（关键帧纪律）

`T_IMPACT = 1.35s` 落在第 40 与第 41 帧之间（`40/30 = 1.3333`，`41/30 = 1.3667`）。
我单独抽了这三帧、逐张看：

| 帧 | t | 我肉眼看到的 |
|---|---|---|
| 第 40 帧 | `1.3333s` | 印章**还差 21px 没碰到纸**；上方拖出 2 条逐渐变淡的残影（下落拖尾），印章被竖向拉长约 7.5%、投影又大又散 —— 一眼是「正在高速下落」 |
| 第 41 帧 | `1.3667s` | **已经接触**：残影消失、印章压扁回弹、一圈朱红冲击波紧贴印缘炸开、印面周围有一层极短的墨色冲击闪、投影明显收紧变深。画面还在被震动偏移（`u=0.03`，`shake≈4.6px`） |
| 第 42 帧 | `1.4000s` | 冲击波继续外扩（半径已到 165px 左右）、纸屑开始从印缘飞出、印缘毛边被挤开、墨色闪已消失大半；震动仍在（`shake≈0.7px`） |

**结论：「接触」发生在 1 帧之内**，没有被均匀摊开。第 40→41 帧之间
印章下移约 43px（末速度 1300px/s），同时残影/拉伸/松影在一帧内全部收掉 ——
这正是「冲击」该有的单帧级突变。

### 6.2 视觉质量评分表自评（12 条，达标 11 条）

| # | 检查项 | 自评 | 说明 |
|---|---|---|---|
| 1 | 主体唯一 | ✅ | 全片只有一个动作主体：印章。左侧公文信息是**静态壳**，从头到尾一个字没动，不抢戏 |
| 2 | 首帧成壳 | ✅ | `t=0` 是纸 + 公文 + 印章悬在上方未落，可以直接截屏当封面 |
| 3 | 末帧成图 | ✅ | 末帧是一枚盖好的印章停在公文右下，不是飞走、也不是 100% 配 LOADING |
| 4 | 节奏三段 | ✅ | 0.00–0.55 静止起手 → 0.55–1.35 加速下落 → 1.35–1.90 冲击瞬态 → 1.90–4.85 墨渗收束；四段速度明显不同 |
| 5 | 留白呼吸 | ✅ | 纸面 `left 92 / top 60 / 1096×600`，文字左边距 ≥ 156px、距纸右沿 ≥ 108px；印章最高点距上沿 70px（≥64） |
| 6 | 对比达标 | ✅ | 正文 18px、小标题 34px；朱砂 `#b0262a` on 米纸 `#fcf8ee`，对比明显 |
| 7 | 配色克制 | ✅ | 米纸底 + 朱砂红 + 深褐字 = 2 色 + 1 中性；表单虚线只是同色系明度变化 |
| 8 | 排版有层级 | ✅ | 34px 标题 / 18px 值 / 15px 键 / 12px 等宽脚注，相邻比值 1.89 / 1.20 / 1.25；四行共用同一基线网格 |
| 9 | 动效不炫技 | ✅ | 震动、冲击波、墨渗、纸屑、涟漪、前沿，每一条都能对应到「一次盖章」的物理后果，没有一个是为了动而动 |
| 10 | 无装饰性扫光 | ✅ | 全片没有任何扫光/高光带。唯一会外扩的轮廓是「墨渗前沿」，它承载的信息就是墨量边界本身 |
| 11 | 承接可辨 | ✅ | 四段共用同一张纸、同一枚印章、同一配色；印章从上方落下→落在同一处→留在同一处，位置本身就是承接 |
| 12 | 中文排版 | 🟡 | 弧字与表单字段无孤行标点、行首无标点、不用全角空格凑位置；唯一扣分点是印章弧字「视觉特效库」在 384px 的缩略图格子里偏密（单帧 1:1 看没问题） |

**达标 11 / 12。** 三份方案共用同一套版式与时间轴，差异只在毛边技术，所以上表对三者都成立
（variant-a 的弧字比主方案更抖一点，但同样没有排版问题）。

---

## 7. 复现命令

```bash
cd <工作区根>
D=<技能目录>/mechanics/印章盖下

# 关键秒探针（含冲击前后三帧 1.3333 / 1.3667 / 1.4000）
node <技能目录>/tools/capture.mjs $D/index.html \
  --at 1.3333,1.3667,1.4,0,2.5,4.9667 --qa-dir "$PWD/reel-out/$(basename "$D")-probe"

# 全量导出（出片按 SKILL.md：--jobs $(nproc)，产物写 reel-out/）
node <技能目录>/tools/capture.mjs "$D/index.html" --out "$PWD/reel-out/$(basename "$D").mp4" --qa-dir "$PWD/reel-out/$(basename "$D")-qa" --jobs "$(nproc)"
# variants 已不在库里：node <技能目录>/tools/capture.mjs $D/variants/variant-a.html --out $D/variants/variant-a.mp4 --qa-dir $D/variants/qa-a --jobs 1
# variants 已不在库里：node <技能目录>/tools/capture.mjs $D/variants/variant-b.html --out $D/variants/variant-b.mp4 --qa-dir $D/variants/qa-b --jobs 1

# 客观验收
# 当时的机器验收已不在出片闭环。出片按 SKILL.md。
```

目录里的 `.verify-a/ .verify-b/ .verify-c/`、`.reel-preview.png`、`.reel-progress.json`
都是 capture / verify 的中间产物；`.verify.json` 是机器可读的验收报告。