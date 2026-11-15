/*
  班级通知
  ---------------------------------------------------------------
  数据：today.notice {text, sign}
  以前它和天气、卫生、活动倒计时并排成三张"自由文本卡"，没有数据源、上线就过期；
  v2 里天气砍掉、卫生并进值日、活动倒计时改成按日期算的倒计时，
  现在它是一块普通磁贴（位置由 layout 决定）。

  视觉：一条竖着的金色细线 + 正文 + 右下角落款，像钉在墙上的一张通知单——
  和作业那种"一条条要抄"的列表不一样，这里是"读一段话"。
*/
(function () {
  var Board = window.Board;
  var L = Board.limits;

  Board.defineBlock({
    type: "notice",
    title: "班级通知",
    skin: "announce",
    render: function (ctx) {
      var notice = ctx.state.today && ctx.state.today.notice;
      if (!notice || !notice.text) return null;

      var body = Board.el("div", "note");
      body.appendChild(Board.wrapLine(Board.clamp(notice.text, L.noticeText), "note-text", 3));
      if (notice.sign) body.appendChild(Board.el("p", "note-sign", Board.clamp(notice.sign, L.noticeSign)));

      return { nodes: [body] };
    },
  });
})();
