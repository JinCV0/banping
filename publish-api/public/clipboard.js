/*
  复制文本：优先 Clipboard API，失败回退到临时 textarea + execCommand。
  老师端只在 127.0.0.1 / https 下跑，走安全上下文；回退是给老浏览器兜底。
*/
(function () {
  "use strict";

  function legacy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  function copy(text, done) {
    var value = String(text == null ? "" : text);
    function finish(ok) { if (done) done(ok); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () {
        finish(true);
      }, function () {
        finish(legacy(value));
      });
      return;
    }
    finish(legacy(value));
  }

  window.CLIP = { copy: copy };
})();
