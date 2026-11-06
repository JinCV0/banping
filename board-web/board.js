/*
  看板装配层 v3（只管"把注册好的磁贴按 layout 摆上去"，不放任何板块自己的逻辑）
  ---------------------------------------------------------------
  数据来源优先级：
    window.BOARD_STATE（宿主注入的缓存） > window.BOARD_SAMPLE（本地演示样例）
  磁贴来源：
    state.layout（12×8 网格）> manifest 的默认模板（老数据/坏数据不白屏）
  主题优先级：
    ?theme=预设 > state.theme > 墨绿
  对外只暴露三个东西：BOARD_APPLY(state) 热替换、BOARD_LINK({online,staleAt}) 离线条，
  以及给宿主/预览用的 window.BOARD_PAIR_RESET（在 pairing.js 里）。

  v3 和 v2 的区别：不再有 main/side/strip 三栏。每块磁贴的格子、字号档位、越界判定
  都在 core/tiles.js 里算好，这里只负责建 DOM、塞内容、收紧字号、起分页。
*/
(function () {
  var Board = window.Board;
  var Resolve = window.BoardResolve;
  var Tiles = window.BoardTiles;

  var els = {
    board: document.getElementById("board"),
    tiles: document.getElementById("tiles"),
    link: document.getElementById("link"),
    greeting: document.querySelector('[data-bind="greeting"]'),
    date: document.querySelector('[data-bind="date"]'),
    badge: document.querySelector('[data-bind="badge"]'),
    clock: document.querySelector('[data-bind="clock"]'),
  };

  var state = window.BOARD_STATE || window.BOARD_SAMPLE || null;
  var lastSig = "";
  var clockTimer = 0;

  function query(name) {
    var hit = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
    return hit ? decodeURIComponent(hit[1]) : "";
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function hhmm(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  /* ---------- 主题 ---------- */
  function applyTheme() {
    var named = query("theme");
    var theme =
      (named && window.BOARD_THEMES && window.BOARD_THEMES[named]) ||
      (state && state.theme) ||
      (window.BOARD_THEMES && window.BOARD_THEMES.ink) ||
      null;
    if (!theme) return;
    var root = document.documentElement;
    ["bg", "panel", "panelInner", "accent", "text", "muted"].forEach(function (key) {
      if (!theme[key]) return;
      root.style.setProperty("--" + key.replace(/[A-Z]/g, function (ch) {
        return "-" + ch.toLowerCase();
      }), theme[key]);
    });
  }

  /* ---------- 哪些磁贴、放哪个格子 ---------- */
  function activeTiles() {
    var tiles = Tiles.list(state, function (type) {
      return Boolean(Board.blockOf(type));
    });

    /* ?blocks= 只给排障/预览用：state 里的 layout 不动，只是这次不画 */
    var only = query("blocks");
    if (only) {
      var keep = only.split(",");
      tiles = tiles.filter(function (tile) {
        return keep.indexOf(tile.block) >= 0;
      });
    }
    return tiles;
  }

  /* ---------- 磁贴外壳（统一外观，板块只管内容） ---------- */
  function tileNode(tile, title, nodes) {
    var root = Board.el("section", "tile tile-" + tile.block);
    /* 板块类型/尺寸/是否轮播写到 data-* 上：字号档位、分页、按板块定样式都靠它，不靠标题文字 */
    root.setAttribute("data-block", tile.block);
    root.setAttribute("data-size", tile.size);
    root.setAttribute("data-flip", tile.flip);
    /*
      skin 决定"这块磁贴怎么说话"，不是装饰：
        list       列表（作业）
        timeline   时间轴（课表）
        checklist  勾选清单（待办）
        roster     名单（值日）
        announce   通知（正文 + 落款）
        spotlight  一个数字 / 一个名字（倒计时、点名）——不要标题栏，内容顶满
        quote      引言（寄语）——不要卡片底
      板块在 defineBlock 里声明，board.js 只负责写到 data-skin 上，样式全在 board.css。
    */
    var spec = Board.blockOf(tile.block);
    if (spec && spec.skin) root.setAttribute("data-skin", spec.skin);
    if (tile.id) root.setAttribute("data-id", tile.id);
    root.style.gridArea = tile.area;

    var head = Board.el("div", "tile-head");
    head.appendChild(Board.el("i", "tile-bar"));
    head.appendChild(Board.el("h2", "tile-title", Board.clamp(title, 12)));
    root.appendChild(head);

    var body = Board.el("div", "tile-body");
    nodes.forEach(function (node) {
      if (node) body.appendChild(node);
    });
    root.appendChild(body);
    return root;
  }

  /* ---------- 头部 ---------- */
  function paintHeader(d, now) {
    var name = (state && state.greeting && state.greeting.name) || "";
    if (els.greeting) els.greeting.textContent = name ? name + "，" + d.greeting : d.greeting;
    if (els.date) {
      var className = state && state.class && state.class.name ? " · " + state.class.name : "";
      els.date.textContent = d.dateCn + className;
    }
    /* 今天跟平常不一样（放假 / 调休 / 临时换课）就在日期后面挂一枚小标 */
    if (els.badge) {
      var badge = (d.plan && d.plan.badge) || "";
      els.badge.textContent = badge;
      els.badge.hidden = !badge;
    }
    if (els.clock) els.clock.textContent = hhmm(now);
  }

  /* ---------- 收紧：磁贴内容溢出时先降字号（版面安全阀） ---------- */
  function fitTiles() {
    var tiles = document.querySelectorAll(".tile");
    Array.prototype.forEach.call(tiles, function (tile) {
      tile.classList.remove("is-tight", "is-tighter");
      var body = tile.querySelector(".tile-body");
      if (!body) return;
      if (body.scrollHeight <= body.clientHeight + 2) return;
      tile.classList.add("is-tight");
      if (body.scrollHeight > body.clientHeight + 2) tile.classList.add("is-tighter");
    });
  }

  function clearTiles() {
    if (els.tiles) els.tiles.textContent = "";
  }

  /*
    reason:
      layout —— 布局里有 tile，但全越界 / 类型不认识（发布端给错了）
      empty  —— 布局是好的，但今天一块数据都没有
  */
  function showEmptyState(reason) {
    if (!els.tiles) return;
    var reasonLayout = reason === "layout";
    var node = Board.el("div", "tile tile-empty");
    node.style.gridArea = "1 / 1 / span 8 / span 12";
    node.appendChild(Board.el(
      "p",
      "empty-title",
      reasonLayout ? "屏幕布局里没有能画的磁贴" : "还没有发布今天的内容"
    ));
    node.appendChild(Board.el(
      "p",
      "empty-sub",
      reasonLayout
        ? "磁贴可能放到 12×8 网格外面了，去老师端的布局页把它们挪回来"
        : "在手机或电脑上打开班级看板，选好科目和课表就能发上来"
    ));
    els.tiles.appendChild(node);
  }

  /* ---------- 主渲染 ---------- */
  function render(next) {
    if (!next || typeof next !== "object") return false;
    state = next;

    var now = new Date();
    var d = Resolve.derive(state, now);
    applyTheme();
    paintHeader(d, now);
    clearTiles();

    if (!els.tiles) return false;
    if (!Tiles) {
      showEmptyState("layout");
      return false;
    }

    var rendered = 0;
    var tiles = activeTiles();

    tiles.forEach(function (tile) {
      var spec = Board.blockOf(tile.block);
      if (!spec || !spec.render) return; // 屏上不认识的块就跳过，不崩

      var meta = Board.manifestOf(tile.block) || {};
      var out = null;
      try {
        out = spec.render({ state: state, now: now, d: d, tile: tile });
      } catch (err) {
        out = null;
      }
      if (!out || !out.nodes || !out.nodes.length) return;

      var title = tile.title || out.title || meta.title || spec.title || tile.block;
      els.tiles.appendChild(tileNode(tile, title, out.nodes));
      rendered += 1;
    });

    if (!rendered) showEmptyState(tiles.length ? "empty" : "layout");

    fitTiles();
    if (window.BoardScroll) window.BoardScroll.start(els.board);
    if (window.BoardPager) window.BoardPager.start(els.board);
    lastSig = signatureOf(now);
    return true;
  }

  function signatureOf(now) {
    var d = Resolve.derive(state, now);
    return d.dateKey + "|" + d.currentPeriod;
  }

  /* ---------- 时钟：只在跨天 / 换节时整屏重算，其余只刷新头部 ---------- */
  function tick() {
    var now = new Date();
    if (els.clock) els.clock.textContent = hhmm(now);
    if (signatureOf(now) !== lastSig) {
      render(state);
      return;
    }
    paintHeader(Resolve.derive(state, now), now);
  }

  window.BOARD_APPLY = function (next) {
    return render(next);
  };

  window.BOARD_LINK = function (info) {
    if (!els.link) return false;
    if (!info || info.online) {
      els.link.hidden = true;
      return true;
    }
    var at = info.staleAt ? new Date(info.staleAt) : null;
    els.link.textContent = "离线 · 数据到 " + (at && !isNaN(at.getTime()) ? hhmm(at) : "—");
    els.link.hidden = false;
    return true;
  };

  if (state) render(state);
  else showEmptyState("empty");

  tick();
  clockTimer = setInterval(tick, 1000);
  window.addEventListener("beforeunload", function () {
    if (clockTimer) clearInterval(clockTimer);
  });
})();
