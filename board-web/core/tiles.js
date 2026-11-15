/*
  磁贴布局（纯函数：只算格子，不碰 DOM，也不读写全局状态）
  ---------------------------------------------------------------
  契约（docs/board-v3.md 第 2 节）：
    layout = { cols: 12, rows: 8, tiles: [{ id, block, x, y, w, h, title?, flip? }] }
  x / y 从 1 开始（左上角是 1,1），grid-area 写成 "y / x / span h / span w"。

  为什么"越界"要在这里兜：schema 只校验单值范围（x 1..12、w 1..12），
  12 宽的格子放到 x=8 也过校验，但画出来会顶出网格、把整块版面撑爆。
  docs 的约定是渲染端把这种 tile 裁掉不画——所以校验放在这里，board.js 不看原数据。

  另外两类"坏 tile"也在这里处理：
    · block 不是屏上认识的类型（老师端新加了块、大屏还没升级）→ 不画；
    · id 缺失/不合模式 → 只影响老师端认人，不影响显示，给个空 id 照画，
      不因为一个 id 把内容丢掉；标题超长交给 CSS 省略号，不在这里截。
*/
window.BoardTiles = (function () {
  var COLS = 12;
  var ROWS = 8;
  var ID_RE = /^[a-z][a-z0-9_-]{0,23}$/;

  /*
    老样子模板（v2 版面的 5 个块，按 docs/board-v3.md 第 5 节）：
    数据里没有 layout 时用它兜底，别让一块能显示的班牌变成白屏。
    blocks/manifest.js 也会带一份 window.BOARD_DEFAULT_TILES（发布端只引 manifest、
    不引这个文件），list() 优先用那一份，保持一致。
  */
  var DEFAULT_TILES = [
    { id: "hw", block: "homework", x: 1, y: 1, w: 7, h: 4 },
    { id: "todo", block: "todo", x: 8, y: 1, w: 5, h: 2 },
    { id: "tt", block: "timetable", x: 8, y: 3, w: 5, h: 3 },
    { id: "duty", block: "duty", x: 1, y: 5, w: 4, h: 2 },
    { id: "notice", block: "notice", x: 5, y: 5, w: 4, h: 2 },
  ];

  /*
    每块的最小可用尺寸（老师端加磁贴时按这个拦；README 也列了一份）。
    小于它不是说画不出来，是"只能看到一条、全靠 9s 翻页"，实际不好用：
      homework 4×2   4 个科目/页起
      timetable 3×3  两列格子，8 节要 4 行
      todo 3×2       三行文字
      notice 3×2     两行正文
      duty 3×2       4 个名字换行
      rollcall 2×2   名字大字 + 时间
      countdown 3×2  大数字 + 标签 + 日期
      quote 3×2      两行寄语
  */
  var MIN = {
    homework: { w: 4, h: 2 },
    timetable: { w: 3, h: 3 },
    todo: { w: 3, h: 2 },
    notice: { w: 3, h: 2 },
    duty: { w: 3, h: 2 },
    rollcall: { w: 2, h: 2 },
    countdown: { w: 3, h: 2 },
    quote: { w: 3, h: 2 },
  };

  function isInt(value) {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
  }

  function areaOf(tile) {
    return tile.y + " / " + tile.x + " / span " + tile.h + " / span " + tile.w;
  }

  /*
    字号档位：只决定磁贴内基准字号（CSS 里 --tile-fs），不决定内容怎么排。
    判据是"宽度优先、再看面积"——同样 2 行高，7 宽和 2 宽的可用字号差一倍。
    一行高（h=1）或两行高的大块各压一档：那是通条/横条，不是大字卡。
  */
  function sizeOf(w, h) {
    var cells = w * h;
    var tier = "xs";
    if (cells >= 28 && w >= 7 && h >= 4) tier = "xl";
    else if (w >= 6 || h >= 5 || cells >= 15) tier = "lg";
    else if (w >= 5 || h >= 4 || cells >= 9) tier = "md";
    else if (w >= 3 || h >= 3 || cells >= 4) tier = "sm";
    if (h <= 1 && tier !== "xs") tier = "sm";
    if (h <= 2 && tier === "xl") tier = "lg";
    return tier;
  }

  function normalize(raw, cols, rows, known) {
    if (!raw || typeof raw !== "object") return null;

    var block = typeof raw.block === "string" ? raw.block : "";
    if (!block) return null;
    if (typeof known === "function" && !known(block)) return null;

    if (!isInt(raw.x) || !isInt(raw.y) || !isInt(raw.w) || !isInt(raw.h)) return null;
    if (raw.x < 1 || raw.y < 1 || raw.w < 1 || raw.h < 1) return null;

    var c = isInt(cols) && cols > 0 ? cols : COLS;
    var r = isInt(rows) && rows > 0 ? rows : ROWS;
    if (raw.x + raw.w - 1 > c || raw.y + raw.h - 1 > r) return null; // 越界：整块不画

    var tile = {
      id: typeof raw.id === "string" && ID_RE.test(raw.id) ? raw.id : "",
      block: block,
      x: raw.x,
      y: raw.y,
      w: raw.w,
      h: raw.h,
      flip: raw.flip === "off" ? "off" : "auto",
      cells: raw.w * raw.h,
      size: sizeOf(raw.w, raw.h),
    };
    if (typeof raw.title === "string" && raw.title.trim()) tile.title = raw.title.trim();
    tile.area = areaOf(tile);
    return tile;
  }

  function fallbackTiles(known) {
    var source = Array.isArray(window.BOARD_DEFAULT_TILES) && window.BOARD_DEFAULT_TILES.length
      ? window.BOARD_DEFAULT_TILES
      : DEFAULT_TILES;
    var out = [];
    source.forEach(function (raw) {
      var tile = normalize(raw, COLS, ROWS, known);
      if (tile) out.push(tile);
    });
    return out;
  }

  /*
    state.layout → 渲染用的磁贴数组。
    没有 layout（老数据 / 坏数据 / 发布端还没迁移）→ 用默认模板，不白屏。
    layout 存在但一块都摆不下（全越界 / 类型不认识）→ 返回空数组，
    由 board.js 画"布局坏了"的空态，不要假装有内容。
  */
  function list(state, known) {
    var layout = state && state.layout;
    if (!layout || typeof layout !== "object" || !Array.isArray(layout.tiles)) {
      return fallbackTiles(known);
    }
    var out = [];
    layout.tiles.forEach(function (raw) {
      var tile = normalize(raw, layout.cols, layout.rows, known);
      if (tile) out.push(tile);
    });
    return out;
  }

  function minOf(block) {
    return MIN[block] || null;
  }

  /* 给老师端的"这个尺寸够不够"提示用；渲染端不拿它做拦截 */
  function isUnderMin(tile) {
    var min = MIN[tile && tile.block];
    if (!min) return false;
    return tile.w < min.w || tile.h < min.h;
  }

  return {
    COLS: COLS,
    ROWS: ROWS,
    DEFAULT_TILES: DEFAULT_TILES,
    MIN: MIN,
    areaOf: areaOf,
    sizeOf: sizeOf,
    normalize: normalize,
    list: list,
    minOf: minOf,
    isUnderMin: isUnderMin,
  };
})();
