/*
  布局页签：12×8 磁贴画布。
  - 拖磁贴 = 改位置；拉右下角 = 改大小；× = 删；底部「+ 添加磁贴」从 v3 的 8 种 block 里选。
  - 放下时吸格；越界夹回；和已有磁贴重叠就弹回原处并给一条短提示。
  - 所有改动只写 STATE.state.layout.tiles 再 STATE.touch()，保存仍走底部「保存并发布」。
*/
(function () {
  "use strict";

  var COLS = 12;
  var ROWS = 8;
  var root = null;
  var stage = null;
  var presets = null;

  /* 预置布局来自服务端（和建班时写进快照的是同一份），只取一次 */
  function loadPresets(done) {
    if (presets) return done(presets);
    API.request("/api/v1/board/presets")
      .then(function (res) {
        presets = res.layouts || [];
        done(presets);
      })
      .catch(function () { done([]); });
  }

  function applyPreset(preset) {
    STATE.state.layout = {
      cols: COLS,
      rows: ROWS,
      tiles: preset.tiles.map(function (tile) {
        return { id: tile.id, block: tile.block, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
      }),
    };
    STATE.touch();
    render(root);
    APP.toast("已套用「" + preset.name + "」");
  }

  function askPreset(preset) {
    if (!tiles().length) return applyPreset(preset);
    MODAL.open({
      title: "套用「" + preset.name + "」？",
      nodes: [
        FORM.el("p", "modal-text", preset.desc || ""),
        FORM.el("p", "modal-text", "现在的 " + tiles().length + " 块磁贴会被换掉——只是摆放变了，内容还在。"),
      ],
      actions: [
        { text: "先不换", primary: false },
        { text: "套用这套", onClick: function () { applyPreset(preset); } },
      ],
    });
  }

  function presetRow() {
    var row = FORM.el("div", "preset-row");
    row.appendChild(FORM.el("span", "preset-label", "预置布局"));
    var list = FORM.el("div", "preset-list");
    row.appendChild(list);
    loadPresets(function (items) {
      items.forEach(function (preset) {
        var btn = FORM.el("button", "preset-btn");
        btn.type = "button";
        btn.title = preset.desc || "";
        btn.appendChild(FORM.el("span", "preset-name", preset.name));
        btn.addEventListener("click", function () { askPreset(preset); });
        list.appendChild(btn);
      });
    });
    return row;
  }

  function tiles() {
    return (STATE.state.layout && STATE.state.layout.tiles) || [];
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function catalog() {
    return window.MODEL3 ? MODEL3.blocks() : [];
  }

  function overlaps(probe, skipId) {
    return tiles().some(function (tile) {
      if (tile.id === skipId) return false;
      return probe.x < tile.x + tile.w && tile.x < probe.x + probe.w &&
        probe.y < tile.y + tile.h && tile.y < probe.y + probe.h;
    });
  }

  // 位置/大小都按百分比写，画布比例一变，磁贴跟着缩，不会错位。
  function paint(node, tile) {
    node.style.left = ((tile.x - 1) / COLS * 100) + "%";
    node.style.top = ((tile.y - 1) / ROWS * 100) + "%";
    node.style.width = (tile.w / COLS * 100) + "%";
    node.style.height = (tile.h / ROWS * 100) + "%";
    var size = node.querySelector(".tile-size");
    if (size) size.textContent = tile.w + "×" + tile.h;
  }

  function cells(rect) {
    return { w: rect.width / COLS, h: rect.height / ROWS };
  }

  function dragEnd(node, tile, probe) {
    if (overlaps(probe, tile.id)) {
      paint(node, tile);
      APP.toast("和别的磁贴重叠了，已弹回原位");
      return;
    }
    tile.x = probe.x;
    tile.y = probe.y;
    tile.w = probe.w;
    tile.h = probe.h;
    paint(node, tile);
    STATE.touch();
  }

  // 拖动：pointerdown 记起点，pointermove 只改预览，pointerup 再决定提交还是回弹。
  function beginDrag(event, tile, node) {
    if (STATE.isMember() || event.target.closest("button, .tile-resize")) return;
    var rect = stage.getBoundingClientRect();
    var cell = cells(rect);
    var start = { x: event.clientX, y: event.clientY };
    var probe = { x: tile.x, y: tile.y, w: tile.w, h: tile.h };
    node.setPointerCapture(event.pointerId);
    node.classList.add("is-dragging");

    function move(ev) {
      probe.x = clamp(tile.x + Math.round((ev.clientX - start.x) / cell.w), 1, COLS - tile.w + 1);
      probe.y = clamp(tile.y + Math.round((ev.clientY - start.y) / cell.h), 1, ROWS - tile.h + 1);
      paint(node, probe);
    }
    function up() {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.classList.remove("is-dragging");
      dragEnd(node, tile, probe);
    }
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }

  function beginResize(event, tile, node) {
    if (STATE.isMember()) return;
    event.stopPropagation();
    var rect = stage.getBoundingClientRect();
    var cell = cells(rect);
    var start = { x: event.clientX, y: event.clientY };
    var probe = { x: tile.x, y: tile.y, w: tile.w, h: tile.h };
    node.setPointerCapture(event.pointerId);
    node.classList.add("is-resizing");

    function move(ev) {
      probe.w = clamp(tile.w + Math.round((ev.clientX - start.x) / cell.w), 1, COLS - tile.x + 1);
      probe.h = clamp(tile.h + Math.round((ev.clientY - start.y) / cell.h), 1, ROWS - tile.y + 1);
      paint(node, probe);
    }
    function up() {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.classList.remove("is-resizing");
      dragEnd(node, tile, probe);
    }
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }

  function removeTile(id) {
    var list = tiles();
    var index = list.map(function (t) { return t.id; }).indexOf(id);
    if (index < 0) return;
    list.splice(index, 1);
    STATE.touch();
    render(root);
  }

  /*
    画布上的磁贴画的是"这块长什么样"，不是"标题 + 一句说明"：
    一排排完全相同的说明框，老师拖之前根本分不清哪块是清单、哪块是时间轴。
    这里只画骨架（不给真实数据），真内容在右边预览里。
  */
  function skeleton(block) {
    var wrap = FORM.el("div", "tile-sk tile-sk-" + block);
    var i;

    function line(extra) {
      return FORM.el("i", "sk-line" + (extra ? " " + extra : ""));
    }

    if (block === "homework") {
      for (i = 0; i < 5; i++) {
        var row = FORM.el("div", "sk-row");
        row.appendChild(FORM.el("i", "sk-chip" + (i ? " is-alt" : "")));
        var col = FORM.el("div", "sk-col");
        col.appendChild(line());
        col.appendChild(line("is-short"));
        row.appendChild(col);
        wrap.appendChild(row);
      }
      return wrap;
    }

    if (block === "timetable") {
      for (i = 0; i < 6; i++) {
        var tt = FORM.el("div", "sk-row sk-tt" + (i === 2 ? " is-now" : ""));
        tt.appendChild(FORM.el("i", "sk-time"));
        tt.appendChild(FORM.el("i", "sk-dot"));
        tt.appendChild(line(i === 5 ? "is-short" : ""));
        wrap.appendChild(tt);
      }
      return wrap;
    }

    if (block === "todo") {
      for (i = 0; i < 3; i++) {
        var item = FORM.el("div", "sk-row sk-todo");
        item.appendChild(FORM.el("i", "sk-num"));
        item.appendChild(line(i === 2 ? "is-short" : ""));
        wrap.appendChild(item);
      }
      return wrap;
    }

    if (block === "duty") {
      for (i = 0; i < 3; i++) wrap.appendChild(FORM.el("i", "sk-pill"));
      return wrap;
    }

    if (block === "notice") {
      wrap.appendChild(line());
      wrap.appendChild(line("is-short"));
      wrap.appendChild(FORM.el("i", "sk-sign"));
      return wrap;
    }

    if (block === "countdown") {
      wrap.appendChild(FORM.el("i", "sk-label"));
      wrap.appendChild(FORM.el("i", "sk-big", "99"));
      wrap.appendChild(FORM.el("i", "sk-date"));
      return wrap;
    }

    if (block === "rollcall") {
      wrap.appendChild(FORM.el("i", "sk-label"));
      wrap.appendChild(FORM.el("i", "sk-name", "名字"));
      wrap.appendChild(FORM.el("i", "sk-date"));
      return wrap;
    }

    if (block === "quote") {
      wrap.appendChild(FORM.el("i", "sk-quote", "“"));
      wrap.appendChild(line());
      wrap.appendChild(line("is-short"));
      return wrap;
    }

    return wrap;
  }

  function tileNode(item) {
    var node = FORM.el("div", "tile");
    node.dataset.id = item.id;
    node.dataset.block = item.block;
    node.style.gridArea = item.y + " / " + item.x + " / span " + item.h + " / span " + item.w;

    var head = FORM.el("div", "tile-head");
    head.appendChild(FORM.el("span", "tile-title", window.MODEL3 ? MODEL3.blockTitle(item.block) : item.block));
    head.appendChild(FORM.el("span", "tile-size", item.w + "×" + item.h));
    if (!STATE.isMember()) {
      var close = FORM.el("button", "tile-x", "×");
      close.type = "button";
      close.title = "删除这块磁贴";
      close.addEventListener("click", function () { removeTile(item.id); });
      head.appendChild(close);
    }
    node.appendChild(head);

    var body = FORM.el("div", "tile-body");
    var meta = catalog().filter(function (b) { return b.block === item.block; })[0];
    body.appendChild(skeleton(item.block));
    /* 说明文字挪进悬停提示：版面上只留形状，不铺一行字 */
    if (meta && meta.desc) body.title = meta.desc;
    node.appendChild(body);

    if (!STATE.isMember()) {
      var handle = FORM.el("div", "tile-resize");
      handle.title = "拖动改大小";
      handle.addEventListener("pointerdown", function (ev) { beginResize(ev, item, node); });
      node.appendChild(handle);
      node.addEventListener("pointerdown", function (ev) { beginDrag(ev, item, node); });
    }
    paint(node, item);
    return node;
  }

  function uniqueId(block) {
    var used = {};
    tiles().forEach(function (tile) { used[tile.id] = true; });
    if (!used[block]) return block;
    var n = 2;
    while (used[block + "-" + n]) n += 1;
    return block + "-" + n;
  }

  function firstFreeSpot(meta) {
    for (var y = 1; y <= ROWS - meta.h + 1; y += 1) {
      for (var x = 1; x <= COLS - meta.w + 1; x += 1) {
        var probe = { x: x, y: y, w: meta.w, h: meta.h };
        if (!overlaps(probe, "")) return probe;
      }
    }
    return null;
  }

  function placeTile(block) {
    var meta = catalog().filter(function (b) { return b.block === block; })[0];
    if (!meta) return;
    var spot = firstFreeSpot(meta);
    if (!spot) {
      APP.toast("12×8 已经放满了，先删一块再添加");
      return;
    }
    tiles().push({
      id: uniqueId(block), block: block,
      x: spot.x, y: spot.y, w: meta.w, h: meta.h,
    });
    STATE.touch();
    render(root);
  }

  function picker() {
    var list = FORM.el("div", "tile-picks");
    catalog().forEach(function (meta) {
      var row = FORM.el("button", "tile-pick");
      row.type = "button";
      row.appendChild(FORM.el("span", "tile-pick-title", meta.title));
      row.appendChild(FORM.el("span", "tile-pick-size", meta.w + "×" + meta.h));
      row.appendChild(FORM.el("span", "tile-pick-desc", meta.desc || ""));
      row.addEventListener("click", function () {
        MODAL.close();
        placeTile(meta.block);
      });
      list.appendChild(row);
    });
    MODAL.open({
      title: "添加磁贴",
      nodes: [FORM.el("p", "modal-sub", "选了就放进画布上第一个空位，再拖到你想要的地方。"), list],
      dismissable: true,
      actions: [{ text: "取消", primary: false }],
    });
  }

  function render(container) {
    root = container;
    root.textContent = "";
    if (!STATE.state) return;
    if (!STATE.state.layout) STATE.state.layout = MODEL3.cleanLayout(null);

    var add = FORM.button("+ 添加磁贴", picker, { ghost: false });
    if (STATE.isMember()) return;
    var card = FORM.card({
      title: "布局",
      desc: "12 × 8 网格。拖磁贴改位置，拉右下角改大小，× 删除；越界会夹回，重叠会弹回。",
      actions: [add],
    });

    stage = FORM.el("div", "tile-stage");
    var canvas = FORM.el("div", "tile-canvas");
    tiles().forEach(function (item) { canvas.appendChild(tileNode(item)); });
    stage.appendChild(canvas);
    card.appendChild(presetRow());
    card.appendChild(stage);
    card.appendChild(FORM.hintLine("大屏按 16:9 显示；磁贴装不下时渲染层会自己缩字/翻页。"));
    root.appendChild(card);
  }

  window.LAYOUT = { render: render };
})();
