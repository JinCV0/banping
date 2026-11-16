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
