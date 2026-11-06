/*
  登录屏：创建班级 / 班主任进入 / 任课老师进入，三张表都落在这一屏。
  成功后只做两件事：把令牌塞进 API，把 user 交给 app.js 去启动主界面。
*/
(function () {
  "use strict";

  var screen = null;
  var msg = null;
  var onSuccess = null;
  var busy = false;

  function showMsg(text, kind) {
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || "";
    msg.className = "msg" + (kind ? " is-" + kind : "");
  }

  function openPane(name) {
    var panes = document.querySelectorAll("#login-panes .pane");
    Array.prototype.forEach.call(panes, function (pane) {
      pane.classList.toggle("is-on", pane.dataset.pane === name);
    });
    document.getElementById("login-entry").hidden = !!name;
    var switches = document.getElementById("enter-switch");
    if (switches) switches.hidden = name !== "enter";
  }

  function enterMode(mode) {
    var forms = document.querySelectorAll("#login-panes form[data-enter]");
    Array.prototype.forEach.call(forms, function (form) {
      form.hidden = form.dataset.enter !== mode;
    });
    var buttons = document.querySelectorAll("#enter-switch .link");
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.classList.toggle("is-on", btn.dataset.pane === mode);
    });
  }

  function payloadOf(form) {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (input) {
      if (!input.name) return;
      data[input.name] = String(input.value || "").trim();
    });
    return data;
  }

  function setBusy(state) {
    busy = state;
    Array.prototype.forEach.call(document.querySelectorAll("#login-screen button[type=submit]"), function (btn) {
      btn.disabled = state;
    });
  }

  var ROUTES = {
    claim: { path: "/api/v1/class/claim", ok: "班级建好了，正在进入…" },
    owner: { path: "/api/v1/auth/login", ok: "欢迎回来" },
    teacher: { path: "/api/v1/auth/teacher-login", ok: "欢迎回来" },
  };

  async function submit(form, kind) {
    if (busy) return;
    var route = ROUTES[kind];
    var payload = payloadOf(form);
    setBusy(true);
    showMsg("");
    try {
      var data = await API.request(route.path, { method: "POST", body: payload, auth: false });
      API.setToken(data.token);
      if (window.STATE) STATE.user = data.user;
      showMsg(route.ok, "ok");
      // 班主任新建班级：先弹凭证窗（班级码 + 提醒），关掉窗口再进发布页。
      if (kind === "claim" && window.MODAL && data.user && data.user.class) {
        MODAL.classCreated({
          className: data.user.class.name,
          code: data.user.class.code,
          password: payload.password,
          onDone: function () { if (onSuccess) onSuccess(data.user); },
        });
        return;
      }
      if (onSuccess) onSuccess(data.user);
    } catch (err) {
      showMsg(err.message || "登录失败，请重试", "error");
    } finally {
      setBusy(false);
    }
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll("#login-entry .entry-btn"), function (btn) {
      btn.addEventListener("click", function () {
        showMsg("");
        openPane(btn.dataset.pane);
        if (btn.dataset.pane === "enter") enterMode("owner");
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll("#login-panes [data-back]"), function (btn) {
      btn.addEventListener("click", function () {
        showMsg("");
        openPane("");
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll("#enter-switch .link"), function (btn) {
      btn.addEventListener("click", function () { enterMode(btn.dataset.pane); });
    });

    Array.prototype.forEach.call(document.querySelectorAll("#login-panes form[data-form]"), function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        submit(form, form.dataset.form);
      });
    });
  }

  function show() {
    screen.hidden = false;
    document.getElementById("app").hidden = true;
    openPane("");
    showMsg("");
  }

  function hide() {
    screen.hidden = true;
    document.getElementById("app").hidden = false;
  }

  window.LOGIN = {
    init: function (callback) {
      screen = document.getElementById("login-screen");
      msg = document.getElementById("login-msg");
      onSuccess = callback;
      bind();
    },
    show: show,
    hide: hide,
    message: showMsg,
  };
})();
