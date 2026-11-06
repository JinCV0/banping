/*
  今日作业
  ---------------------------------------------------------------
  数据：today.homework[]（科目 id + 最多 6 条 + 一行科目通知）
  为什么要有"科目通知"：老师真正想单独喊一句的是"明天带字典 / 周五交实验报告"，
  以前只能把这句话混进作业条目里，或者手写一张自由文本卡。
  今天的日期和 today.date 对不上时，标题老老实实写"11月3日 作业"，不谎称今日。
*/
(function () {
  var Board = window.Board;
  var L = Board.limits;
  var MAX_ITEMS = 6;
  var MAX_SUBJECTS = 12;

  function chip(subject) {
    var node = Board.el("div", "hw-chip", subject.name);
    if (subject.color) node.style.setProperty("--chip", subject.color);
    return node;
  }

  function itemNode(text, index) {
    var line = Board.el("div", "hw-item");
    line.appendChild(Board.el("span", "hw-no", index + 1));
    var body = Board.el("div", "hw-text");
    // 作业是要抄下来的一条条信息：折行、不限行数——磁贴是老师拖出来的，写死两行会把后半句吃掉
    body.appendChild(Board.wrapLine(Board.clamp(text, L.homeworkItem), "hw-item-text", 0));
    line.appendChild(body);
    return line;
  }

  function noteNode(text) {
    var note = Board.el("div", "hw-note");
    note.appendChild(Board.el("span", "hw-note-tag", "通知"));
    note.appendChild(Board.wrapLine(Board.clamp(text, L.homeworkNote), "hw-note-text", 2));
    return note;
  }

  function rowNode(entry, subjects) {
    var subject = subjects[entry.subject];
    if (!subject) return null; // 科目被删了/数据脏了就别硬渲染
    var row = Board.el("div", "hw-row");
    row.appendChild(chip(subject));

    var body = Board.el("div", "hw-body");
    var items = (entry.items || []).slice(0, MAX_ITEMS);
    items.forEach(function (text, index) {
      if (!text) return;
      body.appendChild(itemNode(text, index));
    });
    if (entry.note) body.appendChild(noteNode(entry.note));
    if (!body.childNodes.length) return null;

    row.appendChild(body);
    return row;
  }

  Board.defineBlock({
    type: "homework",
    title: "今日作业",
    skin: "list",
    render: function (ctx) {
      var today = ctx.state.today;
      if (!today || !today.homework || !today.homework.length) return null;

      var subjects = ctx.d.subjects;
      var rows = [];
      today.homework.slice(0, MAX_SUBJECTS).forEach(function (entry) {
        var row = rowNode(entry, subjects);
        if (row) rows.push(row);
      });
      if (!rows.length) return null;

      var title = today.date === ctx.d.dateKey
        ? "今日作业"
        : window.BoardResolve.formatMonthDay(today.date) + " 作业";

      return { title: title, nodes: rows };
    },
  });
})();
