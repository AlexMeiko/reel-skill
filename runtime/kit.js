(function (root) {
  if (root.__reelKitInstalled) return "ok";
  root.__reelKitInstalled = true;

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }
  function lerp(a, b, u) {
    return a + (b - a) * u;
  }
  function span(t, t0, t1) {
    if (!(t1 > t0)) return t >= t1 ? 1 : 0;
    return clamp((t - t0) / (t1 - t0), 0, 1);
  }
  function easeOut(u) {
    u = clamp(u, 0, 1);
    return 1 - Math.pow(1 - u, 3);
  }
  function easeInOut(u) {
    u = clamp(u, 0, 1);
    return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  }

  function list(key) {
    var r = root.REEL || {};
    return Array.isArray(r[key]) ? r[key] : [];
  }

  function cueAt(t, cues) {
    var text = "";
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i];
      if (!c) continue;
      var a = c.t;
      if (!a) continue;
      var t0 = Number(a[0]) || 0;
      var t1 = a.length < 2 || a[1] == null ? Infinity : Number(a[1]);
      if (t >= t0 && t <= t1) text = c.text || "";
    }
    return text;
  }

  function stage() {
    return document.querySelector(".stage") || document.body;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function ensure(id, className) {
    var el = $(id);
    if (el) return el;
    el = document.createElement("div");
    el.id = id;
    el.className = className;
    el.setAttribute("aria-live", "polite");
    stage().appendChild(el);
    return el;
  }

  function injectCss() {
    if (document.getElementById("reel-kit-css")) return;
    var s = document.createElement("style");
    s.id = "reel-kit-css";
    s.textContent = [
      ".reel-kit-caption {",
      "  position:absolute; left:72px; right:72px; bottom:var(--reel-caption-bottom, 40px);",
      "  z-index:30; text-align:center; pointer-events:none;",
      "  font-weight:500;",
      "  font-size:var(--reel-caption-size, 20px);",
      "  line-height:1.4;",
      "  font-family:inherit;",
      "  white-space:normal;",
      "  max-height:2.9em;",
      "  overflow:hidden;",
      "  color:var(--reel-caption-fg, currentColor);",
      "  background:var(--reel-caption-bg, transparent);",
      "  text-shadow:var(--reel-caption-shadow, none);",
      "  padding:var(--reel-caption-pad, 0);",
      "  border-radius:var(--reel-caption-radius, 0);",
      "}",
      ".reel-kit-caption[data-empty='1'] { visibility:hidden; }",
      ".reel-gbar {",
      "  position:absolute; left:0; right:0; bottom:0; height:36px; z-index:25;",
      "  pointer-events:none; display:flex; align-items:stretch;",
      "  overflow:hidden;",
      "  background:var(--reel-gbar-track, color-mix(in srgb, currentColor 12%, transparent));",
      "}",
      ".reel-gbar-fill {",
      "  position:absolute; left:0; top:0; bottom:0; z-index:0;",
      "  background:var(--reel-gbar-fill, currentColor);",
      "}",
      ".reel-gbar-ch {",
      "  position:relative; z-index:1; display:flex; align-items:center; justify-content:center;",
      "  min-width:0; padding:0 6px; box-sizing:border-box;",
      "  font-weight:600; font-size:11px; line-height:1; font-family:inherit;",
      "  letter-spacing:.02em;",
      "  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;",
      "  color:var(--reel-gbar-fg, currentColor); opacity:.4;",
      "}",
      ".reel-gbar-ch[data-on='1'], .reel-gbar-ch[data-past='1'] {",
      "  color:var(--reel-gbar-fg-on, #fff); opacity:1;",
      "}",
      ".reel-kit-hud {",
      "  position:absolute; top:28px; left:50%; transform:translateX(-50%);",
      "  z-index:30; pointer-events:none;",
      "  font-weight:600; font-size:13px; line-height:1; font-family:inherit;",
      "  letter-spacing:.1em;",
      "  color:var(--reel-hud-fg, currentColor);",
      "  background:var(--reel-hud-bg, transparent);",
      "  padding:6px 14px; border-radius:999px;",
      "}",
      ".reel-kit-hud[data-empty='1'] { visibility:hidden; }",
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  function chapterRange(c) {
    var raw = c && c.t;
    if (Array.isArray(raw)) return [Number(raw[0]) || 0, Number(raw[1])];
    return [Number(raw) || 0, null];
  }

  function ensureGbar(chapters, total) {
    var bar = $("gbar") || $("reel-gbar");
    if (bar && bar.getAttribute("data-reel-gbar") === "1") return bar;
    if (bar && !bar.getAttribute("data-reel-gbar")) {
      bar.innerHTML = "";
    } else {
      bar = ensure("gbar", "reel-gbar");
    }
    bar.className = "reel-gbar";
    bar.setAttribute("data-reel-gbar", "1");
    var fill = document.createElement("i");
    fill.id = "gbar-fill";
    fill.className = "reel-gbar-fill";
    bar.appendChild(fill);
    for (var i = 0; i < chapters.length; i++) {
      var ch = chapters[i];
      var rng = chapterRange(ch);
      var t0 = rng[0];
      var t1 = rng[1] != null && !isNaN(rng[1]) ? rng[1] : i + 1 < chapters.length ? chapterRange(chapters[i + 1])[0] : total;
      var lab = document.createElement("div");
      lab.className = "reel-gbar-ch";
      lab.textContent = ch.title || ch.text || "";
      lab.style.flex = "0 0 " + (100 * Math.max(0, t1 - t0) / total) + "%";
      bar.appendChild(lab);
    }
    return bar;
  }

  function applyGbar(t) {
    var r = root.REEL || {};
    var chapters = Array.isArray(r.gbar) ? r.gbar : [];
    if (!chapters.length) return;
    var total = Number(r.total) || Number(r.duration) || 1;
    if (!(total > 0)) total = 1;
    var offset = Number(r.offset) || 0;
    var g = offset + t;
    var bar = ensureGbar(chapters, total);
    var fill = bar.querySelector(".reel-gbar-fill");
    if (fill) fill.style.width = 100 * clamp(g / total, 0, 1) + "%";
    var kids = bar.querySelectorAll(".reel-gbar-ch");
    for (var i = 0; i < kids.length; i++) {
      var rng = chapterRange(chapters[i]);
      var t0 = rng[0];
      var t1 = rng[1] != null && !isNaN(rng[1]) ? rng[1] : i + 1 < chapters.length ? chapterRange(chapters[i + 1])[0] : total;
      kids[i].setAttribute("data-past", g >= t1 ? "1" : "0");
      kids[i].setAttribute("data-on", g >= t0 && g < t1 ? "1" : "0");
    }
  }

  function apply(t) {
    var captions = list("captions");
    var hud = list("hud");
    if (captions.length) {
      var el = ensure("reel-caption", "reel-kit-caption");
      var text = cueAt(t, captions);
      if (el.textContent !== text) el.textContent = text;
      el.setAttribute("data-empty", text ? "0" : "1");
      el.hidden = !text;
    }
    applyGbar(t);
    if (hud.length) {
      var h = ensure("reel-hud", "reel-kit-hud");
      var ht = cueAt(t, hud);
      if (h.textContent !== ht) h.textContent = ht;
      h.setAttribute("data-empty", ht ? "0" : "1");
      h.hidden = !ht;
    }
  }

  root.reel = {
    clamp: clamp,
    lerp: lerp,
    span: span,
    easeOut: easeOut,
    easeInOut: easeInOut,
    captionAt: function (t) {
      return cueAt(t, list("captions"));
    },
    apply: apply,
  };

  function wrap() {
    injectCss();
    var prev = root.__reelSeek;
    if (typeof prev !== "function" || prev.__reelKitWrapped) return;
    var wrapped = function (t) {
      var v = prev(t);
      try {
        apply(root.__reelTime);
      } catch (e) {
        root.__reelError = root.__reelError || {
          t: root.__reelTime,
          message: String((e && e.message) || e),
        };
        throw e;
      }
      return v;
    };
    wrapped.__reelKitWrapped = true;
    root.__reelSeek = wrapped;
  }

  wrap();
  if (document.readyState === "complete") wrap();
  else root.addEventListener("load", wrap);

  return "ok";
})(window);
