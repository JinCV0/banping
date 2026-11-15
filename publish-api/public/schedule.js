/*
  课表：节次时间 + 周一~周日 × 节次的整周录入 + 校历与调休。
  录一次，之后每天只改作业——这是"别让我每天手填课表"的正面回答。
*/
(function () {
  "use strict";

  var WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  var TYPES = [
    { value: "useWeekday", label: "照某天的课表上" },
    { value: "off", label: "放假不上课" },
    { value: "swap", label: "临时换课" },
  ];
  var root = null;
  var draft = null;

  function touch() {
    if (window.STATE) STATE.touch();
  }

  function toast(text, kind) {
    if (window.APP) APP.toast(text, kind);
  }

  function subjects() { return (STATE.state && STATE.state.subjects) || []; }
  function periods() { return (STATE.state && STATE.state.periods) || []; }
  function schedule() { return (STATE.state && STATE.state.schedule) || {}; }
  function overrides() {
    if (!STATE.state.overrides) STATE.state.overrides = [];
    return STATE.state.overrides;
  }

  // 课表存的是科目 id；下拉里显示中文名，value 必须是 id（服务端与渲染层都按 id 认）。
  function subjectOptions() {
    var list = [{ value: "", label: "空节" }];
    subjects().forEach(function (s) { list.push({ value: s.id, label: s.name }); });
    return list;
  }

  function dayPlanOf(key) {
    var plan = schedule()[key];
    if (!Array.isArray(plan)) plan = [];
    while (plan.length < periods().length) plan.push("");
    return plan.slice(0, periods().length);
  }

  function setCell(key, index, value) {
    var plan = dayPlanOf(key);
    plan[index] = value;
    STATE.state.schedule[key] = plan;
    touch();
  }

  // 改节数时同步截断：课表与调休里的换课数组都按节次长度对齐，否则服务端 schema 不过。
  function resizePlans(count) {
    ["1", "2", "3", "4", "5", "6", "7"].forEach(function (key) {
      var plan = dayPlanOf(key).slice(0, count);
      while (plan.length < count) plan.push("");
      STATE.state.schedule[key] = plan;
    });
    overrides().forEach(function (item) {
      if (!Array.isArray(item.periods)) return;
      var plan = item.periods.slice(0, count);
      while (plan.length < count) plan.push("");
      item.periods = plan;
    });
  }

  function periodRow(period, index, disabled) {
    var tr = FORM.el("tr");
    tr.appendChild(FORM.el("td", "idx", "第 " + (index + 1) + " 节"));

    function timeCell(field) {
      var td = FORM.el("td");
      var input = FORM.el("input");
      input.type = "time";
      input.value = period[field];
      input.disabled = disabled;
      input.addEventListener("change", function () {
        STATE.state.periods[index][field] = input.value || period[field];
        touch();
      });
      td.appendChild(input);
      return td;
    }

    tr.appendChild(timeCell("start"));
    tr.appendChild(timeCell("end"));

    var tdOp = FORM.el("td");
    if (!disabled && periods().length > 1) {
      tdOp.appendChild(FORM.button("删除", function () {
        STATE.state.periods.splice(index, 1);
        STATE.state.periods.forEach(function (p, i) { p.index = i + 1; });
        resizePlans(STATE.state.periods.length);
        touch();
        render(root);
      }, { title: "删掉这一节" }));
    }
    tr.appendChild(tdOp);
    return tr;
  }

  function periodTable(disabled) {
    var table = FORM.el("table", "tbl tbl-periods");
    var head = FORM.el("tr");
    ["节次", "开始", "结束", ""].forEach(function (label) {
      head.appendChild(FORM.el("th", null, label));
    });
    table.appendChild(head);
    periods().forEach(function (period, index) {
      table.appendChild(periodRow(period, index, disabled));
    });

    var wrap = FORM.el("div", "tbl-wrap");
    wrap.appendChild(table);

    var nodes = [wrap];
    if (!disabled) {
      nodes.push(FORM.button("+ 加一节（最多 12 节）", function () {
        var list = STATE.state.periods;
        if (list.length >= 12) return;
        var last = list[list.length - 1] || { start: "08:00", end: "08:40" };
        list.push({ index: list.length + 1, start: last.end, end: last.end });
        resizePlans(list.length);
        touch();
        render(root);
      }));
    }
    return FORM.card({
      title: "节次时间",
      desc: "默认 8 节；节数改了，下面的课表会自动对齐",
      nodes: nodes,
    });
  }

  function weekTable(disabled) {
    var table = FORM.el("table", "tbl tbl-periods");
    var head = FORM.el("tr");
    head.appendChild(FORM.el("th", null, "节次"));
    WEEK.forEach(function (name) { head.appendChild(FORM.el("th", null, name)); });
    table.appendChild(head);

    periods().forEach(function (period, index) {
      var tr = FORM.el("tr");
      tr.appendChild(FORM.el("td", "idx", "第 " + (index + 1) + " 节"));
      ["1", "2", "3", "4", "5", "6", "7"].forEach(function (key) {
        var td = FORM.el("td");
        var select = FORM.el("select");
        subjectOptions().forEach(function (option) {
          var node = FORM.el("option", null, option.label);
          node.value = option.value;
          if (option.value === dayPlanOf(key)[index]) node.selected = true;
          select.appendChild(node);
        });
        select.disabled = disabled;
        select.addEventListener("change", function () { setCell(key, index, select.value); });
        td.appendChild(select);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

    var wrap = FORM.el("div", "tbl-wrap");
    wrap.appendChild(table);
    return FORM.card({
      title: "每周课表",
      desc: "周一~周日 × 节次选科目；周末没课就留「空节」，不会继承周一的课",
      nodes: [wrap],
    });
  }

  function weekdayOptions() {
    return WEEK.map(function (name, i) { return { value: String(i + 1), label: name }; });
  }

  // 某天默认上什么课：已有临时换课用它，调休按目标周几，否则按当天周几。
  function planForDate(date) {
    var iso = String(date || "");
    var count = periods().length;
    var hit = overrides().filter(function (item) { return item.date === iso; })[0];
    var base = [];
    if (hit && Array.isArray(hit.periods) && hit.periods.length) base = hit.periods;
    else if (hit && hit.useWeekday) base = schedule()[String(hit.useWeekday)] || [];
    else if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) base = schedule()[String(STATE.util.weekdayOf(iso))] || [];
    var plan = base.slice(0, count);
    while (plan.length < count) plan.push("");
    return plan;
  }

  function ensureDraft() {
    if (!draft) {
      draft = {
        date: STATE.util.addDays(STATE.util.todayISO(), 1),
        type: "useWeekday",
        weekday: STATE.util.weekdayOf(STATE.util.addDays(STATE.util.todayISO(), 1)),
        periods: [],
      };
    }
    return draft;
  }

  function swapGrid(d, disabled) {
    if (!Array.isArray(d.periods) || d.periods.length !== periods().length) {
      d.periods = planForDate(d.date);
    }
    var grid = FORM.el("div", "override-grid");
    periods().forEach(function (period, index) {
      grid.appendChild(FORM.selectBox("第 " + (index + 1) + " 节", subjectOptions(), d.periods[index] || "", function (value) {
        d.periods[index] = value;
      }, { disabled: disabled }));
    });
    return grid;
  }

  function saveDraft() {
    var d = ensureDraft();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      toast("先选一个日期", "warn");
      return;
    }
    var item = { date: d.date };
    if (d.type === "off") item.off = true;
    else if (d.type === "useWeekday") item.useWeekday = Number(d.weekday) || 1;
    else {
      var plan = planForDate(d.date);
      d.periods.forEach(function (value, i) { if (i < plan.length) plan[i] = value || ""; });
      item.periods = plan;
    }
    var list = overrides();
    var index = -1;
    list.forEach(function (row, i) { if (row.date === item.date) index = i; });
    if (index >= 0) list[index] = item;
    else if (list.length >= 60) {
      toast("调休最多 60 条，先删几条旧的", "warn");
      return;
    } else list.push(item);
    touch();
    toast("已保存 " + STATE.util.formatCN(item.date) + " 的校历", "ok");
    render(root);
  }

  function entryNodes(disabled) {
    var d = ensureDraft();
    var row = FORM.el("div", "cal-entry");
    row.appendChild(FORM.textBox("日期", d.date, 0, function (value) {
      d.date = value;
      // 「照某天」默认就照这一天本身；想换别的周几再自己选。
      if (d.type === "useWeekday" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        d.weekday = STATE.util.weekdayOf(value);
      }
      if (d.type === "swap") d.periods = planForDate(value);
      render(root);
    }, { type: "date", disabled: disabled }));
    row.appendChild(FORM.selectBox("类型", TYPES, d.type, function (value) {
      d.type = value;
      if (value === "swap") d.periods = planForDate(d.date);
      render(root);
    }, { disabled: disabled }));
    if (d.type === "useWeekday") {
      row.appendChild(FORM.selectBox("按周几", weekdayOptions(), String(d.weekday), function (value) {
        d.weekday = Number(value) || 1;
      }, { disabled: disabled }));
    }
    var nodes = [row];
    if (d.type === "swap") nodes.push(swapGrid(d, disabled));
    if (!disabled) nodes.push(FORM.button("保存这一天", saveDraft));
    return nodes;
  }

  function kindText(item) {
    if (item.off) return "放假";
    if (item.useWeekday) return "照" + (WEEK[item.useWeekday - 1] || "") + "的课表上";
    return "临时换课";
  }

  function overrideRow(item, index, disabled) {
    var row = FORM.el("div", "cal-row");
    var main = FORM.el("div", "cal-main");
    main.appendChild(FORM.el("span", "cal-date", STATE.util.formatCN(item.date) + " " + (WEEK[STATE.util.weekdayOf(item.date) - 1] || "")));
    main.appendChild(FORM.el("span", "cal-kind", "· " + kindText(item)));
    row.appendChild(main);
    if (!disabled) {
      row.appendChild(FORM.button("删除", function () {
        overrides().splice(index, 1);
        touch();
        render(root);
      }, { title: "删掉这一天的配置" }));
    }
    return row;
  }

  function calendarCard(disabled) {
    var nodes = entryNodes(disabled);
    var list = overrides().slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var box = FORM.el("div", "cal-list");
    if (!list.length) box.appendChild(FORM.el("p", "empty", "还没有调休或临时换课。"));
    list.forEach(function (item) {
      box.appendChild(overrideRow(item, overrides().indexOf(item), disabled));
    });
    nodes.push(box);
    nodes.push(FORM.el("p", "note", "同一天再保存一次会覆盖原来的配置；最多 60 条。"));
    return FORM.card({
      title: "校历与调休",
      desc: "周末上课、放假、临时换课都在这录一次，大屏按当天自动显示",
      nodes: nodes,
    });
  }

  function render(container) {
    root = container;
    root.textContent = "";
    if (!STATE.state) return;

    var disabled = STATE.isMember();
    // 课表宁可竖着排：右侧常驻预览吃掉 41% 宽度，两列并排会把 7 天挤成横向滚动。
    var grid = FORM.el("div", "grid grid-1");
    if (disabled) {
      grid.appendChild(FORM.hintLine("你是任课老师（" + STATE.mySubjectName() + "）：课表由班主任维护，这里只读。", true));
    }
    grid.appendChild(periodTable(disabled));
    grid.appendChild(weekTable(disabled));
    grid.appendChild(calendarCard(disabled));
    root.appendChild(grid);
  }

  window.SCHEDULE = { render: render };
})();
