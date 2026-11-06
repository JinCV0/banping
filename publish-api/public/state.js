/*
  老师端状态单例：一份 draft（BoardState v2）+ revision + 脏标记。
  规矩：
  - 页面脚本只改 STATE.state 的副本内容，然后调 STATE.touch()；
  - 真正发给服务端的永远是 STATE.clean() 的产物，空壳在 sanitize.js 里被摘掉；
  - v1 的老快照能读进来（migrate），读不出就退回一份能用的默认板。
*/
(function () {
  "use strict";

  var listeners = [];

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function addDays(iso, days) {
    var parts = String(iso).split("-");
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + days);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // getDay() 的周日是 0，看板用 1..7，所以 0 映射成 7。
  function weekdayOf(iso) {
    var parts = String(iso).split("-");
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var w = d.getDay();
    return w === 0 ? 7 : w;
  }

  function formatCN(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return "";
    var parts = iso.split("-");
    return Number(parts[1]) + "月" + Number(parts[2]) + "日";
  }

  var STATE = {
    state: null,
    revision: 0,
    user: null,
    license: null,
    dirty: false,
    loaded: false,

    util: {
      todayISO: todayISO,
      addDays: addDays,
      weekdayOf: weekdayOf,
      formatCN: formatCN,
      pad: pad,
    },

    subscribe: function (fn) { listeners.push(fn); },
    emit: function (kind) {
      listeners.forEach(function (fn) { fn(kind, STATE); });
    },
    touch: function () {
      if (!STATE.dirty) {
        STATE.dirty = true;
        STATE.emit("dirty");
      }
      STATE.emit("change");
    },
    markSaved: function (revision) {
      STATE.revision = Number(revision) || STATE.revision;
      STATE.dirty = false;
      STATE.emit("saved");
    },

    isMember: function () { return STATE.user && STATE.user.role === "member"; },
    // 账号里的 subject 可能是 id（新老师）也可能是中文名（老账号），两种都认。
    mySubjectId: function () {
      var raw = STATE.user ? String(STATE.user.subject || "") : "";
      if (!raw || !STATE.state) return "";
      var list = STATE.state.subjects || [];
      var hit = list.filter(function (s) { return s.id === raw; })[0] ||
        list.filter(function (s) { return s.name === raw; })[0];
      return hit ? hit.id : raw;
    },
    canEditSubject: function (subject) {
      if (!STATE.isMember()) return true;
      if (!subject) return false;
      var id = STATE.mySubjectId();
      return subject.id === id || subject.name === STATE.user.subject;
    },
    mySubjectName: function () {
      var id = STATE.mySubjectId();
      var list = (STATE.state && STATE.state.subjects) || [];
      var hit = list.filter(function (s) { return s.id === id; })[0];
      return hit ? hit.name : (STATE.user ? String(STATE.user.subject || "") : "");
    },

    // 从服务端拉整份看板；没有就起一份默认板，班级名用 /me 里的。
    load: async function () {
      var res = await API.request("/api/v1/board/state");
      STATE.revision = Number(res && res.revision) || 0;
      var raw = res && res.state ? res.state : null;
      var next = raw ? SANITIZE.migrate(raw) : SANITIZE.defaultState();
      next.revision = STATE.revision;
      var klass = STATE.user && STATE.user.class;
      if (klass && klass.name) next.class = { name: klass.name };
      if (!next.subjects.length) {
        var presets = window.BOARD_SUBJECT_PRESETS || [];
        next.subjects = presets.slice(0, 3).map(function (p) {
          return { id: p.id, name: p.name, color: p.color };
        });
      }
      if (window.MODEL3 && (!next.layout || !next.layout.tiles || !next.layout.tiles.length)) {
        next.layout = MODEL3.cleanLayout(next.layout, next.blocks);
      }
      STATE.state = next;
      STATE.loaded = true;
      STATE.dirty = false;
      STATE.emit("loaded");
      return next;
    },

    clean: function () { return SANITIZE.clean(STATE.state); },

    save: async function () {
      var payload = SANITIZE.clean(STATE.state);
      var res = await API.request("/api/v1/board/state", {
        method: "PUT",
        body: { state: payload, ifRevision: STATE.revision },
      });
      STATE.revision = Number(res && res.revision) || STATE.revision;
      STATE.dirty = false;
      if (STATE.state) {
        STATE.state.revision = STATE.revision;
        STATE.state.updatedAt = (res && res.updatedAt) || STATE.state.updatedAt;
      }
      STATE.emit("saved");
      return res;
    },

    reset: function () {
      STATE.state = null;
      STATE.revision = 0;
      STATE.user = null;
      STATE.license = null;
      STATE.dirty = false;
      STATE.loaded = false;
    },
  };

  window.STATE = STATE;
})();
