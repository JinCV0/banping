/*
  班级：班级信息、科目表、主题、板块开关。
  科目表是这次改版的另一个正面回答——17 个预设 + 自定义，班里有几科就开几科；
  删科目时顺手把课表里指向它的格子清空，不留悬空字符串。
*/
(function () {
  "use strict";

  var L = window.BOARD_LIMITS || {};
  var root = null;

  function touch() {
    if (window.STATE) STATE.touch();
  }

  function presets() { return window.BOARD_SUBJECT_PRESETS || []; }
  function palette() { return window.BOARD_SUBJECT_COLORS || ["#5b8ff9"]; }

  function hasSubject(id) {
    return (STATE.state.subjects || []).some(function (s) { return s.id === id; });
  }

  function findSubject(id) {
    var list = STATE.state.subjects || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function clearSubjectUse(id) {
    var schedule = STATE.state.schedule || {};
    Object.keys(schedule).forEach(function (key) {
      schedule[key] = (schedule[key] || []).map(function (value) {
        return value === id ? "" : value;
      });
    });
    (STATE.state.overrides || []).forEach(function (item) {
      item.periods = (item.periods || []).map(function (value) {
        return value === id ? "" : value;
      });
    });
    STATE.state.today.homework = (STATE.state.today.homework || []).filter(function (entry) {
      return entry.subject !== id;
    });
  }

  function removeSubject(id) {
    var subject = findSubject(id);
    if (!subject) return;
    STATE.state.subjects = STATE.state.subjects.filter(function (s) { return s.id !== id; });
    clearSubjectUse(subject.id);
    touch();
    render(root);
  }

  function nextCustomId() {
    var n = 1;
    while (hasSubject("custom" + n)) n += 1;
    return "custom" + n;
  }

  // 改名走服务端接口，成功后用返回的 user 就地刷新，不整页重载。
  function saveClassName(input, button) {
    var limit = L.className || 20;
    var name = String(input.value || "").trim();
    if (!name) {
      APP.toast("班级名不能为空", "warn");
      return;
    }
    if (name.length > limit) {
      APP.toast("班级名最多 " + limit + " 字", "warn");
      return;
    }
    button.disabled = true;
    API.request("/api/v1/class/rename", { method: "POST", body: { name: name } }).then(function (res) {
      var user = (res && res.user) || STATE.user;
      STATE.user = user;
      var named = user && user.class && user.class.name ? user.class.name : name;
      if (STATE.state) STATE.state.class = { name: named };
      if (window.APP && APP.paintWho) APP.paintWho();
      if (window.PREVIEW) PREVIEW.schedule();
      APP.toast("班级名已改为「" + named + "」", "ok");
      render(root);
    }).catch(function (err) {
      APP.toast((err && err.message) || "改名失败，请稍后再试", "warn");
      button.disabled = false;
    });
  }

  function classCard() {
    var member = STATE.isMember();
    var klass = STATE.user && STATE.user.class ? STATE.user.class : {};
    var current = (STATE.state.class || {}).name || klass.name || "";
    var nodes = [];

    if (member) {
      nodes.push(FORM.textBox("班级名称", current, 0, function () {}, {
        disabled: true,
        hint: "只有班主任能改名。",
      }));
    } else {
      var nameBox = FORM.textBox("班级名称", current, L.className || 20, function () {}, {
        hint: "1–20 字；保存后顶栏、大屏和这里会一起更新。",
      });
      var saveBtn = FORM.button("保存", function () {
        saveClassName(nameBox.querySelector("input"), saveBtn);
      });
      nameBox.appendChild(saveBtn);
      nodes.push(nameBox);
    }

    if (klass.code) {
      var row = FORM.el("div", "field");
      row.appendChild(FORM.el("div", "field-label", "班级码"));
      row.appendChild(FORM.el("span", "code", klass.code));
      row.appendChild(FORM.el("p", "field-hint", "把班级码发给任课老师，配合登录码登录。"));
      nodes.push(row);
    }

    nodes.push(FORM.textBox("大屏称呼", (STATE.state.greeting || {}).name || "", L.greetingName || 8, function (value) {
      var name = String(value || "").trim();
      if (name) STATE.state.greeting = { name: name };
      else delete STATE.state.greeting;
      touch();
    }, { disabled: member, placeholder: "如：三班的同学们", hint: "大屏问候语里怎么称呼大家，最多 8 字。" }));

    return FORM.card({ title: "班级信息", desc: "班级名与班级码", nodes: nodes });
  }

  function presetChips(disabled) {
    var wrap = FORM.el("div", "chips");
    presets().forEach(function (preset) {
      var on = hasSubject(preset.id);
      var chip = FORM.el("button", on ? "chip is-on" : "chip");
      chip.type = "button";
      chip.disabled = disabled;
      var dot = FORM.el("i", "subject-dot");
      dot.style.background = preset.color;
      chip.appendChild(dot);
      chip.appendChild(FORM.el("span", null, preset.name));
      chip.addEventListener("click", function () {
        if (hasSubject(preset.id)) {
          removeSubject(preset.id);
          return;
        }
        if ((STATE.state.subjects || []).length >= 20) return;
        STATE.state.subjects.push({ id: preset.id, name: preset.name, color: preset.color });
        touch();
        render(root);
      });
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function customRow(subject, index, disabled) {
    var row = FORM.el("div", "custom-subject");
    var name = FORM.el("input");
    name.type = "text";
    name.value = subject.name;
    name.maxLength = L.subjectName || 6;
    name.disabled = disabled;
    name.addEventListener("input", function () {
      subject.name = name.value;
      touch();
    });
    row.appendChild(name);

    var swatches = FORM.el("div", "swatches");
    palette().slice(0, 8).forEach(function (color) {
      var swatch = FORM.el("button", subject.color === color ? "swatch is-on" : "swatch");
      swatch.type = "button";
      swatch.disabled = disabled;
      swatch.style.background = color;
      swatch.title = color;
      swatch.addEventListener("click", function () {
        subject.color = color;
        touch();
        render(root);
      });
      swatches.appendChild(swatch);
    });
    row.appendChild(swatches);

    if (!disabled) {
      row.appendChild(FORM.button("删除", function () { removeSubject(subject.id); }));
    }
    return row;
  }

  function subjectCard() {
    var member = STATE.isMember();
    var nodes = [];
    if (member) {
      nodes.push(FORM.hintLine("科目表由班主任维护；你这一科是「" + STATE.mySubjectName() + "」。", true));
    }
    nodes.push(presetChips(member));

    var custom = (STATE.state.subjects || []).filter(function (s) {
      return !presets().some(function (p) { return p.id === s.id; });
    });
    if (custom.length) {
      var box = FORM.el("div", "section-gap");
      box.appendChild(FORM.el("p", "note", "自定义科目"));
      custom.forEach(function (subject, index) {
        box.appendChild(customRow(subject, index, member));
      });
      nodes.push(box);
    }

    if (!member) {
      var addRow = FORM.el("div", "custom-subject section-gap");
      var input = FORM.el("input");
      input.type = "text";
      input.placeholder = "自定义科目名（≤6 字）";
      input.maxLength = L.subjectName || 6;
      addRow.appendChild(input);
      addRow.appendChild(FORM.button("添加", function () {
        var name = String(input.value || "").trim().slice(0, L.subjectName || 6);
        if (!name) return;
        if ((STATE.state.subjects || []).length >= 20) return;
        var color = palette()[(STATE.state.subjects || []).length % palette().length];
        STATE.state.subjects.push({ id: nextCustomId(), name: name, color: color });
        touch();
        render(root);
      }, { ghost: false }));
      nodes.push(addRow);
    }

    return FORM.card({
      title: "科目表",
      desc: "勾上的科目会出现在大屏和今日作业里（最多 20 科）",
      nodes: nodes,
    });
  }

  function themeCard() {
    var member = STATE.isMember();
    var themes = window.BOARD_THEMES || {};
    var nodes = [];
    Object.keys(themes).forEach(function (key) {
      var theme = themes[key];
      var current = STATE.state.theme || {};
      var on = current.bg === theme.bg && current.panel === theme.panel;
      var btn = FORM.el("button", on ? "theme-card is-on" : "theme-card");
      btn.type = "button";
      btn.disabled = member;
      var dots = FORM.el("span", "theme-dots");
      [theme.bg, theme.panel, theme.accent, theme.text].forEach(function (color) {
        var dot = FORM.el("i");
        dot.style.background = color;
        dots.appendChild(dot);
      });
      btn.appendChild(dots);
      var text = FORM.el("span");
      text.appendChild(FORM.el("span", "theme-name", theme.name || key));
      text.appendChild(FORM.el("span", "theme-sub", theme.bg + " / " + theme.accent));
      btn.appendChild(text);
      btn.addEventListener("click", function () {
        STATE.state.theme = {
          bg: theme.bg, panel: theme.panel, panelInner: theme.panelInner,
          accent: theme.accent, text: theme.text, muted: theme.muted,
        };
        touch();
        render(root);
      });
      nodes.push(btn);
    });
    return FORM.card({ title: "主题", desc: "大屏配色，三选一", nodes: nodes });
  }

  function render(container) {
    root = container;
    root.textContent = "";
    if (!STATE.state) return;
    var grid = FORM.el("div", "grid");
    grid.appendChild(classCard());
    grid.appendChild(subjectCard());
    grid.appendChild(themeCard());
    if (window.ROSTER) ROSTER.render(grid);
    if (window.TEAM) grid.appendChild(window.TEAM.card());
    root.appendChild(grid);
  }

  window.SETTINGS = { render: render };
})();

