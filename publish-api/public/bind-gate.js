/*
  班主任的"先绑一块大屏"拦路弹窗。
  背景：老师端发的东西都显示在教室大屏上，没绑屏就没有看板可看——所以 /me 回来看见
  owner 且 devices 为空，就把弹窗盖上来，不绑不许用。
  这是唯一不可关闭的模态：Esc / 点遮罩都不行，出口只有"绑定成功"或"退出登录"。
  任课老师永远不弹；/me 失败也不弹（网络抖一下不该把人锁在外面）。
*/
(function () {
  "use strict";

  var bound = null; // null=还没判断过；true=已绑；false=未绑

  function node(tag, cls, text) {
    var item = document.createElement(tag);
    if (cls) item.className = cls;
    if (text != null) item.textContent = String(text);
    return item;
  }

  function isOwner() {
    return !!(window.STATE && STATE.user && STATE.user.role === "owner");
  }

  // 顶栏的「未绑定大屏」入口：未绑定时出现，点它重新开弹窗。
  function paintHint() {
    var btn = document.getElementById("bind-hint");
    if (!btn) return;
    btn.hidden = !(bound === false && isOwner());
  }

  function steps() {
    var list = node("ol", "gate-steps");
    [
      "教室电脑上打开看板，大屏右下角会自动出现 6 位配对码和二维码。",
      "手机扫那个二维码；不方便扫码就在这台电脑上把 6 位码填到下面。",
      "绑定后这块屏就开始显示你们班。",
    ].forEach(function (text) { list.appendChild(node("li", null, text)); });
    return list;
  }

  function errorText(err) {
    if (!err) return "绑定失败，请重试";
    if (err.status === 404 || err.code === "CLAIM_NOT_FOUND") return "这个码不对或已经过期，让大屏刷新一下再输";
    if (err.code === "CLAIM_USED" || err.code === "CLAIM_GONE") return "这个码已经被用过了，让大屏刷新出新的码";
    if (err.code === "DEVICE_LIMIT") return err.message || "这个班已经绑了一块大屏，先在「班级」页解除它";
    return err.message || "绑定失败，请重试";
  }

  function bindCode(code) {
    return API.request("/api/v1/devices/bind", { method: "POST", body: { code: code } });
  }

  function open() {
    var input = node("input", "gate-code");
    input.type = "text";
    input.maxLength = 6;
    input.autocomplete = "off";
    input.placeholder = "例如 KQ98KT";
    input.setAttribute("aria-label", "大屏上的 6 位配对码");
    input.addEventListener("input", function () {
      input.value = String(input.value || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6);
    });

    var error = node("p", "gate-error");
    error.hidden = true;

    var body = [
      node("p", "modal-lead", "老师端发的内容都显示在这块屏上，没绑定就没有看板可以看。"),
      steps(),
      node("p", "field-label", "大屏上的 6 位配对码"),
      input,
      error,
    ];

    var card = MODAL.open({
      title: "先绑一块教室大屏",
      nodes: body,
      dismissable: false,
      actions: [
        {
          text: "绑定这台大屏",
          keepOpen: true,
          onClick: function () { return submit(input, error); },
        },
        { text: "退出登录", primary: false, onClick: function () { if (window.APP) APP.logout(); } },
      ],
    });
    input.focus();
    return card;
  }

  function submit(input, error) {
    var code = String(input.value || "").trim().toUpperCase();
    if (code.length !== 6) {
      error.hidden = false;
      error.textContent = "配对码是 6 位，检查一下有没有漏输";
      input.focus();
      return;
    }
    error.hidden = true;
    var buttons = document.querySelectorAll(".modal-actions button");
    buttons.forEach(function (btn) { btn.disabled = true; });
    bindCode(code).then(function (res) {
      bound = true;
      paintHint();
      MODAL.close();
      return APP.refreshMe().then(function () {
        APP.toast("已绑定，屏码 " + ((res && res.screenCode) || code), "ok");
      });
    }).catch(function (err) {
      buttons.forEach(function (btn) { btn.disabled = false; });
      error.hidden = false;
      error.textContent = errorText(err);
      if (err.status === 401) {
        MODAL.close();
        API.setToken("");
        if (window.STATE) STATE.reset();
        LOGIN.show();
        LOGIN.message("登录已过期，请重新登录", "error");
        return;
      }
      input.focus();
    });
  }

  // boot 拿到 /me 之后调用；member 或请求失败都不会走到这里弹窗。
  function check(me) {
    if (!me || !me.user) return;
    bound = (me.devices || []).length > 0;
    paintHint();
    if (me.user.role === "owner" && !bound) open();
  }

  function start() {
    var btn = document.getElementById("bind-hint");
    if (btn) btn.addEventListener("click", function () { if (window.MODAL) open(); });
    paintHint();
  }

  document.addEventListener("DOMContentLoaded", start);

  window.GATE = { check: check, open: open, paintHint: paintHint };
})();
