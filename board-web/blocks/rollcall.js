/*
  今日点名（抽一个）
  ---------------------------------------------------------------
  数据：today.call {name, at?}
  at 是抽到的时间（ISO）。规则（docs/board-v3.md 第 3 节）：
    · 超过 24 小时就不再显示——早读抽的人，晚自习还挂在屏上就成笑话了；
    · at 缺失/写坏时只显示名字，不判断过期（没有时间就没法算）。

  视觉：和倒计时同属"聚光灯"——没有标题栏，名字占满整块，全班都看得见。
  名字超过三个字自动降一档字号，不换行、不挤成两行。
*/
(function () {
  var Board = window.Board;

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function hhmm(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function parseAt(text) {
    if (!text) return null;
    var date = new Date(text);
    return isNaN(date.getTime()) ? null : date;
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  Board.defineBlock({
    type: "rollcall",
    title: "今日点名",
    skin: "spotlight",
    render: function (ctx) {
      var call = ctx.state.today && ctx.state.today.call;
      if (!call || !call.name) return null;

      var at = parseAt(call.at);
      if (at && ctx.now.getTime() - at.getTime() > 24 * 3600 * 1000) return null;

      var body = Board.el("div", "call");
      body.appendChild(Board.el("p", "call-kicker", "今日点名"));

      var name = Board.el("p", "call-name", Board.clamp(call.name, 12));
      /*
        名字字号按"几个字 + 磁贴几格宽"定：字号是 em，跟着磁贴字号档位缩，
        但四个字放在 2 格宽的磁贴上仍然放不下，所以这里再按字数收一档。
      */
      var chars = String(call.name || "").length;
      var narrow = ctx.tile ? ctx.tile.w <= 2 : false;
      var size = 3;
      if (chars > 2) size = narrow ? 1.7 : 2.5;
      if (chars > 3) size = narrow ? 1.4 : 2.0;
      name.style.fontSize = size + "em";
      body.appendChild(name);

      if (at) {
        var lead = sameDay(at, ctx.now) ? "今天 " : "";
        body.appendChild(Board.el("p", "call-time", lead + hhmm(at) + " 抽到"));
      }
      return { nodes: [body] };
    },
  });
})();
