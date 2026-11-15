/*
  页面内模态：创建班级成功后的凭证弹窗，以及分享页弹出的邀请卡。
  不用 window.alert/confirm —— 原生弹窗关掉就没了，班级码不能这样丢。
  结构：.modal-mask > .modal-card > 标题 + 内容 + 按钮；Esc / 点遮罩按 opts.dismissable 决定能否关。
*/
(function () {
  "use strict";

  var current = null;

  function node(tag, cls, text) {
    var item = document.createElement(tag);
    if (cls) item.className = cls;
    if (text != null) item.textContent = String(text);
    return item;
  }

  function close(result) {
    if (!current) return;
    var state = current;
    current = null;
    document.removeEventListener("keydown", state.onKey);
    if (state.mask && state.mask.parentNode) state.mask.parentNode.removeChild(state.mask);
    document.body.classList.remove("modal-open");
    if (state.onClose) state.onClose(result);
  }

  function actionButton(action) {
    var btn = node("button", action.primary === false ? "ghost" : "primary", action.text);
    btn.type = "button";
    btn.addEventListener("click", function () {
      if (action.keepOpen) {
        if (action.onClick) action.onClick();
        return;
      }
      close("action");
      if (action.onClick) action.onClick();
    });
    return btn;
  }

  function open(opts) {
    var opt = opts || {};
    close();
    var mask = node("div", "modal-mask");
    var card = node("div", "modal-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.appendChild(node("h2", "modal-title", opt.title || ""));

    var body = node("div", "modal-body");
    (opt.nodes || []).forEach(function (item) { if (item) body.appendChild(item); });
    card.appendChild(body);

    var actions = opt.actions || [];
    if (actions.length) {
      var bar = node("div", "modal-actions");
      actions.forEach(function (action) { bar.appendChild(actionButton(action)); });
      card.appendChild(bar);
    }

    mask.appendChild(card);
    document.body.appendChild(mask);
    document.body.classList.add("modal-open");

    var onKey = function (event) {
      if (event.key === "Escape" && opt.dismissable !== false) close("escape");
    };
    document.addEventListener("keydown", onKey);
    if (opt.dismissable !== false) {
      mask.addEventListener("click", function (event) {
        if (event.target === mask) close("mask");
      });
    }
    current = { mask: mask, onClose: opt.onClose, onKey: onKey };
    return card;
  }

  function copyButton(text, label, primary) {
    var btn = node("button", primary ? "primary small" : "ghost small", label || "复制");
    btn.type = "button";
    btn.addEventListener("click", function () {
      CLIP.copy(text, function (ok) {
        btn.textContent = ok ? "已复制" : "复制失败，请手动选中";
        setTimeout(function () { btn.textContent = label || "复制"; }, 1800);
      });
    });
    return btn;
  }

  // 创建班级成功：大字班级码 + 提醒 + 唯一的出口按钮。
  function classCreated(opts) {
    var data = opts || {};
    var code = String(data.code || "");
    var body = [];

    var codeRow = node("div", "modal-code-row");
    codeRow.appendChild(node("span", "modal-code", code));
    codeRow.appendChild(copyButton(code, "复制班级码"));
    body.push(codeRow);

    body.push(node("p", "modal-lead", "把班级码和密码存好，两者都是进班级的凭证；丢了只能凭开通密钥重建。"));

    if (data.password) {
      body.push(node("p", "modal-sub", "密码：你刚设置的那个（至少 6 位），登录时用它。"));
    }
    body.push(node("p", "modal-sub", "之后在「班级」页也看得到班级码；任课老师用「班级码 + 登录码」进班。"));

    return open({
      title: data.className ? "「" + data.className + "」建好了" : "班级建好了",
      nodes: body,
      dismissable: true,
      // 不论点按钮、按 Esc 还是点遮罩，关掉就进发布页：班级码在「班级」页仍能看到，不会丢。
      onClose: function () { if (data.onDone) data.onDone(); },
      actions: [{ text: "我已保存，进入发布页" }],
    });
  }

  window.MODAL = { open: open, close: close, copyButton: copyButton, classCreated: classCreated };
})();
