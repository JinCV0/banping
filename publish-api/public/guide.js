/*
  登录屏下方的滚动教程：左边步骤目录跟着右边内容高亮。
  - 只改高亮，不劫持滚动；IntersectionObserver 让"当前这一步"落在视口中段。
  - 点目录用 scrollIntoView，偏移由 CSS 的 scroll-margin-top 管。
*/
(function () {
  var links = document.querySelectorAll(".guide-nav a");
  var steps = document.querySelectorAll(".guide-step");
  if (!links.length || !steps.length) return;

  var byStep = {};
  links.forEach(function (a) {
    byStep[a.getAttribute("data-step")] = a;
    a.addEventListener("click", function (event) {
      var target = document.getElementById(a.getAttribute("data-step"));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  if (!("IntersectionObserver" in window)) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var id = entry.target.getAttribute("data-step");
      links.forEach(function (a) { a.classList.toggle("is-on", a === byStep[id]); });
    });
  }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });

  steps.forEach(function (step) { observer.observe(step); });
})();

/*
  下滑提示：
  1) 停在顶部时，整页做一次"往下轻轻一推再弹回"的动势，让"下面还有内容"变成看得见的事；
  2) 用户一动（滚轮/触摸/按键/点击）立刻停，之后不再打扰；
  3) 已经滚下去了就只把提示淡出。
*/
(function () {
  var hint = document.getElementById("scroll-hint");
  var cue = document.getElementById("scroll-cue");
  var guide = document.getElementById("guide");
  if (!hint || !cue) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var stopped = false;
  var nudging = false;
  var timer = null;
  var left = 3;
  var NUDGE_TOP = 220;

  function sync() {
    if (nudging) return;
    hint.classList.toggle("is-gone", window.scrollY > 140);
  }

  function stop() {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
    nudging = false;
    sync();
  }

  function schedule(delay) {
    if (stopped || timer || left <= 0) return;
    timer = setTimeout(function () {
      timer = null;
      nudge();
    }, delay);
  }

  function nudge() {
    if (stopped) return;
    if (window.scrollY > 140) { stop(); return; }
    if (window.innerWidth < 1101) { schedule(1500); return; }
    left -= 1;
    nudging = true;
    window.scrollTo({ top: NUDGE_TOP, behavior: "smooth" });
    setTimeout(function () {
      if (stopped) { nudging = false; return; }
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(function () {
        nudging = false;
        sync();
        schedule(3600);
      }, 520);
    }, 900);
  }

  cue.addEventListener("click", function (event) {
    event.preventDefault();
    stop();
    hint.classList.add("is-gone");
    if (guide) guide.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("touchstart", stop, { passive: true });
  window.addEventListener("keydown", stop);
  window.addEventListener("click", function (event) {
    if (!cue.contains(event.target)) stop();
  });

  sync();
  if (!reduced) schedule(1100);
})();
