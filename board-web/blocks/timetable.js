/*
  今日课表（自动的）
  ---------------------------------------------------------------
  数据：subjects + periods + schedule[星期]（+ overrides 临时换课），
  星期几由 core/resolve.js 按系统时间算，老师录一次整周就不用再管。
  正在上的那一节用 .is-now 标出来——这是"今天"和"今天是周几"的差别。

  视觉：一条时间轴（时间 → 圆点 → 科目 → 节次），不是一堆格子。
  课的先后就是一天的先后，竖着读下来正好对上作息；正在上的那节整行点亮。
*/
(function () {
  var Board = window.Board;

  /* 节次 → 上课时间（老师端课表里配的作息） */
  function timesOf(state) {
    var map = {};
    (state.periods || []).forEach(function (period) {
      if (period && period.index) map[period.index] = period.start || "";
    });
    return map;
  }

  function rowNode(entry, currentPeriod, times) {
    var row = Board.el("div", "tt-row");
    row.appendChild(Board.el("span", "tt-time", times[entry.index] || ""));

    var dot = Board.el("i", "tt-dot");
    if (entry.subject && entry.subject.color) dot.style.setProperty("--chip", entry.subject.color);
    row.appendChild(dot);

    row.appendChild(Board.el("span", "tt-subject", entry.subject ? entry.subject.name : "空"));
    row.appendChild(Board.el("span", "tt-no", entry.index));

    if (!entry.subject) row.classList.add("is-empty");
    if (currentPeriod === entry.index && entry.subject) row.classList.add("is-now");
    return row;
  }

  function restNode(main, sub) {
    var node = Board.el("div", "tt-off");
    node.appendChild(Board.el("span", "tt-off-main", main));
    node.appendChild(Board.el("span", "tt-off-sub", sub));
    return node;
  }

  Board.defineBlock({
    type: "timetable",
    title: "今日课表",
    skin: "timeline",
    render: function (ctx) {
      var plan = ctx.d.plan;

      /*
        休息日：明说不上课。这不是"没数据"，是"今天确实没课"，
        所以不按空板块处理——周末没排课、法定假日放假都走这里。
      */
      if (plan && plan.off) {
        return { title: "今日课表", nodes: [restNode("今天放假", plan.weekdayCn + "，不上课")] };
      }
      if (plan && plan.empty && plan.weekday >= 6) {
        return { title: "今日课表", nodes: [restNode("今天休息", plan.weekdayCn + "，没有排课")] };
      }

      if (!plan || plan.empty) return null;

      var times = timesOf(ctx.state);
      var list = Board.el("div", "tt");
      plan.entries.forEach(function (entry) {
        list.appendChild(rowNode(entry, ctx.d.currentPeriod, times));
      });

      /*
        星期几写进标题，不占版面。调休那天要同时说清"今天周几、上哪天的课"，
        否则家长看见周六挂着周二的课会以为数据错了。
      */
      var title = "今日课表 · " + plan.weekdayCn;
      if (plan.fromOverride && plan.baseWeekday !== plan.weekday) {
        title = "今日课表 · " + plan.weekdayCn + "上" + plan.baseWeekdayCn + "的课";
      } else if (plan.fromOverride) {
        title = "今日课表 · 临时换课";
      }
      return { title: title, nodes: [list] };
    },
  });
})();
