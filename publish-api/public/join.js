/*
  免登入口：读 ?c=（班级码）&k=（登录码），无登录态也能用。
  优先级：已登录同一身份 → 直接进；已登录别人 → 让老师确认换身份；否则自动登录。
  失败把服务端原话显示出来，并给手填表单重试。
*/
(function () {
  "use strict";

  var params = parse();
  var busy = false;

  function $(id) { return document.getElementById(id); }

  function parse() {
    var search = window.location.search || "";
    var c = /[?&]c=(\d{4,10})/.exec(search);
    var k = /[?&]k=([A-Za-z0-9]{4,10})/.exec(search);
    return { code: c ? c[1] : "", key: k ? k[1].toUpperCase() : "" };
  }

  function msg(text, kind) {
    var node = $("join-msg");
    node.hidden = !text;
    node.textContent = text || "";
    node.className = "msg" + (kind ? " is-" + kind : "");
  }

  function setTitle(title, sub) {
    $("join-title").textContent = title;
    if (sub) $("join-sub").textContent = sub;
  }

  function showLoading(show) { $("join-loading").hidden = !show; }

  function showForm(prefill, text) {
    showLoading(false);
    $("join-actions").hidden = true;
    $("join-form").hidden = false;
    var form = $("join-form");
    if (prefill) {
      if (prefill.code) form.elements.classCode.value = prefill.code;
      if (prefill.key) form.elements.loginCode.value = prefill.key;
    }
    if (text) msg(text, "error");
  }

  function showSwitch(user) {
    showLoading(false);
    $("join-form").hidden = true;
    var actions = $("join-actions");
    actions.hidden = false;
    setTitle("当前是班主任账号", "「" + (user.class ? user.class.name : "") + "」· " + user.name +
      " 已登录。要以这位老师的身份进入，会先退出当前登录。");
    msg("", "");
  }

  function enterApp() {
    window.location.replace("/?tab=today");
  }

  async function login(code, key) {
    var data = await API.request("/api/v1/auth/teacher-login", {
      method: "POST",
      auth: false,
      body: { classCode: code, loginCode: key },
    });
    API.setToken(data.token);
    enterApp();
  }

  async function sameIdentity(code) {
    try {
      var me = await API.request("/api/v1/me");
      var user = me.user || {};
      if (user.role === "member" && user.class && String(user.class.code) === code) return user;
      if (user.role === "owner") return { owner: user };
      API.setToken("");
    } catch (err) {
      API.setToken("");
    }
    return null;
  }

  async function auto() {
    if (!params.code || !params.key) {
      setTitle("用手填的班级码进入", "分享链接没带全信息；也可以直接在下面填班级码和登录码。");
      showForm(params, "");
      return;
    }
    showLoading(true);
    setTitle("正在进入班级…", "正在用链接里的凭证登录，请稍候。");

    var existing = await sameIdentity(params.code);
    if (existing && !existing.owner) { enterApp(); return; }
    if (existing && existing.owner) { showSwitch(existing.owner); return; }

    try {
      await login(params.code, params.key);
    } catch (err) {
      showForm(params, err.message || "链接无效或已过期");
      setTitle("这条链接没能进班", "可能班主任换过登录码，或链接不完整。填一次就能进，之后浏览器会记住。");
    }
  }

  function submit(event) {
    event.preventDefault();
    if (busy) return;
    var form = $("join-form");
    var code = String(form.elements.classCode.value || "").replace(/\D/g, "");
    var key = String(form.elements.loginCode.value || "").trim().toUpperCase();
    if (!code || !key) { msg("班级码和登录码都要填", "error"); return; }
    busy = true;
    showLoading(true);
    msg("正在登录…", "");
    login(code, key).catch(function (err) {
      busy = false;
      showLoading(false);
      showForm({ code: code, key: key }, err.message || "登录失败，请检查班级码和登录码");
    });
  }

  function switchIdentity() {
    API.setToken("");
    busy = true;
    showLoading(true);
    msg("", "");
    login(params.code, params.key).catch(function (err) {
      busy = false;
      showForm(params, err.message || "登录失败");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("join-form").addEventListener("submit", submit);
    $("join-switch").addEventListener("click", switchIdentity);
    auto();
  });
})();
