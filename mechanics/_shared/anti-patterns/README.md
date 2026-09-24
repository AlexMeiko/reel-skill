# 反例实验室 —— 哪些禁用写法真的会破坏 seek？

`reel-skill` 的契约禁了一堆东西（`infinite` / 墙钟 / `Math.random` / `transition` / `setInterval`）。
但**禁令和实际失效模式并不是一回事**。这里用 5 个最小反例做实测，
目的是把「为什么禁」从口号变成可复现的证据，并顺带校准验收器本身的能力边界。

复现（产物写 `$PWD/reel-out/`，不要写进技能目录）：

```bash
node <技能目录>/mechanics/_shared/anti-patterns/run.mjs                 # 同一批 t 截两遍，逐字节比对
node <技能目录>/mechanics/_shared/anti-patterns/run.mjs --only a1,a4    # 只跑指定反例
```

结论表已经写在下面。再跑会把 `evidence.json` 写到 `$PWD/reel-out/anti-patterns/`。

## 结论表

| 反例 | 手法 | 同 t 两次截帧（确定性检查） | 静态 lint | 真实失效 |
|---|---|---|---|---|
| A1 | 墙钟 rAF 时间戳驱动 | **5/5 一致（通过！）** | FAIL | **运动与 t 无关**：t=4.0s 时正解 x=1140px，反例 x=0px（压根没动） |
| A2 | `Math.random()` 每帧重掷 | **0/5 一致** | FAIL | 画面不可复现；seek 无意义 |
| A3 | `setInterval` 累加器 | **1/5 一致** | FAIL | 位置取决于页面存活了多久；seek 回不到那一刻 |
| A4 | CSS `infinite` 动画 | **5/5 一致（通过！）** | FAIL | **末帧闪回第 0 帧**：t=4.0s 时正解 x=1140px，反例 x=127px |
| A5 | `transition` 当主时间轴 | **2/5 一致** | WARN | 画面**滞后于 t**：显示的是上一次 seek 的位置 |

## 三个反直觉发现

### 1. `infinite` 其实「可 seek」——它坏在结束态，不是坏在确定性

`runtime/seek.js` 干的是：

```js
var list = document.getAnimations ? document.getAnimations() : [];
for (var i = 0; i < list.length; i++) { list[i].pause(); list[i].currentTime = ms; }
```

`document.getAnimations()` **包含 CSS 动画**，所以 `infinite` 动画会被 pause 并把
`currentTime` 设成 `t*1000`。于是同一 `t` 永远得到同一相位 —— A4 的确定性检查 5/5 通过。

它真正的问题是**语义**：`t = duration` 时 `currentTime` 落回循环起点，
末帧等于第 0 帧（A4 证据图：正解 1140px，反例 127px）。
所以禁 `infinite` 的理由是「末帧必须是结束态」，**不是**「seek 不稳定」。
这一点如果搞混，就会写出「我用 CSS 无限动画但 seek 测试过了，所以没问题」的错误结论。

### 2. 墙钟 rAF 能骗过确定性检查

A1 是**确定性地错**：headless 截帧会话里页面只活 ~50–100ms，
`elapsed` 永远落在 `span(elapsed, 0.2, 3.8)` 的 0 区间，红点恒在起点。
两次截帧当然逐字节一致 —— 因为它根本没动。

**教训**：确定性检查（同 t 两次一致）只能证明「可复现」，不能证明「与 t 有关」。
必须配合静态 lint（命中 `Date.now` / `performance.now` / rAF 模式）才能拦住 A1。

### 3. 验收器的能力边界

| 失效类型 | 同 t 两次截帧 | 全帧互不相同 | 静态 lint |
|---|---|---|---|
| 累加器 / 随机数（A2、A3） | ✅ 抓到 | ✅ | ✅ |
| transition 滞后（A5） | ✅ 抓到 | ✅ | ⚠️ 只 WARN |
| 墙钟但恒定（A1） | ❌ 抓不到 | ✅ 画面在动（正解在动） | ✅ 抓到 |
| infinite 末帧闪回（A4） | ❌ 抓不到 | ✅ | ✅ 抓到 |

所以验收必须是 **lint + 确定性 + 帧间差异 + 肉眼判末帧** 四件套，
任何单一手段都有盲区。出片终检仍按 `SKILL.md`：探针看图 → 全量 → `--from-mp4`。

## 各反例的正确改法

| 反例 | 改法 |
|---|---|
| A1 | 删掉 rAF；位置写成 `x = lerp(X0, X1, easeInOut(span(t, .2, D-.2)))`，在 `reelDraw(t)` 里写一次 |
| A2 | `Math.random()` → `hash(i)` 确定性伪随机；需要「每帧变」就叠时间量子 `hash(i + floor(t*12))` |
| A3 | 删掉累加器；`x` 写成 `t` 的闭式函数，不保留跨帧状态 |
| A4 | `infinite` → 有限次 + `animation-fill-mode: both`，或干脆在 `reelDraw` 里算 |
| A5 | 删掉 `transition`；补间交给 `reelDraw(t)`，因为 seek 不会等墙钟补间跑完 |

## 文件

| 文件 | 内容 |
|---|---|
| `a1-raf-wallclock.html` | 墙钟 rAF 驱动 |
| `a2-random-per-frame.html` | `Math.random()` 每帧重掷 |
| `a3-setinterval-accum.html` | `setInterval` 累加器 |
| `a4-infinite-anim.html` | CSS `infinite` 动画 |
| `a5-transition-timeline.html` | `transition` 当主时间轴 |
| `run.mjs` | 双截帧确定性比对；输出写 `$PWD/reel-out/anti-patterns/` |
| `evidence.json` | 入库的那次实测结果（机器可读） |
