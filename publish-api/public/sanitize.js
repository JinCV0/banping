/*
  把页面里的草稿收口成 BoardState v2 的形状：空壳摘掉、越界截断、非法值回默认。
  纯函数模块，不碰网络也不碰 DOM；state.js 的 load/save 都从这里取结果。
*/
(function () {
  "use strict";

  var DAY_KEYS = ["1", "2", "3", "4", "5", "6", "7"];
  var DEFAULT_PERIODS = [
    ["08:00", "08:40"], ["08:50", "09:30"], ["09:40", "10:20"], ["10:30", "11:10"],
    ["11:20", "12:00"], ["14:00", "14:40"], ["14:50", "15:30"], ["15:40", "16:20"],
  ];
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  var DATE = /^\d{4}-\d{2}-\d{2}$/;

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function isoToday() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function text(value, max) {
    var s = value == null ? "" : String(value).trim();
    return s.length > max ? s.slice(0, max) : s;
  }

  function defaultState() {
    var state = {
      schema: "board-state",
      version: 3,
      revision: 0,
      updatedAt: "",
      class: { name: "" },
      subjects: [],
      periods: DEFAULT_PERIODS.map(function (pair, i) {
        return { index: i + 1, start: pair[0], end: pair[1] };
      }),
      schedule: {},
      overrides: [],
      today: { date: isoToday(), homework: [], todo: [] },
      layout: window.MODEL3 ? MODEL3.cleanLayout(null) : { cols: 12, rows: 8, tiles: [] },
    };
    var presets = window.BOARD_SUBJECT_PRESETS || [];
    var want = ["chinese", "math", "english"];
    want.forEach(function (id) {
      var hit = presets.filter(function (p) { return p.id === id; })[0];
      if (hit) state.subjects.push({ id: hit.id, name: hit.name, color: hit.color });
    });
    if (!state.subjects.length && presets.length) {
      state.subjects.push({ id: presets[0].id, name: presets[0].name, color: presets[0].color });
    }
    DAY_KEYS.forEach(function (key) {
      state.schedule[key] = new Array(state.periods.length).fill("");
    });
    var theme = window.BOARD_THEMES && window.BOARD_THEMES.ink;
    if (theme) {
      state.theme = {
        bg: theme.bg, panel: theme.panel, panelInner: theme.panelInner,
        accent: theme.accent, text: theme.text, muted: theme.muted,
      };
    }
    return state;
  }

  function cleanSubjects(list) {
    var seen = {};
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var item = raw || {};
      var id = String(item.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (!id || !/^[a-z]/.test(id)) return;
      id = id.slice(0, 16);
      if (seen[id]) return;
      var name = text(item.name, window.BOARD_LIMITS ? window.BOARD_LIMITS.subjectName : 6);
      if (!name) return;
      seen[id] = true;
      out.push({ id: id, name: name, color: HEX.test(item.color) ? item.color : "#5b8ff9" });
    });
    return out.slice(0, 20);
  }

  function cleanPeriods(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var item = raw || {};
      if (out.length >= 12) return;
      var start = TIME.test(item.start) ? item.start : "08:00";
      var end = TIME.test(item.end) ? item.end : "08:40";
      out.push({ index: out.length + 1, start: start, end: end });
    });
    if (!out.length) {
      DEFAULT_PERIODS.forEach(function (pair, i) {
        out.push({ index: i + 1, start: pair[0], end: pair[1] });
      });
    }
    return out;
  }

  function cleanDayPlan(raw, count) {
    var out = [];
    for (var i = 0; i < count; i += 1) {
      out.push(text(Array.isArray(raw) ? raw[i] : "", 16));
    }
    return out;
  }

  // v2 里作业按科目 id 引用（"chinese"），不是中文名；这里只认科目表里存在的 id。
  function cleanHomework(list, subjects) {
    var known = {};
    subjects.forEach(function (s) { known[s.id] = true; });
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var entry = raw || {};
      var subject = String(entry.subject || "").trim().slice(0, 16);
      if (!subject || !known[subject]) return;
      var items = [];
      (Array.isArray(entry.items) ? entry.items : []).forEach(function (item) {
        var line = text(item, 42);
        if (line) items.push(line);
      });
      if (!items.length) return;
      if (out.length >= 12) return;
      var row = { subject: subject, items: items.slice(0, 6) };
      var note = text(entry.note, 24);
      if (note) row.note = note;
      out.push(row);
    });
    return out;
  }

  function cleanToday(raw, subjects) {
    var src = raw || {};
    var today = {
      date: DATE.test(src.date) ? src.date : isoToday(),
      homework: cleanHomework(src.homework, subjects),
      todo: (Array.isArray(src.todo) ? src.todo : []).map(function (line) {
        return text(line, 24);
      }).filter(Boolean).slice(0, 6),
    };
    var notice = src.notice || {};
    if (text(notice.text, 60)) {
      var n = { text: text(notice.text, 60) };
      if (text(notice.sign, 16)) n.sign = text(notice.sign, 16);
      today.notice = n;
    }
    if (text((src.duty || {}).text, 40)) today.duty = { text: text(src.duty.text, 40) };
    var quote = src.quote || {};
    if (text(quote.text, 60)) {
      var q = { text: text(quote.text, 60) };
      if (text(quote.sign, 16)) q.sign = text(quote.sign, 16);
      today.quote = q;
    }
    if (window.MODEL3) {
      var call = MODEL3.cleanCall(src.call);
      if (call) today.call = call;
    }
    return today;
  }

  function cleanTheme(raw) {
    var src = raw || {};
    var fallback = (window.BOARD_THEMES && window.BOARD_THEMES.ink) || {};
    var out = {};
    ["bg", "panel", "panelInner", "accent", "text", "muted"].forEach(function (key) {
      out[key] = HEX.test(src[key]) ? src[key] : (fallback[key] || "#000000");
    });
    return out;
  }

  // 整份快照的出口：所有空壳、越界、非法值在这里收口，页面里不用到处判空。
  function clean(draft) {
    var src = draft || {};
    var subjects = cleanSubjects(src.subjects);
    var periods = cleanPeriods(src.periods);
    var schedule = {};
    DAY_KEYS.forEach(function (key) {
      schedule[key] = cleanDayPlan((src.schedule || {})[key], periods.length);
    });
    var overrides = [];
    (Array.isArray(src.overrides) ? src.overrides : []).forEach(function (raw) {
      if (overrides.length >= 60) return;
      var item = raw || {};
      if (!DATE.test(item.date)) return;
      var row = { date: item.date };
      var weekday = Number(item.useWeekday);
      if (item.off === true) row.off = true;
      if (weekday >= 1 && weekday <= 7 && Math.floor(weekday) === weekday) row.useWeekday = weekday;
      if (Array.isArray(item.periods)) row.periods = cleanDayPlan(item.periods, periods.length);
      // 三种类型至少要有一个，空壳直接丢，不然服务端 additionalProperties 会挑毛病。
      if (!row.off && !row.useWeekday && !row.periods) return;
      overrides.push(row);
    });
    var out = {
      schema: "board-state",
      version: 3,
      revision: Number(src.revision) || 0,
      updatedAt: src.updatedAt || "",
      class: { name: text((src.class || {}).name, window.BOARD_LIMITS ? window.BOARD_LIMITS.className : 20) },
      subjects: subjects,
      periods: periods,
      schedule: schedule,
      overrides: overrides,
      today: cleanToday(src.today, subjects),
      theme: cleanTheme(src.theme),
    };
    if (window.MODEL3) {
      out.layout = MODEL3.cleanLayout(src.layout, src.blocks);
      out.roster = MODEL3.cleanRoster(src.roster);
      out.duty = MODEL3.cleanDuty(src.duty);
    }
    var greeting = text((src.greeting || {}).name, 8);
    if (greeting) out.greeting = { name: greeting };
    var countdown = src.countdown || {};
    if (DATE.test(countdown.date) && text(countdown.label, 12)) {
      out.countdown = { label: text(countdown.label, 12), date: countdown.date };
    }
    return out;
  }

  // 老数据（v1 或早期 v2 草稿）里课表/作业写的是中文科目名，统一翻成 id 再落库。
  function normalizeRefs(state) {
    var byName = {};
    (state.subjects || []).forEach(function (s) { byName[s.name] = s.id; });
    function toId(value) {
      if (!value) return value;
      return byName[value] || value;
    }
    var schedule = state.schedule || {};
    Object.keys(schedule).forEach(function (key) {
      schedule[key] = (schedule[key] || []).map(toId);
    });
    (state.overrides || []).forEach(function (item) {
      if (Array.isArray(item.periods)) item.periods = item.periods.map(toId);
    });
    var today = state.today || {};
    (today.homework || []).forEach(function (entry) {
      entry.subject = toId(entry.subject);
    });
    return state;
  }

  // v1 快照没有 overrides/blocks/theme，schedule 也可能是数组；按缺什么补什么。
  function migrate(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    var src = raw;
    if (src.subjects) base.subjects = src.subjects;
    if (src.periods) base.periods = src.periods;
    if (Array.isArray(src.schedule)) {
      var obj = {};
      DAY_KEYS.forEach(function (key, i) { obj[key] = src.schedule[i] || []; });
      base.schedule = obj;
    } else if (src.schedule) {
      base.schedule = src.schedule;
    }
    if (src.overrides) base.overrides = src.overrides;
    if (src.layout) base.layout = src.layout;
    if (src.roster) base.roster = src.roster;
    if (src.duty) base.duty = src.duty;
    if (src.theme) base.theme = src.theme;
    if (src.class) base.class = src.class;
    if (src.greeting) base.greeting = src.greeting;
    if (src.countdown) base.countdown = src.countdown;
    if (src.today) base.today = src.today;
    base.revision = Number(src.revision) || 0;
    base.updatedAt = src.updatedAt || "";
    return normalizeRefs(base);
  }

  window.SANITIZE = { clean: clean, migrate: migrate, defaultState: defaultState };
})();
