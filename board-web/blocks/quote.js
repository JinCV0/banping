/*
  每日寄语
  ---------------------------------------------------------------
  数据：today.quote {text, sign}
  v2 里它在页面底部通栏；v3 改成独立磁贴，位置/大小由老师端 layout 决定。
  文本折行（最多 3 行），不横跑——寄语是拿来读的，不是拿来追的。

  视觉：这是唯一"不要卡片"的磁贴——没有底、没有标题栏，只有一个大引号和一句话，
  像黑板上随手写的一行字。贴着别的内容一起看时，它是最安静的那块。
*/
(function () {
  var Board = window.Board;
  var L = Board.limits;

  Board.defineBlock({
    type: "quote",
    title: "每日寄语",
    skin: "quote",
    render: function (ctx) {
      var quote = ctx.state.today && ctx.state.today.quote;
      if (!quote || !quote.text) return null;

      var body = Board.el("div", "quote");
      body.appendChild(Board.el("span", "quote-mark", "“"));
      body.appendChild(Board.wrapLine(Board.clamp(quote.text, L.quoteText), "quote-text", 3));
      if (quote.sign) body.appendChild(Board.el("p", "quote-sign", Board.clamp(quote.sign, L.quoteSign)));

      return { nodes: [body] };
    },
  });
})();
