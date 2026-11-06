/*
  倒计时
  ---------------------------------------------------------------
  数据：state.countdown {label, date}
  天数由 core/resolve.js 的 countdownOf() 算（日历日差，过期不显示），
  这里只负责摆成"标签 / 大数字 / 日期"，不自己算天、也不接受老师填"还剩几天"。

  视觉：这是整块屏上唯一的"聚光灯"类磁贴之一——没有标题栏，数字最大，
  隔五米第一眼看到的就是它。label 小字在上、日期小字在下，像一张倒计时牌。
  countdown 为空 → 整块不出现（返回 null）。
*/
(function () {
  var Board = window.Board;
  var L = Board.limits;

  Board.defineBlock({
    type: "countdown",
    title: "倒计时",
    skin: "spotlight",
    render: function (ctx) {
      var cd = ctx.d && ctx.d.countdown;
      if (!cd) return null;

      var body = Board.el("div", "cd");
      body.appendChild(Board.el("p", "cd-label", Board.clamp(cd.label, L.countdownLabel)));

      var num = Board.el("p", "cd-num");
      var days = Board.el("span", "cd-days", cd.days);
      /* 2 格宽的磁贴放不下 4.2em 的数字，按宽度收一档 */
      if (ctx.tile && ctx.tile.w <= 2) days.style.fontSize = "3.1em";
      num.appendChild(days);
      num.appendChild(Board.el("span", "cd-unit", "天"));
      body.appendChild(num);

      if (cd.sub) body.appendChild(Board.el("p", "cd-date", cd.sub));

      return { nodes: [body] };
    },
  });
})();
