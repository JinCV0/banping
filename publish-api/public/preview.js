/*
  实时预览：桌面端右侧常驻的 16:9 就是 /board/index.html。
  只走 window.BOARD_APPLY(nextState) 热替换，绝不 reload iframe —— 重载会闪白，
  而且渲染层每次重建会丢掉"刚刚发布"的手感。改一个字 350ms 后再推，避免逐键抖动。
*/
(function () {
  "use strict";

  var frame = null;
  var label = null;
  var timer = null;
  var ready = false;

  function setLabel(text) {
    if (label) label.textContent = text;
  }

  function stamp() {
    var d = new Date();
    var pad = window.STATE.util.pad;
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function push() {
    if (!frame || !window.STATE || !window.STATE.state) return;
    var win = frame.contentWindow;
    if (!win) return;
    var apply = win.BOARD_APPLY;
    if (typeof apply !== "function") {
      // 渲染层还没起来（首帧 load 之前），等 load 事件再补。
      setLabel("预览加载中…");
      return;
    }
    try {
      apply(window.STATE.clean());
      ready = true;
      fit();
      setLabel("已同步 " + stamp());
    } catch (err) {
      setLabel("预览暂不可用");
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      push();
    }, 350);
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    push();
  }

  // 预览是 1920×1080 的真实渲染，再整体缩到右栏宽度（按 16:9 等比），
  // 这样小窗里看到的排版跟教室那块屏一模一样，不会把磁贴挤成一条。
  function fit() {
    if (!frame) return;
    var box = frame.parentElement;
    if (!box || !box.clientWidth) return;
    frame.style.transform = "scale(" + box.clientWidth / 1920 + ")";
  }

  function init() {
    frame = document.getElementById("preview");
    label = document.getElementById("preview-state");
    if (!frame) return;

    fit();
    window.addEventListener("resize", fit);
    // 右栏可能一开始是隐藏的（窄屏弹层），宽度为 0 时 fit 会跳过；等它有了宽度再量一次
    if (window.ResizeObserver && frame.parentElement) {
      new ResizeObserver(fit).observe(frame.parentElement);
    }

    frame.addEventListener("load", function () {
      ready = false;
      flush();
    });

    if (window.STATE && window.STATE.state) flush();
    else setLabel("预览待发布");
  }

  window.PREVIEW = {
    init: init,
    schedule: schedule,
    flush: flush,
    isReady: function () { return ready; },
  };
})();
