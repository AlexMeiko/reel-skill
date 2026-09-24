# 特效 09 · 3D 卡片翻转（perspective flip）

> ⚠️ **本目录已于 2026-09-24 精简**：`variants/`、`qa/`、`probe/`、`evidence/`、`table/` 已按使用者决定删除，
> 现只保留 `index.html` + `README.md`；成片与过程产物不入库，需要时用 `capture.mjs` 从 `index.html` 重导。
> **下文提到的备选实现、取证帧与复现命令已不在磁盘上**，但**结论与实测数字仍然有效**
> （它们本来就是为了支撑这些结论才做的）。本库入口见 [`../INDEX.md`](../INDEX.md)。


> 一张信息卡片绕 Y 轴翻转 180°，露出背面的构成拆解；翻转先回摆（anticipation）、
> 掠过 90° 时看得见卡片厚度、过冲到 187.407° 再回落到 180° 停稳。

```
<技能目录>/mechanics/3D卡片翻转/
  index.html              主方案 · 真 3D + 角度驱动可见性（成片源）
  out.mp4                 1280×720 / 30fps / 5.000s / 150 帧
  qa/  sheet.png          capture 抽帧 + verify 生成的 15 格 contact sheet
  variants/
    variant-a.html/.mp4   2D 假翻转（scaleX(|cos|) + 过 90° 换内容）
    variant-b.html/.mp4   分层视差（层提升到卡片级 3D 上下文）
    qa-a/ qa-b/ probe-a2/ probe-b2/ probe-b3/
  evidence/
    layer-parity.html         backface-visibility 不继承给 preserve-3d 子层（4 格对照）
    plane-split-parity.html   面的 preserve-3d + 棱边平面 → 远侧 53px 被切掉（2 格对照）
    shots*/                   上面两页的实测截图
  probe/                  主方案关键帧（含 deg≈88/90/92 三帧）
```

---

## 1. 常见写法为什么在本 skill 里会坏

| 常见写法 | 坏在哪 | 本 skill 的 seekable 改法 |
|---|---|---|
| `animation: flip 1s infinite alternate` | `infinite` 直接违规；而且 CSS keyframes 是一条时间线、`reelDraw` 里的读数是另一条，seek 后必然对不上 | `deg` 写成 t 的闭式函数，一帧写一次 `card.style.transform` |
| `setTimeout(() => card.classList.add('flipped'), 900)` | 墙钟事件。seek 到 `t=3.0` 时那次回调**永远不会发生**，卡片还停在正面；`Date.now()` / `setInterval` 同类 | 目标姿态由 `deg` 决定，没有「事件」这回事 |
| `front.opacity = span(t,0.5,1.85); back.opacity = span(t,1.85,3.2)` | 两个区间在 `t=1.85` 附近**两张半透明同时出现**（两面同时可见）；时间点稍微错开就出现**两面都不可见**的空档；改一个忘了另一个还会「角度已 180° 而背面还是透明的」 | 可见性完全交给 `backface-visibility` —— 它是几何剔除，由累积矩阵算出来，**不可能**和角度失同步 |
| `deg += 3`（每帧累加） | 确定性地错。当时的机器验收 的「换 seek 路径」那条会抓住：直接 seek 到 `t=2.5` 与 先经过 0/25% 再到 `t=2.5` 得到不同画面 | `deg = 180 * easeInOutBack(span(t, T0, T1))`，纯 f(t) |
| `transition: transform 1s` + 加 class | transition 是墙钟补间，seek 不会等它跑完 → 画面滞后于 t；lint 里直接 FAIL | 同上，闭式函数 |
| 卡片上 `filter: drop-shadow(...)` 做投影 | `filter` 是 group 属性，会把 `transform-style: preserve-3d` **压平成 flat**，3D 直接失效（不报错，只是没立体了） | 投影另起一个**独立元素**，`transform` 由同一个 `deg` 派生（见 §3 第 3 段） |
| 每帧 `el.textContent = Math.round(deg) + '°'` | 每帧改 DOM 文本会触发 Chromium 字形栅格化的 1/255 抖动，高负载下「同一 t 两次截帧」会不一致（`_shared/PATTERNS.md` §6.1） | 角度读数做成**纸带里程表**：10 个数字都在 DOM 里，每帧只 `translateY` 平移，一个字的文本都不改 |

---

## 2. 核心证明：`deg` 是一个单一真值

```
deg = 180 · easeInOutBack( span(t, 0.30, 2.50), s = 1.0 )        ← 全片唯一的姿态真值
    t=0.30       deg =   0.000     正面平放（起手静止段 0.00–0.30）
    t=0.7333     deg =  −7.407     回摆到最大反角（anticipation，第 22 帧）
    t=1.4000     deg =  90.000     正好是导出的第 42 帧
    t=2.0667     deg = 187.407     过冲最大（转过头 7.407°，第 62 帧）
    t=2.50       deg = 180.000     精确落回整倍；此后恒为 180.000
    t=4.9667     deg = 180.000     末帧（第 150 帧），仍然是精确整倍
```

### 2.1 `deg → 可见面 → 背面补偿角` 推导

设观察者在 `+z` 方向，卡片坐标系里 `+z` 指向观众。

* **正面**：`transform: translateZ(8px)`，法线（卡片坐标系）= `(0,0,1)`。
  卡片整体 `rotateY(deg)` 之后：

  ```
  n_front = Ry(deg) · (0,0,1) = ( sin deg , 0 , cos deg )
  可见  ⟺  n_front · (0,0,1) = cos deg > 0
  ```

* **背面**：`transform: rotateY(180deg) translateZ(8px)`。
  它自己那条 `rotateY(180deg)` 就是**补偿角**，把背面的外向法线从 `+z` 翻到 `−z`：

  ```
  n_back(卡片坐标系) = Ry(180°) · (0,0,1) = (0,0,−1)
  n_back = Ry(deg) · (0,0,−1) = ( −sin deg , 0 , −cos deg )
  可见  ⟺  n_back · (0,0,1) = −cos deg > 0  ⟺  cos deg < 0
  ```

* 两条判据**互为补集**（`cos deg > 0` 对 `cos deg < 0`），所以：

| deg 区间 | `cos deg` | 正面 | 背面 | 画面 |
|---|---|---|---|---|
| −7.407° … 90° | > 0 | **可见** | 不可见（backface 剔除） | 正面，透视梯形 |
| = 90°（唯一零测度点） | = 0 | 面积 0 | 面积 0 | 两条 16px **侧棱**顶上来 |
| 90° … 187.407° | < 0 | 不可见 | **可见** | 背面，文字**不镜像** |
| ≥ 187.407° 后回落，2.50s 起 | < 0 | 不可见 | **可见** | 恒 180.000 |

**结论**：`{正面可见} ∪ {背面可见}` 在 `deg ≠ 90°` 时恰好覆盖全区间且不相交 ——
「两面同时可见」和「两面都不可见」在数学上不可能发生，因为它不是判断，是几何。
唯一的退化点 `cos deg = 0` 由厚度补上。

**背面补偿角是常量 `180°`，不是时间线上的第二个变量。** 随时间变的只有父元素上的一个 `deg`；
背面那条 `rotateY(180deg)` 是固定几何。所以不存在「两条时间线失同步」的位置 —— 这是本特效
值得单独做的原因。

### 2.2 90° 附近三帧的客观复核（`probe/`，y=360 行，以纸底 242 为参照找非纸像素）

| 帧 | t | deg | 轮廓 | 宽 | 我肉眼看到的 |
|---|---|---|---|---|---|
| `at-02-1_39s` | 1.3946 | 88.0 | 606..654 | **49px** | 左边一条纸色侧棱带 + 右边一条 19.5px 的压缩正面（文字被压扁但**不镜像**，背面完全不出现） |
| `at-03-1_40s` | 1.4000 | **90.000** | 614..649 | **36px** | **卡片没有消失**：只剩一条 ~20px 的纸色厚度带（16px 侧棱经 perspective 1400 放大到 ~20px）+ 两面各自的发丝级投影。**没有任何文字、没有镜像反字、没有两面同时可见** |
| `at-04-1_41s` | 1.4054 | 92.0 | 606..661 | **56px** | 左边侧棱带 + 右边 19.5px 压缩背面；正反面位置与 88° 帧**左右互换**，符合 `x' = x·cos + z·sin` |

三帧都是「有东西、且是同一个物体的连续姿态」，**没有一帧露馅**。

**成片自己也复核了一遍**：`out.mp4` 的第 42 帧（`k=42`，`t=42/30=1.4000s`，即 `deg=1.4·30=90.000`）
用同一套扫描量出来是 **x=614..649 / 36px**，和上面 `probe/` 的活页面截图逐像素一致 ——
也就是说导出的 H.264 里**确实**有一帧正好卡在 90.000°，且那一帧卡片没消失。
（对照：紧邻的第 41 帧 `t=1.3667s` / `deg=78.153°` 是 133px，第 43 帧 `t=1.4333s` / `deg=101.847°` 是 147px ——
两帧的 `|cos|` 都是 0.2053、面投影都是 115.0px，而中间那帧是 0.0px。
一帧之隔宽度就变回 130+px，说明 90° 附近采样够密，且**唯一**宽度塌到 36px 的就是 90.000° 这一帧。）

末帧 `t=149/30=4.9667s` 的 `deg` 用同一式子算出来是 **180.000000** —— 精确的整倍，不是 179.98。

厚度为什么在：卡片不是零厚度平面，而是「两张面 + 两条 16px 侧棱」的板。
`deg=90°` 时面是零宽度，但侧棱（`translateX(∓272px) rotateY(±90deg)`）正好正对观众：

```
左侧棱在 deg=90° 时：中心 x' = 0，z' = +272（离观众最近），横向占 x' ∈ [−8, +8]
经 perspective 1400 放大 1400/(1400−272) = 1.24 倍 → 屏幕上约 20px 宽的竖直厚边
```

### 2.3 其余派生量（同一个 `deg`，一次算完各写一次）

```
投影   sx  = (560·|cos deg| + 16·|sin deg|) / 560     ← 卡片投影宽度 = 面投影 + 厚度投影
       dx  = −20·sin deg        opacity = 0.58 + 0.42·|cos deg|
面指示 pos = clamp(deg/180, 0, 1) · 2                 ← 0=正面 1=侧视 2=背面，滑块同源
读数   v   = round(|deg|)                             ← 纸带里程表；deg < −0.5° 时亮负号
```

---

## 3. 关键技术点（核心 25 行）

```js
window.reelDraw = function (t) {
  /* 1. 单一真值 */
  var deg = 180 * easeInOutBack(R.span(t, T0, T1), BACK_S);   // T0=0.30 T1=2.50 BACK_S=1.0
  var rad = deg * Math.PI / 180;

  /* 2. 卡片姿态：只写这一个 transform */
  cardEl.style.transform = "rotateY(" + deg.toFixed(3) + "deg)";

  /* 3. 投影：同一个 deg 派生（不是 filter —— filter 会压平 preserve-3d） */
  var cs = Math.abs(Math.cos(rad)), sn = Math.abs(Math.sin(rad));
  shadowEl.style.transform = "translateX(" + (-20 * Math.sin(rad)).toFixed(2) + "px) scale(" +
    ((CW * cs + CT * sn) / CW).toFixed(4) + "," + (0.84 + 0.16 * cs).toFixed(4) + ")";
  shadowEl.style.opacity = (0.58 + 0.42 * cs).toFixed(3);

  /* 4. 面指示：pos 与卡片姿态同源 */
  var pos = R.clamp(deg / 180, 0, 1) * 2;
  pinEl.style.transform = "translateX(" + (pos * 64).toFixed(3) + "px)";
  for (var i = 0; i < 3; i++) labs[i].style.opacity = (1 - 0.62 * Math.min(1, Math.abs(pos - i))).toFixed(3);

  /* 5. 角度读数：纸带平移，永不改 textContent */
  sStrips[0].style.transform = "translateY(" + (deg < -0.5 ? -CELL : 0) + "px)";
  var v = Math.min(999, Math.round(Math.abs(deg))), PLACE = [100, 10, 1], started = false;
  for (var c = 0; c < 3; c++) {
    var d = Math.floor(v / PLACE[c]) % 10, idx;
    if (!started && d === 0 && c < 2) { idx = 0; } else { started = true; idx = d + 1; }
    sStrips[c + 1].style.transform = "translateY(" + (-idx * CELL).toFixed(0) + "px)";
  }

  /* 6. 背面数据落位：四条横条各一次插值、各写一次 width（互不覆盖） */
  for (var k = 0; k < 4; k++)
    bars[k].style.width = (BARMAX[k] * R.easeOut(R.span(t, TB[k], TB[k] + BD[k]))).toFixed(2) + "px";
};
```

CSS 侧的三个关键声明：

```css
.scene { perspective: 1400px; }                       /* 整个 3D 上下文只有一个相机 */
.card  { transform-style: preserve-3d; }              /* 唯一一个 preserve-3d */
.face  { backface-visibility: hidden; }               /* 面保持 flat，不再嵌套 preserve-3d */
.front { transform: translateZ(8px); }
.back  { transform: rotateY(180deg) translateZ(8px); }/* 补偿角 = 常量 180° */
.edge-l { transform: translateX(-272px) rotateY(-90deg); }   /* 厚度，让 90° 不塌成空白 */
.edge-r { transform: translateX( 272px) rotateY( 90deg); }
```

---

## 4. headless Chromium 实测结论（本特效最贵的三条）

### 4.1 `filter` 会压平 `preserve-3d`

`filter`（还有 `opacity<1`、`clip-path`、`mask`、`mix-blend-mode`）是 group 属性，
写在带 `transform-style: preserve-3d` 的元素上会把它的 used value 变成 `flat`。
所以 SPEC 里写的 `filter: drop-shadow()` 投影**不能**放在 `.card` 上 —— 一放立体就没了。
本实现把投影改成 `.scene` 里一个独立的 `.shadow` 元素，`transform`/`opacity` 仍然由同一个 `deg` 派生。

### 4.2 `backface-visibility` **不会**继承给 `preserve-3d` 的子层（实测）

证据页 `evidence/layer-parity.html`，四张 280×180 的卡全部固定 `rotateY(147deg)`、全部在看背面，
正面里各放一块橙色板：

| 格 | `.face` | 层的 z | 层自带 `backface-visibility` | 实测 |
|---|---|---|---|---|
| ① | preserve-3d | 44px | 有 | 层被正确剔除，只剩背面 ✅ |
| ② | preserve-3d | 44px | **没有** | **橙色板穿到卡片右侧外面** ❌ |
| ③ | preserve-3d | 0 | 有 | 共面、被剔除 ✅ |
| ④ | flat | 44px | 有 | z 被压平，等于普通翻转 ✅ |

结论：`.face` 上的 `backface-visibility: hidden` 只剔除**面自己那块平面**；
一旦面变成 `preserve-3d`，子层就是独立的平面，**每一层都必须自己写**。

### 4.3 面的 `preserve-3d` + 棱边平面 → Blink 丢掉卡片远侧 53px（实测）

这是本特效的**主要返工点**。`evidence/plane-split-parity.html` 里两张 560×340 的卡
完全一样（`rotateY(147deg)`、`perspective 1400px`、两条 16px 棱边），只差左边那张的
`.face` 多了一条 `transform-style: preserve-3d`。同一套像素扫描（`ffmpeg -f rawvideo -pix_fmt gray`）：

```
主方案 index.html                         y=220/360/480 卡片暗区都是 422..900   ← 与解析投影 423..900 一致
主方案 + 只在 .face 上加 preserve-3d      y=220/360/480 卡片暗区都是 422..847   ← 远侧 53px 没了
主方案 + 在 .face 上加 preserve-3d 且删掉两条棱边   → 422..900  正常
主方案 + 在 .face 上加 preserve-3d 且 border-radius 改 0 → 422..847  仍然坏
```

解析投影：`x' = x·cos147 + z·sin147`、`z' = −x·sin147 + z·cos147`、`screen = 640 + x'·1400/(1400−z')`，
`x=±280, z=−8` 给出 `640 ± 260 → 380..900`（在 1280 宽画面里即 423..900）。
所以 847 这个边界没有任何几何解释，是渲染器把面切错了。
触发条件是「同一个 3D 上下文里**嵌套的 preserve-3d** 与**相交的平面**（面与侧棱共用一条边）共存」。

**规矩**：卡片级只留一个 `preserve-3d`（在 `.card` 上），面永远 flat，层和棱边都是 `.card` 的
**同级子元素** —— 靠 `translateZ` 分深度，不靠嵌套。variant-b 就是照这条重做的。

### 4.4 其他实测

* `preserve-3d` + `perspective` 在 headless Chromium（`--no-sandbox --disable-dev-shm-usage`）下
  渲染完全正常，逐帧确定：当时的机器验收 三条确定性检查全 PASS（含「换 seek 路径」）。
* 3D 变换不引入非确定性；本特效唯一被 lint 提示的是 `buildStrip()` 在**加载时**写了一次
  `textContent`（一次性建纸带，不是每帧），全程 `reelDraw` 里没有任何文本写入。

---

## 5. 三方案对比

| | **主方案 index.html** | **variant-a**（2D 假翻转） | **variant-b**（分层视差） |
|---|---|---|---|
| 做法 | `perspective` + `preserve-3d` + `backface-visibility`，可见性交给几何 | 无 3D。`transform: scaleX(max(|cos deg|, 16/560))`，`deg ≥ 90` 硬换内容 | 同主方案，再把内容层作为 `.card` 同级子元素给 `translateZ(6…30px)` |
| 透视 | 有。翻转中是**梯形**（近侧高、远侧矮） | 没有。永远是**等宽矩形**，只是横向压扁 | 有 |
| 90° 时 | 36px 的纸色**厚度带**（16px 侧棱放大） | 34px（16px 下限 + 一条独立的「厚度条」补丁） | 36px |
| 88° / 92° 轮廓 | **49px / 56px**（不对称 = 透视） | 44px / 44px（对称 = 没有透视，这是假翻转的客观指纹） | 同主方案 |
| 内部纵深 | 无（内容贴在面平面上） | 无 | 有。层 z 越大，斜视角下横向位移越多（deg=147° 时约 8~9px 的相对位移） |
| 层叠 bug 风险 | 低（只有两个平面 + 两条棱边） | **最低**（只有一个被缩放的平面，绝不可能层叠出错） | 中（层必须各自写 `backface-visibility`） |
| 90° 塌成一条线？ | 不会 | **会**，必须加 16px 下限 + 厚度条两个补丁 | 不会 |
| 文字镜像？ | 不会（背面自带 `rotateY(180deg)` 补偿） | 不会（取 `|cos|` 并硬换内容） | 不会 |
| 代码量 / 可读性 | 中（~40 行驱动） | 中（多一层「显示面」判断，且这个判断是**纯 deg 函数**，不是跨帧状态） | 中（层的 transform 在加载时写一次） |
| 复用性 | 高：换内容就是换两个 `.face` 的 DOM | 高：但拿不到透视和厚度 | 中：层数一多，安全边距要重算（z 越大内容越往卡片外缘顶） |
| 代价 | 必须另起投影元素（不能 `filter`） | 观感明显「扁」，一眼假 | 层无法被卡片边界裁剪（`overflow:hidden` 会压平 preserve-3d），只能靠内边距留余量 |

**推荐主方案。** variant-a 的价值是当**下限对照**：它绝不会出层叠 bug，但也永远做不出
「转到 90° 看见厚度」和「翻转中是梯形」这两件事。variant-b 的价值是当**上限探测**：
它证明了嵌套 `preserve-3d` 在 headless Chromium 下不可靠（§4.3），因此主方案刻意退回到
「一个 3D 上下文 + 同级层」的写法。

---

## 6. 踩坑记录（都是实际发生并修掉的）

1. **`filter: drop-shadow` 放在 `.card` 上** → 立体消失（`preserve-3d` 被压平），
   而且**不报错**。改成独立 `.shadow` 元素。
2. **`.face` 加了 `preserve-3d`** → 卡片暗区从 `422..900` 变成 `422..847`，远侧 53px 不见了，
   背面右侧的文字被硬边切掉（第一版 variant-b 的截图就是这样）。定位过程：
   先用 `sed` 造 4 个变量文件（层 z=0 / z=6 / 无棱边 / border-radius:0）逐个截帧 + 像素扫描，
   最后确认触发条件是「棱边平面 + 面上的嵌套 preserve-3d」，与 z 大小、圆角无关。
   证据钉在 `evidence/plane-split-parity.html`。
3. **`backface-visibility` 不继承**（§4.2）→ 层必须各写一次。第一版 variant-b 因为面里
   嵌套了 preserve-3d 又没给层写剔除，橙色对照板直接穿出来。
4. **里程表的格子是 `inline` span** → `height`/`line-height` 对 inline 元素无效，10 个数字
   横向排成一行，`translateY` 一平移整条读数就空了。第一版三帧读数全是「−01」这种鬼东西。
   修法：`.w-cell { display: block; }`。
5. **前导零抑制把 0 也吃掉了** → `t=0` 的读数是空白的，只剩一个「°」。
   修法：最低位永远显示（`if (!started && d === 0 && c < 2) blank; else show;`）。
6. **variant-a 的压暗黑纱没跟着 `scaleX` 缩放** → 卡片已经压到 16px，黑纱还留在 560×340，
   于是 90° 那一帧是一整块 560×340 的灰板。修法：黑纱放进 `.card` 里当子元素，跟着一起缩放。
7. **动效密度门槛与 SPEC 的「t≈3.2 后不再动」冲突**。按 SPEC 直写：0.3s 起手静止 +
   翻转 0.5–3.2 + 尾部 3.2–5.0 全静止 ≈ 46% 的帧整屏不动，密度检查不合格。
   改法：把「背面数据落位」（三条分项条 + 合计条依次生长）放到**卡片落定之后**（2.50–4.62）。
   **卡片角度在 2.50 之后恒为 180.000**，所以「背面完全稳定」在角度意义上仍然成立；
   后段运动全部是背面内容，不是卡片在动。最长静止段降到 0.70s（起手段）。

---

## 7. 场景内仪表与 concat 注意事项

* 右上角是一个仪表簇：**正面 / 侧视 / 背面** 三格 + 一个 `rotateY` 角度里程表。
  两者都从 `deg` 派生（`pos = clamp(deg/180,0,1)*2`、`v = round(|deg|)`），
  **不可能**出现「角度已经 180° 而指示器还停在正面」。
* **数据自洽**：正面大数 `1,284` = 背面合计 `1,284` = `512 + 431 + 341`；
  四条横条的分母都是 `1284`、轨道都是 `360px`，所以合计条**必然**正好补满轨道，
  分项条长度相加也必然等于合计条。这里不存在第二个尺度。
* 末帧是终点值：角度恒 `180.000`、四条横条都是满格、合计 `1,284`，没有「100% 配 LOADING」。
* 本特效**没有** `gbar.json` / `.srt` / 音轨 / 手画进度条，所以以后 concat 成整片时
  不会和 kit 的底栏打架。右上角那个仪表是**场景内**的说明性仪表（它讲的是本特效的角度真值），
  要接全片进度条的话应该整体删掉、改走 kit 的 `gbar.json` + `REEL.offset`。

---

## 8. 验收结论

```bash
cd <工作区根>
# 当时的机器验收已不在出片闭环。出片按 SKILL.md。
```

```
=== 验收 3D卡片翻转 ===
[PASS] lint: .stage 尺寸与 REEL 一致 (1280x720)
[PASS] lint: 无 CSS animation（全部走 reelDraw/WAAPI）
[NOTE] lint: 有 1 处每帧改 DOM 文本（…）        ← 实际是加载时建纸带，一次性
[PASS] lint: REEL = 5s @30fps 1280x720
[PASS] mp4: 成片 1280x720 30.00fps 5.000s 150帧 343KB
[PASS] mp4: 全片解码无错误
[PASS] determinism: 同一 t 两次截帧逐字节一致（5 个采样点）
[PASS] determinism: 采样帧互不相同（5/5 唯一）
[PASS] determinism: 换 seek 路径同一 t 仍逐字节一致（先经 0/25% 到达 vs 直接到达）
[PASS] sheet: contact sheet（带帧号）: …/sheet.png
[PASS] density: 最长静止段 0.70s（21 帧）/ 静止占比 39%
[PASS] deliver: 有 README.md
[PASS] deliver: 有 index.html

结果: 0 FAIL / 0 WARN  ->  合格
```

三条「确定性」是三种不同的东西，本片三条都过：

| 检查 | 本片证据 |
|---|---|
| 同一 `t` 截两次逐字节一致 | 5 个采样点全部一致（`reelDraw` 里没有任何跨帧状态） |
| 换 seek 路径同一 `t` 一致 | 「先经 0 / 25% 再到中点」与「直接到中点」逐字节一致 → 真值是 `t` 的函数 |
| 静态 lint 禁墙钟 | 没有 `Date.now` / `performance.now` / `setInterval` / `rAF` / `Math.random` |

**我肉眼在 `sheet.png`（15 格）上确认的**：0° 完整正面壳 → −3° → −6°（回摆）→ 33° → 132°
（翻转中，背面透视梯形）→ 182° → 185°（过冲）→ 180°（落定）→ 之后 8 格是背面构成条由短到长
长满。中文没有一个豆腐块，文字没有被裁、没有贴边，`1,284` 与合计 `1,284` 在正反两面都完整。
`qa/` 的首帧（正面静止壳）与末帧（背面满格 + 180°）都正确。

`probe/` 里额外钉了三帧（deg≈88 / 90 / 92）—— 见 §2.2，**没有一帧露馅**。

---

## 9. 视觉质量评分表（逐条自评，12/12）

| # | 检查项 | 自评 | 依据 |
|---|---|---|---|
| 1 | 主体唯一 | ✅ | 全片只有一个主体：那张卡片。页眉/页脚/仪表都是配角，且仪表讲的就是卡片的角度 |
| 2 | 首帧成壳 | ✅ | `t=0` 正面卡片完整（1,284 万台 / 环比 / 截至日），角度 0°、滑块在「正面」，可当封面 |
| 3 | 末帧成图 | ✅ | 末帧背面四条横条满格、合计 1,284、角度 180.000、滑块在「背面」，是稳定结束态 |
| 4 | 节奏三段 | ✅ | 起手静止 0.30s → 翻转 2.20s（回摆 −7.407° / 掠过 90.000° / 过冲 187.407° / 回落）→ 数据落位 2.12s → 定格 0.38s |
| 5 | 留白呼吸 | ✅ | 卡片 560×340 居中，四周 360/190px；页眉页脚均距边 64px；背面层再往里收 10px 留出斜视角余量 |
| 6 | 对比达标 | ✅ | 正文 18–24px；正面 `#16262e` 配 `#fff`，背面 `#f2efe8` 配 `#16262e` |
| 7 | 配色克制 | ✅ | 纸底（暖灰）/ 墨（`#16262e`）/ 两个面（白 + 深墨）三种中性 + **唯一**强调色橙（浅底 `#c2410c`、深底 `#f08a4b`，同一色相两档） |
| 8 | 排版层级 | ✅ | 40（页标题）/ 96（大数）/ 24（卡内标题）/ 18–20（正文与数值），级差 > 1.4 倍 |
| 9 | 动效不炫技 | ✅ | 全片只有一条运动曲线 `deg(t)`，它同时决定姿态、可见面、投影、滑块、读数 —— 没有第二个无意义动画 |
| 10 | 无装饰性扫光 | ✅ | 没有任何扫光/扫描线；唯一的「高亮」是滑块位置，它承载的是「现在在看哪一面」 |
| 11 | 承接可辨 | ✅ | 同一张卡片贯穿全片；正面 `1,284` 与背面合计 `1,284` 是同一个数，翻转就是「看它的构成」 |
| 12 | 中文排版 | ✅ | 全部单行整句，无标点孤行、无行首标点、无全角空格凑位；数值用等宽 CJK 字体对齐 |

---

## 10. 交付清单

| 文件 | 说明 |
|---|---|
| `index.html` / `out.mp4` | 主方案，1280×720 / 30fps / 5.000s / 150 帧 |
| `variants/variant-a.html` / `variant-a.mp4` | 2D 假翻转（下限对照） |
| `variants/variant-b.html` / `variant-b.mp4` | 分层视差（上限探测，已按 §4.3 的结论重做） |
| `evidence/layer-parity.html` | `backface-visibility` 不继承的四格对照 + 截图 `evidence/shots/` |
| `evidence/plane-split-parity.html` | 面的 `preserve-3d` + 棱边 → 远侧 53px 被切的两格对照 + 截图 `evidence/shots-plane/` |
| `probe/` `qa/` `sheet.png` | 关键帧 / 抽帧 / 15 格 contact sheet |