(function (root) {
  if (root.__reelSeekInstalled) return "ok";
  root.__reelSeekInstalled = true;
  root.__reelTime = 0;

  root.__reelSeek = function (t) {
    var duration = (root.REEL && root.REEL.duration) || 1;
    t = Math.max(0, Math.min(duration, Number(t) || 0));
    root.__reelTime = t;
    var ms = t * 1000;
    try {
      var list = document.getAnimations ? document.getAnimations() : [];
      for (var i = 0; i < list.length; i++) {
        try {
          list[i].pause();
          list[i].currentTime = ms;
        } catch (e) {}
      }
    } catch (e) {}
    var svgs = document.querySelectorAll("svg");
    for (var j = 0; j < svgs.length; j++) {
      try {
        if (typeof svgs[j].pauseAnimations === "function") {
          svgs[j].pauseAnimations();
          svgs[j].setCurrentTime(t);
        }
      } catch (e) {}
    }
    if (typeof root.reelDraw === "function") {
      try {
        root.reelDraw(t);
      } catch (e) {}
    }
    if (typeof root.reelSeek === "function") {
      try {
        root.reelSeek(t);
      } catch (e) {}
    }
    document.documentElement.getBoundingClientRect();
    return t;
  };

  function announce() {
    var reel = root.REEL || {};
    try {
      parent.postMessage({ type: "reel:ready", reel: reel }, "*");
    } catch (e) {}
    root.__reelSeek(0);
  }

  root.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "reel:seek") root.__reelSeek(d.t);
    if (d.type === "reel:ping") announce();
  });

  function onReady() {
    requestAnimationFrame(function () {
      requestAnimationFrame(announce);
    });
  }
  if (document.readyState === "complete") onReady();
  else root.addEventListener("load", onReady);

  return "ok";
})(window);
