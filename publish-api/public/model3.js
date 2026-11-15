/*
  BoardState v3 的数据模型：12×8 磁贴布局、花名册、值日规则、点名。
  纯函数，不碰 DOM；sanitize.js 的 clean/migrate 和老师端各屏都从这里取规则，
  这样"磁贴能不能放""值日该谁"只有一处算法。

  manifest 由 board-web 维护（board-web/blocks/manifest.js）：
    BOARD_BLOCKS      [{ type, title, w, h, on, desc }]  ← 添加磁贴菜单的默认尺寸
    BOARD_DEFAULT_TILES [{ id, block, x, y, w, h }]      ← 12×8 默认布局
  manifest 还没升级到 v3 时，下面的内置清单兜底，页面不会空。
*/
(function () {
  "use strict";

  var BLOCKS = [
    { block: "homework", title: "今日作业", w: 7, h: 4, desc: "按科目发布的作业" },
    { block: "todo", title: "今日待办", w: 5, h: 2, desc: "带东西、集合、活动" },
    { block: "timetable", title: "今日课表", w: 5, h: 3, desc: "今天第几节上什么" },
    { block: "notice", title: "班级通知", w: 4, h: 2, desc: "一段话通知，带署名" },
    { block: "duty", title: "今日值日", w: 4, h: 2, desc: "按值日规则自动排" },
    { block: "rollcall", title: "随机点名", w: 4, h: 2, desc: "显示最近抽到的学生" },
    { block: "countdown", title: "倒计时", w: 3, h: 2, desc: "距离考试还有几天" },
    { block: "quote", title: "每日寄语", w: 5, h: 2, desc: "一句话 + 署名" },
  ];
  var BLOCK_NAMES = {};
  BLOCKS.forEach(function (item) { BLOCK_NAMES[item.block] = true; });

  // v2 老样子 → v3 的固定模板：升级后屏上的东西一点不少，只是从此可以拖。
  var LEGACY_TILES = [
    { id: "homework", block: "homework", x: 1, y: 1, w: 7, h: 4 },
    { id: "todo", block: "todo", x: 8, y: 1, w: 5, h: 2 },
    { id: "timetable", block: "timetable", x: 8, y: 3, w: 5, h: 3 },
    { id: "duty", block: "duty", x: 1, y: 5, w: 4, h: 2 },
    { id: "notice", block: "notice", x: 5, y: 5, w: 4, h: 2 },
  ];

  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  var STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  var STUDENT_ID = /^[a-z0-9]{4,16}$/;
  var TILE_ID = /^[a-z][a-z0-9_-]{0,23}$/;

  function text(value, max) {
    var s = value == null ? "" : String(value).trim();
    return s.length > max ? s.slice(0, max) : s;
  }

  function int(value, min, max, fallback) {
    var n = Number(value);
    if (n !== n || !isFinite(n)) return fallback;
    n = Math.round(n);
    return Math.max(min, Math.min(max, n));
  }

  function parseISO(iso) {
    var parts = String(iso).split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function isoOf(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function stampOf(date) {
    return isoOf(date) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
  }

  function blockCatalog() {
    var fromManifest = Array.isArray(window.BOARD_BLOCKS) ? window.BOARD_BLOCKS : [];
    return BLOCKS.map(function (item) {
      var hit = fromManifest.filter(function (b) { return b && b.type === item.block; })[0];
      return {
        block: item.block,
        title: (hit && hit.title) || item.title,
        w: (hit && hit.w) || item.w,
        h: (hit && hit.h) || item.h,
        desc: (hit && hit.desc) || item.desc,
      };
    });
  }

  function blockTitle(block) {
    var hit = blockCatalog().filter(function (b) { return b.block === block; })[0];
    return hit ? hit.title : block;
  }

  function defaultTiles() {
    var preset = window.BOARD_DEFAULT_TILES;
    if (Array.isArray(preset) && preset.length) {
      return preset.map(function (tile) {
        return { id: tile.id, block: tile.block, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
      });
    }
    return LEGACY_TILES.map(function (tile) {
      return { id: tile.id, block: tile.block, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
    });
  }

  function fromBlocks(blocks) {
    var present = {};
    (Array.isArray(blocks) ? blocks : []).forEach(function (b) {
      if (b && b.type) present[b.type] = true;
    });
    if (!Object.keys(present).length) return defaultTiles();
    var out = LEGACY_TILES.filter(function (tile) { return present[tile.block]; });
    return out.length ? out.map(function (tile) {
      return { id: tile.id, block: tile.block, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
    }) : defaultTiles();
  }

  function tileId(raw, used) {
    var id = String(raw || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!/^[a-z]/.test(id)) id = "t" + id;
    id = id.slice(0, 24);
    if (!id) id = "tile";
    var base = id;
    var n = 2;
    while (used[id]) {
      id = (base.slice(0, 20) + n);
      n += 1;
    }
    return id;
  }

  function clampTile(tile) {
    tile.w = int(tile.w, 1, 12, 4);
    tile.h = int(tile.h, 1, 8, 2);
    tile.x = int(tile.x, 1, 12, 1);
    tile.y = int(tile.y, 1, 8, 1);
    if (tile.x + tile.w - 1 > 12) tile.x = 13 - tile.w;
    if (tile.y + tile.h - 1 > 8) tile.y = 9 - tile.h;
    return tile;
  }

  function cleanTiles(list) {
    var used = {};
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      if (out.length >= 12) return;
      var src = raw || {};
      if (!BLOCK_NAMES[src.block]) return;
      var id = tileId(src.id || src.block, used);
      used[id] = true;
      out.push(clampTile({
        id: id, block: src.block,
        x: Number(src.x), y: Number(src.y), w: Number(src.w), h: Number(src.h),
      }));
    });
    return out;
  }

  function cleanLayout(raw, legacyBlocks) {
    var src = raw || {};
    var tiles;
    if (Array.isArray(src.tiles)) tiles = cleanTiles(src.tiles);
    else if (Array.isArray(legacyBlocks) && legacyBlocks.length) tiles = cleanTiles(fromBlocks(legacyBlocks));
    else tiles = cleanTiles(defaultTiles());
    return { cols: 12, rows: 8, tiles: tiles };
  }

  function newStudentId(used) {
    var id = "";
    do {
      id = "s" + Math.random().toString(36).slice(2, 7);
    } while (used[id] || !STUDENT_ID.test(id));
    return id;
  }

  function cleanRoster(raw) {
    var src = raw || {};
    var used = {};
    var students = [];
    (Array.isArray(src.students) ? src.students : []).forEach(function (item) {
      if (students.length >= 80) return;
      var row = item || {};
      var name = text(row.name, 12);
      if (!name) return;
      var id = String(row.id || "").toLowerCase();
      if (!STUDENT_ID.test(id) || used[id]) id = newStudentId(used);
      used[id] = true;
      var student = { id: id, name: name };
      var no = text(row.no, 6);
      if (no) student.no = no;
      students.push(student);
    });
    var out = { students: students };
    if (STAMP.test(src.updatedAt)) out.updatedAt = String(src.updatedAt);
    return out;
  }

  function cleanDuty(raw) {
    var src = raw || {};
    var mode = ["weekly", "daily", "off"].indexOf(src.mode) >= 0 ? src.mode : "off";
    var rule = { mode: mode, size: int(src.size, 1, 8, 4) };
    if (DATE.test(src.anchor)) rule.anchor = src.anchor;
    return rule;
  }

  function cleanCall(raw) {
    var src = raw || {};
    var name = text(src.name, 12);
    if (!name) return null;
    return { name: name, at: STAMP.test(src.at) ? String(src.at) : stampOf(new Date()) };
  }

  function defaultAnchor(iso) {
    var year = Number(String(iso).slice(0, 4)) || new Date().getFullYear();
    var september = year + "-09-01";
    return iso < september ? (year - 1) + "-09-01" : september;
  }

  // 值日分组：按花名册顺序每 size 人一组，周/天从 anchor 算，取模轮转。
  function dutyFor(students, duty, iso) {
    var names = (students || []).map(function (s) { return s.name; });
    var rule = cleanDuty(duty);
    var out = { names: [], index: 0, groups: 0, mode: rule.mode, size: rule.size };
    if (rule.mode === "off" || !names.length) return out;
    out.groups = Math.ceil(names.length / rule.size);
    var anchor = rule.anchor || defaultAnchor(iso);
    var days = Math.floor((parseISO(iso) - parseISO(anchor)) / 86400000);
    var step = rule.mode === "weekly" ? Math.floor(days / 7) : days;
    var index = ((step % out.groups) + out.groups) % out.groups;
    out.index = index + 1;
    out.names = names.slice(index * rule.size, index * rule.size + rule.size);
    return out;
  }

  window.MODEL3 = {
    blocks: blockCatalog,
    blockTitle: blockTitle,
    defaultTiles: defaultTiles,
    fromBlocks: fromBlocks,
    cleanTiles: cleanTiles,
    cleanLayout: cleanLayout,
    cleanRoster: cleanRoster,
    cleanDuty: cleanDuty,
    cleanCall: cleanCall,
    dutyFor: dutyFor,
    newStudentId: newStudentId,
    stampOf: stampOf,
    isoOf: isoOf,
  };
})();
