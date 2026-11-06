/*
  板块注册表 + 小工具
  ---------------------------------------------------------------
  一个板块 = 一个文件，文件里调用 Board.defineBlock({type,title,render}) 自注册；
  board.js 只按 layout.tiles 的顺序挨个问"你有数据吗"，有就渲染，没有就整块不出现。
  这样新增板块不需要动 board.js，也不需要动 CSS（样式挂在 .tile 上）。

  render(ctx) 返回值：
    null / undefined  → 这块今天没东西，别显示（不允许空壳磁贴）
    { title?, nodes: Node[] } → title 覆盖默认标题，nodes 直接塞进磁贴主体
  ctx：{ state, now, d, tile } —— d 是 core/resolve.js 算好的派生数据（星期、今天的课、倒计时…），
       tile 是 core/tiles.js 算好的格子（w/h/size/flip，块可以按尺寸决定要不要换紧凑写法）。
*/
window.Board = (function () {
  var LIMITS = window.BOARD_LIMITS || {};
  var blocks = {};

  function defineBlock(spec) {
    if (!spec || !spec.type) return;
    blocks[spec.type] = spec;
  }

  function blockOf(type) {
    return blocks[type] || null;
  }

  function manifest() {
    return (window.BOARD_BLOCKS || []).slice();
  }

  function manifestOf(type) {
    var hit = null;
    manifest().forEach(function (item) {
      if (item.type === type) hit = item;
    });
    return hit;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /* 版面安全阀：数据正常时不该触发；超长就截断，别把大屏顶爆 */
  function clamp(value, limit) {
    var text = value === undefined || value === null ? "" : String(value).replace(/\s+/g, " ").trim();
    var max = limit || 0;
    if (!max || text.length <= max) return text;
    return text.slice(0, Math.max(0, max - 1)) + "…";
  }

  /* 一行放不下时交给 core/scroll.js 横向滚动（不加 data-scroll 就是硬截断） */
  function scrollLine(text, className) {
    var wrap = el("div", className ? "scroller " + className : "scroller");
    wrap.setAttribute("data-scroll", "");
    wrap.appendChild(el("span", "scroller-in", text));
    return wrap;
  }

  /*
    整段文字：按行折行，超过行数用省略号收尾（不横跑、不硬裁）。
    给"要读的信息"用——通知、待办、值日这类，教室里隔五米横跑的字根本追不上。
  */
  function wrapLine(text, className, maxLines) {
    var node = el("div", className || "");
    // maxLines <= 0 表示不限行：磁贴宽度由老师拖，写死行数会把字吃掉
    if (!(maxLines <= 0)) {
      node.classList.add("clamp");
      node.style.setProperty("--lines", String(maxLines || 2));
    }
    node.textContent = text;
    return node;
  }

  function emptyHint(text) {
    return el("p", "empty-hint", text);
  }

  return {
    limits: LIMITS,
    defineBlock: defineBlock,
    blockOf: blockOf,
    manifest: manifest,
    manifestOf: manifestOf,
    el: el,
    clamp: clamp,
    scrollLine: scrollLine,
    wrapLine: wrapLine,
    emptyHint: emptyHint,
  };
})();
