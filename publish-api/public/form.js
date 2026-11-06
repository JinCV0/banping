/*
  表单零件：卡片、字段、带字数提示的输入、可增删的行编辑器。
  老师端各屏共用这一份；字数上限只从 /board/limits.js 读，不在这里写死。
*/
(function () {
  "use strict";

  var LIMITS = window.BOARD_LIMITS || {};

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  // 卡片：标题 + 一句说明 + 右侧动作，再往下是内容。
  function card(opts) {
    var box = el("section", "card");
    var head = el("div", "card-head");
    head.appendChild(el("h2", "card-title", opts.title || ""));
    if (opts.desc) head.appendChild(el("p", "card-desc", opts.desc));
    if (opts.actions && opts.actions.length) {
      var actions = el("div", "card-actions");
      opts.actions.forEach(function (node) { actions.appendChild(node); });
      head.appendChild(actions);
    }
    box.appendChild(head);
    (opts.nodes || []).forEach(function (node) { if (node) box.appendChild(node); });
    return box;
  }

  function field(label, control, counter, hint) {
    var wrap = el("div", "field");
    if (label) {
      var head = el("div", "field-label");
      head.appendChild(el("span", null, label));
      if (counter) head.appendChild(counter);
      wrap.appendChild(head);
    }
    wrap.appendChild(control);
    if (hint) wrap.appendChild(el("p", "field-hint", hint));
    return wrap;
  }

  function counterOf(limit) {
    var node = el("span", "field-count");
    node.dataset.limit = String(limit || 0);
    return node;
  }

  function paintCounter(node, length) {
    var limit = Number(node.dataset.limit) || 0;
    node.textContent = limit ? length + "/" + limit : String(length);
    node.classList.toggle("is-over", limit > 0 && length > limit);
  }

  // 单行/多行文本；opts: {rows, disabled, placeholder, type, hint}
  function textBox(label, value, limit, onChange, opts) {
    var opt = opts || {};
    var input = opt.rows ? el("textarea") : el("input");
    if (opt.rows) input.rows = opt.rows;
    else input.type = opt.type || "text";
    if (opt.placeholder) input.placeholder = opt.placeholder;
    input.value = value == null ? "" : String(value);
    if (opt.disabled) input.disabled = true;
    input.addEventListener("input", function () { onChange(input.value); });
    if (!limit) return field(label, input, null, opt.hint);
    var count = counterOf(limit);
    input.addEventListener("input", function () { paintCounter(count, input.value.length); });
    paintCounter(count, input.value.length);
    return field(label, input, count, opt.hint);
  }

  function selectBox(label, options, value, onChange, opts) {
    var opt = opts || {};
    var node = el("select");
    options.forEach(function (item) {
      var option = el("option", null, item.label);
      option.value = item.value;
      if (String(item.value) === String(value)) option.selected = true;
      node.appendChild(option);
    });
    if (opt.disabled) node.disabled = true;
    node.addEventListener("change", function () { onChange(node.value); });
    return field(label, node, null, opt.hint);
  }

  // 单行编辑器的零件：计数器、输入框、删除按钮；状态都放在 ctx 里，避免闭包套闭包。
  function rowNode(ctx, value, index) {
    var row = el("div", "row");
    var input = el("input");
    input.type = "text";
    input.className = "row-input";
    input.value = value;
    input.disabled = ctx.disabled;
    if (ctx.placeholder) input.placeholder = ctx.placeholder;
    var count = el("span", "row-count");
    function paint() {
      count.textContent = ctx.limit ? input.value.length + "/" + ctx.limit : String(input.value.length);
      count.classList.toggle("is-over", ctx.limit > 0 && input.value.length > ctx.limit);
    }
    input.addEventListener("input", function () {
      ctx.values[index] = input.value;
      paint();
      ctx.push();
    });
    paint();
    row.appendChild(input);
    row.appendChild(count);
    if (!ctx.disabled) {
      var del = el("button", "row-del", "×");
      del.type = "button";
      del.title = "删除这一条";
      del.addEventListener("click", function () {
        ctx.values.splice(index, 1);
        if (!ctx.values.length) ctx.values.push("");
        ctx.repaint();
        ctx.push();
      });
      row.appendChild(del);
    }
    return row;
  }

  /*
    行编辑器：一行一条，右侧显示该行字数，超过 limit 变红；满了 max 条就藏起"加一条"。
    onChange 拿到的永远是当前全部原始文本（含空行），由调用方决定怎么清洗。
  */
  function rowsEditor(label, items, opts) {
    var opt = opts || {};
    var limit = opt.limit || 0;
    var max = opt.max || 0;
    var disabled = !!opt.disabled;
    var values = (items || []).slice();
    if (!values.length && !disabled) values.push("");

    var wrap = el("div", "field");
    if (label) wrap.appendChild(el("div", "field-label", label));
    var rows = el("div", "rows");
    wrap.appendChild(rows);

    function push() {
      if (opt.onChange) opt.onChange(values.slice());
    }

    var ctx = {
      values: values, limit: limit, disabled: disabled,
      placeholder: opt.placeholder, push: push, repaint: repaint,
    };

    function repaint() {
      rows.textContent = "";
      values.forEach(function (value, index) {
        rows.appendChild(rowNode(ctx, value, index));
      });

      var old = wrap.querySelector(".row-add");
      if (old) old.remove();
      if (!disabled && (!max || values.length < max)) {
        var add = el("button", "row-add ghost small", "+ 加一条");
        add.type = "button";
        add.addEventListener("click", function () {
          values.push("");
          repaint();
          push();
        });
        wrap.appendChild(add);
      }
    }

    repaint();
    return wrap;
  }

  function button(text, onClick, opts) {
    var opt = opts || {};
    var node = el("button", opt.ghost === false ? "primary small" : "ghost small", text);
    node.type = "button";
    if (opt.disabled) node.disabled = true;
    if (opt.title) node.title = opt.title;
    if (onClick) node.addEventListener("click", onClick);
    return node;
  }

  function hintLine(text, warn) {
    var node = el("p", warn ? "hint-line is-warn" : "hint-line");
    node.textContent = text;
    return node;
  }

  window.FORM = {
    LIMITS: LIMITS,
    el: el,
    card: card,
    field: field,
    textBox: textBox,
    selectBox: selectBox,
    rowsEditor: rowsEditor,
    button: button,
    hintLine: hintLine,
    counterOf: counterOf,
    paintCounter: paintCounter,
  };
})();
