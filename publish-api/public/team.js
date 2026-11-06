/*
  班级页的两块"人/设备"：任课老师（登录码）与教室大屏（配对/解除）。
  只有班主任能管理；任课老师进来看到一句说明就够了。
*/
(function () {
  "use strict";

  var data = null;

  function el(tag, cls, text) { return FORM.el(tag, cls, text); }

  // 老师账号里存科目 id（新）或中文名（老账号）；列表统一显示中文名。
  function subjectLabel(raw) {
    var list = (STATE.state && STATE.state.subjects) || [];
    var hit = list.filter(function (s) { return s.id === raw || s.name === raw; })[0];
    return hit ? hit.name : String(raw || "");
  }

  function subjectOptions() {
    var list = [{ value: "", label: "选择科目" }];
    ((STATE.state && STATE.state.subjects) || []).forEach(function (s) {
      list.push({ value: s.id, label: s.name });
    });
    return list;
  }

  function reload(done) {
    API.request("/api/v1/me").then(function (me) {
      data = me;
      if (window.STATE) {
        STATE.user = me.user || STATE.user;
        STATE.license = me.license || STATE.license;
      }
      // 设备数变了，右栏概览的「大屏 N 台」要跟着变。
      if (window.OVERVIEW) OVERVIEW.render();
      if (done) done();
    }).catch(function () {
      if (done) done();
    });
  }

  function teacherRow(teacher) {
    var row = el("div", "list-row");
    var who = el("div");
    who.appendChild(el("div", "who-name", teacher.name));
    who.appendChild(el("div", "who-sub", teacher.subject ? subjectLabel(teacher.subject) : "未填科目"));
    row.appendChild(who);
    row.appendChild(el("span", "spacer"));

    if (teacher.login_code) row.appendChild(el("span", "code", teacher.login_code));
    else row.appendChild(el("span", "code is-off", "已收回"));

    var actions = el("div", "row-actions");
    if (teacher.login_code) {
      actions.appendChild(FORM.button("换码", function () {
        API.request("/api/v1/teachers/code", { method: "POST", body: { userId: teacher.id } })
          .then(function () { reload(function () { window.APP.renderPane("class"); }); })
          .catch(function (err) { window.APP.toast(err.message, "error"); });
      }, { title: "旧码立即失效" }));
      actions.appendChild(FORM.button("收回", function () {
        if (!window.confirm("收回后 " + teacher.name + " 将无法用旧码登录，确定？")) return;
        API.request("/api/v1/teachers/code", { method: "DELETE", body: { userId: teacher.id } })
          .then(function () { reload(function () { window.APP.renderPane("class"); }); })
          .catch(function (err) { window.APP.toast(err.message, "error"); });
      }));
    } else {
      actions.appendChild(FORM.button("再发一个码", function () {
        API.request("/api/v1/teachers/code", { method: "POST", body: { userId: teacher.id } })
          .then(function () { reload(function () { window.APP.renderPane("class"); }); })
          .catch(function (err) { window.APP.toast(err.message, "error"); });
      }, { ghost: false }));
    }
    row.appendChild(actions);
    return row;
  }

  function teachersCard() {
    var nodes = [];
    var list = (data && data.teachers) || [];
    if (!list.length) nodes.push(el("p", "empty", "还没有任课老师。加一位，把登录码发给他，他就只能改自己那一科。"));

    list.forEach(function (teacher) { nodes.push(teacherRow(teacher)); });

    var form = el("div", "inline section-gap");
    var nameInput = el("input");
    nameInput.type = "text";
    nameInput.placeholder = "老师姓名（≤12 字）";
    nameInput.maxLength = 12;
    var subjectSelect = el("select");
    subjectOptions().forEach(function (option) {
      var node = el("option", null, option.label);
      node.value = option.value;
      subjectSelect.appendChild(node);
    });
    form.appendChild(nameInput);
    form.appendChild(subjectSelect);
    form.appendChild(FORM.button("+ 添加任课老师", function () {
      var name = String(nameInput.value || "").trim();
      var subject = subjectSelect.value;
      if (!name) { window.APP.toast("先填老师姓名", "error"); return; }
      if (!subject) { window.APP.toast("先选他教哪一科", "error"); return; }
      API.request("/api/v1/teachers", { method: "POST", body: { name: name, subject: subject } })
        .then(function (res) {
          var code = res && res.teacher ? res.teacher.loginCode : "";
          window.APP.toast(code ? "已添加，" + name + " 的登录码 " + code : "已添加", "ok");
          reload(function () { window.APP.renderPane("class"); });
        })
        .catch(function (err) { window.APP.toast(err.message, "error"); });
    }, { ghost: false }));
    nodes.push(form);

    return FORM.card({
      title: "任课老师",
      desc: "每人一个 6 位登录码，登录后只改自己那一科",
      nodes: nodes,
    });
  }

  function seenText(device) {
    if (!device.lastSeen) return "";
    return "最近在线 " + String(device.lastSeen).replace("T", " ").slice(0, 16);
  }

  function revoke(device) {
    API.request("/api/v1/devices/revoke", { method: "POST", body: { deviceId: device.id } })
      .then(function () {
        window.APP.toast("已解除；那块大屏会重新显示配对码", "ok");
        reload(function () { window.APP.renderPane("class"); });
      })
      .catch(function (err) { window.APP.toast(err.message || "解除失败，请重试", "error"); });
  }

  // 解除是不可撤销的，二次确认放页面内（modal.js），说明清楚"旧屏立刻失效、可以再绑新屏"。
  function confirmRevoke(device) {
    var body = [
      el("p", "modal-lead", "解除后这块大屏会立刻失效并重新显示配对码，可以再绑新的大屏。"),
    ];
    if (device.screenCode) body.push(el("p", "modal-sub", "屏码 " + device.screenCode + (device.name ? " · " + device.name : "")));
    window.MODAL.open({
      title: "解除这块大屏？",
      nodes: body,
      dismissable: true,
      actions: [
        { text: "先不解除", primary: false },
        { text: "解除这块大屏", onClick: function () { revoke(device); } },
      ],
    });
  }

  function deviceRow(device) {
    var row = el("div", "list-row");
    var who = el("div");
    who.appendChild(el("div", "who-name", device.name || "教室大屏"));
    var seen = seenText(device);
    who.appendChild(el("div", "who-sub", seen || "还没连过"));
    row.appendChild(who);
    row.appendChild(el("span", "spacer"));

    if (device.screenCode) row.appendChild(el("span", "code", device.screenCode));
    else row.appendChild(el("span", "badge", "未配对"));

    row.appendChild(FORM.button("解除这块大屏", function () { confirmRevoke(device); }));
    return row;
  }

  function emptyDevices() {
    var box = el("div", "device-empty");
    box.appendChild(el("p", "device-empty-title", "还没有绑定大屏"));
    box.appendChild(el("p", "device-empty-sub", "在教室里打开大屏，右下角会出现配对码；手机打开 /pair.html?code=码，用班主任账号登录并确认绑定。"));
    return box;
  }

  function devicesCard() {
    var nodes = [];
    var list = (data && data.devices) || [];
    var count = Math.min(list.length, 1);

    var stats = el("p", "device-stats");
    stats.appendChild(el("span", "badge", count ? "已绑定 " + count + " 台 / 上限 1 台" : "未绑定 / 上限 1 台"));
    stats.appendChild(el("span", "device-stats-note", count ? "换大屏要先解除现在这块" : "一个班只能绑一块大屏"));
    nodes.push(stats);

    if (!list.length) {
      nodes.push(emptyDevices());
    } else {
      list.forEach(function (device) { nodes.push(deviceRow(device)); });
      // 绑定态的配对指引；空态那段已经把"去哪找配对码"讲完了，不再重复。
      nodes.push(FORM.hintLine("教室大屏打开 /board/，右下角会自动出现 6 位配对码和二维码；手机扫码（或打开 /pair.html?code=码），用班主任账号登录后确认即可。"));
    }
    return FORM.card({
      title: "教室大屏",
      desc: "一个班一块；换屏先解除，再绑新的",
      nodes: nodes,
    });
  }

  function card() {
    if (!STATE.isMember()) {
      var wrap = el("div", "grid span-all");
      wrap.appendChild(teachersCard());
      wrap.appendChild(devicesCard());
      return wrap;
    }
    return FORM.card({
      title: "任课老师与大屏",
      desc: "只有班主任能管理",
      nodes: [FORM.hintLine("你是任课老师（" + STATE.mySubjectName() + "），这里由班主任管理。", true)],
    });
  }

  window.TEAM = {
    setData: function (me) { data = me; },
    data: function () { return data; },
    reload: reload,
    card: card,
  };
})();

