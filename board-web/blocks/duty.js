/*
  今日值日
  ---------------------------------------------------------------
  两种数据，手写的优先：
    ① today.duty.text —— 老师写的一句"第三组：擦窗、倒垃圾"（v2 老字段，保留兼容）；
    ② state.duty + state.roster —— 按花名册顺序每 size 人一组，weekly 按周次、daily 按天数轮换。
       规则见 docs/board-v3.md 第 3 节：组号 = floor(从 anchor 经过的周数/天数) % 组数；
       anchor 缺省用当年 9 月 1 日（开学）。算不出来（没花名册 / mode off）就整块不出现。

  磁贴上只放名字和组号，不放"值日内容"——内容是老师手写那句才有的东西。
*/
(function () {
  var Board = window.Board;
  var L = Board.limits;
  var Resolve = window.BoardResolve;
  var DAY_MS = 86400000;

  function todayStart(now) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function anchorOf(duty, now) {
    var anchor = duty.anchor ? Resolve.parseDate(duty.anchor) : null;
    if (!anchor) anchor = new Date(now.getFullYear(), 8, 1); // 当年 9 月 1 日
    return todayStart(anchor);
  }

  function groupsOf(state, size) {
    var students = (state.roster && state.roster.students) || [];
    var list = students.filter(function (student) {
      return student && student.name;
    });
    var groups = [];
    for (var i = 0; i < list.length; i += size) groups.push(list.slice(i, i + size));
    return groups;
  }

  /*
    经过多少周/天：按本地日历日算，不用小时除——夏令时/跨零点都不至于错一组。
    floor 对负数也成立（anchor 在未来时 step 是负的），取模后再补正。
  */
  function rotationOf(mode, anchor, now, count) {
    var days = Math.round((todayStart(now) - anchor) / DAY_MS);
    var step = mode === "weekly" ? Math.floor(days / 7) : days;
    var index = step % count;
    if (index < 0) index += count;
    return { index: index, step: step };
  }

  function chipRow(names) {
    var row = Board.el("div", "duty-chips");
    names.forEach(function (name) {
      var chip = Board.el("span", "duty-chip");
      chip.appendChild(Board.el("i", "duty-dot"));
      chip.appendChild(Board.el("span", "duty-name", Board.clamp(name, 12)));
      row.appendChild(chip);
    });
    return row;
  }

  Board.defineBlock({
    type: "duty",
    title: "今日值日",
    skin: "roster",
    render: function (ctx) {
      var state = ctx.state;
      var now = ctx.now;
      var today = state.today || {};
      var manual = today.duty && today.duty.text ? Board.clamp(today.duty.text, L.dutyText) : "";
      var rule = state.duty || {};
      var mode = rule.mode === "weekly" || rule.mode === "daily" ? rule.mode : "off";
      var size = Math.max(1, Math.min(8, Math.round(Number(rule.size) || 1)));

      var title = "今日值日";
      var names = null;
      var groupNo = 0;
      var groupCount = 0;

      if (!manual && mode !== "off") {
        var groups = groupsOf(state, size);
        if (groups.length) {
          var picked = rotationOf(mode, anchorOf(rule, now), now, groups.length);
          names = groups[picked.index].map(function (student) {
            return student.name;
          });
          groupNo = picked.index + 1;
          groupCount = groups.length;
          title = mode === "weekly" ? "本周值日" : "今日值日";
        }
      }

      /* 手写优先；没手写又算不出来就不出现（不留一块"暂无值日"的空壳） */
      if (!manual && !names) return null;

      var body = Board.el("div", "duty");
      var narrow = ctx.tile ? ctx.tile.w <= 2 : false;

      if (manual) {
        body.appendChild(Board.wrapLine(manual, "duty-text", 3));
      } else if (narrow) {
        /* 窄磁贴：名字连成一句，别让 4 个色块各占一行把格子撑爆 */
        body.appendChild(Board.wrapLine(names.join(" · "), "duty-text duty-names", 3));
      } else {
        body.appendChild(chipRow(names));
      }

      if (names) {
        body.appendChild(Board.el(
          "p",
          "duty-meta",
          "第 " + groupNo + " 组 · 共 " + groupCount + " 组"
        ));
      }
      return { title: title, nodes: [body] };
    },
  });
})();
