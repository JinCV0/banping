/*
  溢出轮播（磁贴装不下时轮着显示，而不是把字缩成蚂蚁或把内容截掉）
  ---------------------------------------------------------------
  触发条件：磁贴 body 的子节点加起来比可用高度高（先经过 board.js 的 is-tight 收紧）。
  做法：按现有子节点（一科作业 / 一条待办 / 一行）切成若干"页"，每 9s 换一页，
  切页只加 .is-page-hidden，不重建 DOM，所以字体和跑马灯都不跳。
  为什么不上滚动条：壁纸层拿不到焦点（复刻路径 3.3），滚动条没人能拖。

  v3 起每块磁贴各跑各的：磁贴标了 data-flip="off" 就不分页（老师端明确不想轮播的块）。

  坑（2026-11-03 实测）：新建节点后立刻量高度，拿到的是"磁贴还没被 flex 撑开"的旧值，
  结果按 250px 的假高度切成"一页一科作业"，下面空白一大片。所以先在 rAF 里等一帧
  让布局定型，再量、再切页。
*/
window.BoardPager = (function () {
  var PAGE_MS = 9000;
  var timers = [];

  function stop() {
    timers.forEach(function (timer) {
      clearInterval(timer);
    });
    timers = [];
  }

  function measure(body) {
    // 先把上一轮的隐藏全部恢复，再量真实高度
    var children = Array.prototype.slice.call(body.children);
    children.forEach(function (child) {
      child.classList.remove("is-page-hidden");
    });
    void body.offsetHeight; // 强制回流，拿到 flex 撑开后的真实高度
    return children;
  }

  function buildPages(body) {
    var children = measure(body);
    if (children.length < 2) return null;

    var limit = body.clientHeight;
    if (limit <= 0) return null;

    var style = window.getComputedStyle(body);
    var gap = parseFloat(style.rowGap || style.gap || "0") || 0;

    var pages = [];
    var page = [];
    var used = 0;

    children.forEach(function (child) {
      var height = child.getBoundingClientRect().height;
      if (page.length && used + height + gap > limit + 1) {
        pages.push(page);
        page = [];
        used = 0;
      }
      page.push(child);
      used += height;
    });
    if (page.length) pages.push(page);

    if (window.BOARD_PAGER_DEBUG) {
      window.BOARD_PAGER_DEBUG.push({
        limit: limit,
        gap: gap,
        heights: children.map(function (c) {
          return Math.round(c.getBoundingClientRect().height);
        }),
        pages: pages.length,
        sizes: pages.map(function (p) {
          return p.length;
        }),
      });
    }

    return pages.length > 1 ? pages : null;
  }

  function showPage(pages, index) {
    pages.forEach(function (nodes, pageIndex) {
      nodes.forEach(function (node) {
        node.classList.toggle("is-page-hidden", pageIndex !== index);
      });
    });
  }

  function buildOne(body) {
    var tile = body.closest(".tile");
    if (tile && tile.getAttribute("data-flip") === "off") return; // 老师端关掉了轮播

    var pages = buildPages(body);
    if (!pages) return;

    if (tile) tile.classList.add("is-paged");

    var index = 0;
    showPage(pages, index);
    timers.push(
      setInterval(function () {
        index = (index + 1) % pages.length;
        showPage(pages, index);
      }, PAGE_MS)
    );
  }

  function start(root) {
    stop();
    var bodies = Array.prototype.slice.call(
      (root || document).querySelectorAll(".tile-body")
    );
    if (!bodies.length) return;

    // 等一帧让 flex 布局定型，否则量到的是收缩前的高度
    var frame = window.requestAnimationFrame
      ? function (fn) {
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(fn);
          });
        }
      : function (fn) {
          setTimeout(fn, 32);
        };

    frame(function () {
      bodies.forEach(buildOne);
    });
  }

  return { start: start, stop: stop };
})();
