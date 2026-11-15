/*
  右栏「今日概览」：预览下面那块空白，用当天最该知道的信息填上。
  数据全部来自 STATE + TEAM，不额外请求；任何字段改动都会让这里跟着变。
*/
(function () {
  "use strict";

  var WEEK = ["一", "二", "三", "四", "五", "六", "日"];

  function $(id) { return document.getElementById(id); }

  function nameOf(id) {
    var subjects = (STATE.state && STATE.state.subjects) || [];
    for (var i = 0; i < subjects.length; i += 1) {
      if (subjects[i].id === id) return subjects[i].name;
    }
    return "";
  }

  // 今日课表：临时换课优先，其次「照某天」，再次按星期取整周课表。
  function todayOverride() {
    var state = STATE.state;
    if (!state) return null;
    var iso = state.today.date || STATE.util.todayISO();
    var overrides = state.overrides || [];
    for (var i = 0; i < overrides.length; i += 1) {
      if (overrides[i].date === iso) return overrides[i];
    }
    return null;
  }

  function todayPlan() {
    var state = STATE.state;
    if (!state) return [];
    var week = state.schedule || {};
    var hit = todayOverride();
    if (hit) {
      if (Array.isArray(hit.periods) && hit.periods.length) return hit.periods;
      if (hit.useWeekday) return week[String(hit.useWeekday)] || [];
      if (hit.off) return [];
    }
    var iso = state.today.date || STATE.util.todayISO();
    return week[String(STATE.util.weekdayOf(iso))] || [];
  }

  function minutes(hhmm) {
    var parts = String(hhmm || "").split(":");
    if (parts.length !== 2) return -1;
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function nowMinutes() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function lessonInfo() {
    var hit = todayOverride();
    if (hit && hit.off && !(Array.isArray(hit.periods) && hit.periods.length)) {
      return { main: "今天放假", sub: "不用上课，作业照常", jump: "去课表" };
    }
    var plan = todayPlan();
    var periods = (STATE.state.periods || []).slice();
    var filled = plan.filter(Boolean).length;
    if (!filled) return { main: "今天没有课", sub: "去课表里排一下", jump: "去课表" };

    var now = nowMinutes();
    var i;
    var p;
    for (i = 0; i < periods.length; i += 1) {
      p = periods[i];
      var idx = (p.index || i + 1) - 1;
      if (plan[idx] && minutes(p.start) <= now && now < minutes(p.end)) {
        return { main: "现在 第" + p.index + "节 " + nameOf(plan[idx]), sub: p.start + "–" + p.end, jump: "去课表" };
      }
    }
    for (i = 0; i < periods.length; i += 1) {
      p = periods[i];
      if (plan[(p.index || i + 1) - 1] && minutes(p.start) > now) {
        return { main: "下一节 第" + p.index + "节 " + nameOf(plan[(p.index || i + 1) - 1]), sub: p.start + "–" + p.end, jump: "去课表" };
      }
    }
    return { main: "今天的课上完了", sub: "共 " + filled + " 节", jump: "去课表" };
  }

  function homeworkCount() {
    var list = (STATE.state.today.homework || []).filter(function (entry) {
      return entry.items && entry.items.length;
    });
    var lines = 0;
    list.forEach(function (entry) { lines += entry.items.length; });
    return { subjects: list.length, lines: lines };
  }

  function deviceCount() {
    var me = window.TEAM ? TEAM.data() : null;
    return me && me.devices ? me.devices.length : 0;
  }

  function jumpTo(tab) {
    document.body.classList.remove("preview-open");
    var toggle = $("preview-toggle");
    if (toggle) toggle.textContent = "预览";
    if (window.APP) APP.switchTab(tab);
  }

  function addRow(list, label, value, sub, jumpText, jumpTab) {
    var row = FORM.el("div", "ov-row");
    row.appendChild(FORM.el("dt", null, label));
    var dd = FORM.el("dd");
    dd.appendChild(FORM.el("span", null, value));
    if (sub) dd.appendChild(FORM.el("small", null, sub));
    row.appendChild(dd);
    if (jumpText) {
      var btn = FORM.el("button", "ov-jump", jumpText + " →");
      btn.type = "button";
      btn.addEventListener("click", function () { jumpTo(jumpTab); });
      row.appendChild(btn);
    }
    list.appendChild(row);
  }

  function render() {
    var box = $("preview-overview");
    if (!box || !STATE.state) return;
    var iso = STATE.state.today.date || STATE.util.todayISO();
    var week = WEEK[STATE.util.weekdayOf(iso) - 1] || "";
    var lesson = lessonInfo();
    var homework = homeworkCount();
    var todo = (STATE.state.today.todo || []).length;
    var devices = deviceCount();

    box.textContent = "";
    box.hidden = false;
    var head = FORM.el("div", "overview-head");
    head.appendChild(FORM.el("span", null, "今日概览"));
    box.appendChild(head);

    var list = FORM.el("dl", "overview-list");
    addRow(list, "日期", STATE.util.formatCN(iso) + " 周" + week, iso === STATE.util.todayISO() ? "就是今天" : "发布的不是今天");
    addRow(list, "课程", lesson.main, lesson.sub, lesson.jump, "schedule");
    addRow(list, "作业", homework.subjects + " 科 · " + homework.lines + " 条", homework.subjects ? "已布置" : "还没布置");
    addRow(list, "待办", todo + " 条", todo ? "" : "没有待办");
    addRow(list, "大屏", devices + " 台已绑定", devices ? "" : "还没绑定教室大屏", "去班级", "class");
    box.appendChild(list);
  }

  window.OVERVIEW = { render: render };
})();
