/*
  今日待办
  ---------------------------------------------------------------
  数据：today.todo[]（最多 6 条，每条 24 字）
  定位和作业区分开：作业是"要写什么"，待办是"要带什么/几点集合"。
  每条直接交给面板 body（不套一层列表容器），这样条数多时 core/pager.js 能按条翻页。
  为空就整块不出现——不留一张写着"暂无"的卡。
*/
(function () {
  var Board = window.Board;
  var L = Board.limits;
  var MAX = 6;

  Board.defineBlock({
    type: "todo",
    title: "今日待办",
    skin: "checklist",
    render: function (ctx) {
      var list = (ctx.state.today && ctx.state.today.todo) || [];
      var texts = list.filter(Boolean).slice(0, MAX);
      if (!texts.length) return null;

      var nodes = texts.map(function (text, index) {
        var item = Board.el("div", "todo-item");
        item.appendChild(Board.el("span", "todo-no", index + 1));
        item.appendChild(Board.wrapLine(Board.clamp(text, L.todoItem), "todo-text", 2));
        return item;
      });

      return { nodes: nodes };
    },
  });
})();
