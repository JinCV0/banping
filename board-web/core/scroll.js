/*
  横向滚动（跑马灯）
  ---------------------------------------------------------------
  只在"一行放不下"时滚：先量 scrollWidth / clientWidth，放得下就一动不动。
  两条路都有：滚过去的文字两端各停 1.4s 再回来，不用无限循环，眼睛跟得住。
  注意：headless 截图里 rAF 几乎不推进（LESSONS 2026-11-02），验证要靠真机两帧。
*/
window.BoardScroll = (function () {
  var SPEED = 0.055; // px/ms，约 55px/s
  var PAUSE = 1400; // 两端停留
  var items = [];
  var raf = 0;
  var last = 0;

  function measure(node) {
    var inner = node.querySelector(".scroller-in");
    if (!inner) return null;
    var over = inner.scrollWidth - node.clientWidth;
    if (over <= 1) return null;
    return { node: node, inner: inner, distance: over, dir: 1, pause: PAUSE, offset: 0 };
  }

  function step(time) {
    if (!last) last = time;
    var delta = time - last;
    last = time;

    items.forEach(function (item) {
      if (item.pause > 0) {
        item.pause -= delta;
        return;
      }
      item.offset += SPEED * delta * item.dir;
      if (item.offset >= item.distance) {
        item.offset = item.distance;
        item.dir = -1;
        item.pause = PAUSE;
      } else if (item.offset <= 0) {
        item.offset = 0;
        item.dir = 1;
        item.pause = PAUSE;
      }
      item.inner.style.transform = "translateX(" + -item.offset + "px)";
    });

    raf = requestAnimationFrame(step);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    items = [];
  }

  function start(root) {
    stop();
    var nodes = (root || document).querySelectorAll("[data-scroll]");
    Array.prototype.forEach.call(nodes, function (node) {
      var item = measure(node);
      if (!item) return;
      node.classList.add("is-overflow");
      items.push(item);
    });
    if (items.length) raf = requestAnimationFrame(step);
    return items.length;
  }

  return { start: start, stop: stop };
})();
