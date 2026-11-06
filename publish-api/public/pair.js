/*
  pair.html 的流程：读 ?code → （未登录）班主任登录 → 校验 role=owner → 确认绑定 → 结果。
  令牌与大屏端共用 bsp.token；这里不碰看板内容，只调 /devices/bind。
*/
(function () {
  "use strict";

  var code = "";
  var owner = null;

  function $(id) { return document.getElementById(id); }

  function show(id, on) {
    var node = $(id);
    if (node) node.hidden = !on;
  }

  function message(text, kind) {
    var node = $("pair-msg");
    node.hidden = !text;
    node.textContent = text || "";
    node.className = "msg" + (kind ? " is-" + kind : "");
  }

  function icon(symbol, warn) {
    var node = $("pair-icon");
    node.hidden = false;
    node.textContent = symbol;
    node.className = "pair-icon" + (warn ? " is-warn" : "");
  }

  function setHead(title, sub) {
    $("pair-title").textContent = title;
    $("pair-sub").textContent = sub || "";
  }

  function readCode() {
    var match = String(location.search || "").match(/[?&]code=([A-Za-z0-9]{4,8})/);
    return match ? match[1].toUpperCase() : "";
  }

  function fail(title, sub, text) {
    icon("!", true);
    setHead(title, sub);
    show("pair-code-wrap", false);
    show("pair-login", false);
    show("pair-limit", false);
    show("pair-confirm", false);
    show("pair-done", false);
    message(text, "error");
    $("pair-foot").hidden = true;
  }

  function viewLogin() {
    icon("→", false);
    setHead("用班主任账号登录", "配对码 " + code + "：登录后确认绑定，任课老师不能绑大屏。");
    show("pair-code-wrap", true);
    $("pair-code").textContent = code;
    show("pair-login", true);
    show("pair-limit", false);
    show("pair-confirm", false);
    show("pair-done", false);
    $("pair-login-form").elements.classCode.focus();
  }

  function viewConfirm(user) {
    icon("✓", false);
    var klass = user.class ? user.class.name : "";
    setHead("确认绑定到「" + (klass || "本班") + "」", "绑定后大屏会显示本班看板；这台设备可在老师端「班级」里解除。");
    show("pair-code-wrap", true);
    $("pair-code").textContent = code;
    show("pair-login", false);
    show("pair-limit", false);
    show("pair-confirm", true);
    show("pair-done", false);
  }

  // 409 DEVICE_LIMIT：这个班已经有一块屏了，配对码本身还是有效的（服务端没消费）。
  // 正文只留服务端 message（带屏码，信息最全），跟进话放副标题：去解除、回来再点确认，不用重新扫码。
  function viewLimit(err) {
    icon("!", true);
    setHead(
      "这个班已经绑了一块大屏",
      "去「班级」页解除旧大屏；回到本页（或重新打开这条链接）再点一次「确认绑定」就行，不用重新扫码。"
    );
    show("pair-code-wrap", true);
    show("pair-login", false);
    show("pair-limit", true);
    show("pair-confirm", false);
    show("pair-done", false);
    message(err && err.message ? err.message : "换大屏要先在「班级」页解除现在这块。", "warn");
  }

  function viewDone(res) {
    icon("✓", false);
    setHead("绑定成功", "大屏已经可以显示本班看板了。");
    show("pair-code-wrap", false);
    show("pair-login", false);
    show("pair-limit", false);
    show("pair-confirm", false);
    show("pair-done", true);
    var klass = res && res.className ? res.className : "";
    var screen = res && res.screenCode ? res.screenCode : "";
    message("设备 " + (res && res.deviceId ? String(res.deviceId).slice(0, 8) : "") +
      (screen ? " · 屏幕码 " + screen : "") + (klass ? " · " + klass : ""), "ok");
  }

  async function checkOwner() {
    try {
      var me = await API.request("/api/v1/me");
      var user = me.user || {};
      if (user.role !== "owner") {
        owner = null;
        API.setToken("");
        viewLogin();
        message("当前登录的是任课老师（" + (user.name || "") + "），请用班主任账号登录。", "error");
        return;
      }
      owner = user;
      viewConfirm(user);
    } catch (err) {
      if (err.status === 401) {
        API.setToken("");
        viewLogin();
        return;
      }
      fail("读取登录状态失败", err.message || "网络异常", err.message);
    }
  }

  async function login(event) {
    event.preventDefault();
    var form = event.target;
    message("正在登录…");
    try {
      var data = await API.request("/api/v1/auth/login", {
        method: "POST",
        auth: false,
        body: {
          classCode: String(form.elements.classCode.value || "").trim(),
          password: String(form.elements.password.value || ""),
        },
      });
      API.setToken(data.token);
      owner = data.user;
      if (!owner || owner.role !== "owner") {
        fail("这个账号不是班主任", "请用创建班级时的班主任账号登录。", "");
        return;
      }
      message("");
      viewConfirm(owner);
    } catch (err) {
      message(err.message || "登录失败", "error");
    }
  }

  async function bind() {
    message("正在绑定…");
    var btn = $("pair-bind");
    btn.disabled = true;
    try {
      var res = await API.request("/api/v1/devices/bind", { method: "POST", body: { code: code } });
      viewDone(res);
    } catch (err) {
      btn.disabled = false;
      if (err.status === 404) {
        fail("配对码不存在或已过期", "请在教室大屏上重新点「配对」，拿新码再扫。", err.message);
      } else if (err.status === 409 && err.code === "DEVICE_LIMIT") {
        viewLimit(err);
      } else if (err.status === 409) {
        fail("这个配对码已经被用过了", "请在教室大屏上重新点「配对」，拿新码再扫。", err.message);
      } else if (err.status === 403) {
        fail("没有权限绑定", "只有班主任能绑定大屏。", err.message);
      } else if (err.status === 401) {
        API.setToken("");
        viewLogin();
        message("登录已过期，请重新登录", "warn");
      } else {
        message(err.message || "绑定失败，请重试", "error");
      }
    }
  }

  function bindEvents() {
    $("pair-login-form").addEventListener("submit", login);
    $("pair-bind").addEventListener("click", bind);
    $("pair-switch").addEventListener("click", function () {
      API.setToken("");
      owner = null;
      message("");
      viewLogin();
    });
    $("pair-again").addEventListener("click", function () {
      location.href = "/?tab=class";
    });
    $("pair-go-class").addEventListener("click", function () {
      location.href = "/?tab=class";
    });
  }

  function start() {
    bindEvents();
    code = readCode();
    if (!code) {
      fail("链接里没有配对码", "请重新扫大屏上的二维码，或从老师端「班级 → 教室大屏」进入。", "");
      return;
    }
    $("pair-code").textContent = code;
    if (API.token()) checkOwner();
    else viewLogin();
  }

  document.addEventListener("DOMContentLoaded", start);
})();
