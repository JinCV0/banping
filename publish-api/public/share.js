/*
  分享页（仅班主任）：给每位任课老师一条免登链接 + 二维码，另可换码/收回。
  链接格式 /join.html?c=<班级码>&k=<登录码>；链接本身就是凭证，换码后旧链接立即失效。
*/
(function () {
  "use strict";

  function el(tag, cls, text) { return FORM.el(tag, cls, text); }
  function toast(text, kind) { if (window.APP) APP.toast(text, kind); }

  function classCode() {
    var klass = STATE.user && STATE.user.class;
    return klass ? String(klass.code || "") : "";
  }

  function className() {
    var klass = STATE.user && STATE.user.class;
    return klass ? String(klass.name || "") : "";
  }

  // 老师账号里存科目 id（新）或中文名（老账号），这里统一显示中文名。
  function subjectLabel(raw) {
    var list = (STATE.state && STATE.state.subjects) || [];
    var hit = list.filter(function (s) { return s.id === raw || s.name === raw; })[0];
    return hit ? hit.name : String(raw || "");
  }

  function subjectOptions() {
    var list = [];
    ((STATE.state && STATE.state.subjects) || []).forEach(function (s) {
      list.push({ value: s.id, label: s.name });
    });
    if (!list.length) list.push({ value: "", label: "先在「班级」页添加科目" });
    return list;
  }

  function teacherUrl(code) {
    return window.location.origin + "/join.html?c=" + encodeURIComponent(classCode()) +
      "&k=" + encodeURIComponent(code);
  }

  function inviteText(teacher, url) {
    var who = teacher.name + (teacher.subject ? "· " + subjectLabel(teacher.subject) : "");
    return "「" + className() + "」老师端入口（" + who + "）：\n" + url +
      "\n点开就直接进班，只改自己那一科。链接就是凭证，别转发给外人；换码后旧链接失效。";
  }

  function codeLine(teacher) {
    var row = el("div", "share-code-row");
    row.appendChild(el("span", "share-label", "登录码"));
    if (teacher.login_code) {
      row.appendChild(el("span", "code", teacher.login_code));
      row.appendChild(el("span", "spacer"));
      row.appendChild(FORM.button("换码", function () { renew(teacher); }, { title: "旧链接立即失效" }));
      row.appendChild(FORM.button("收回", function (event) { revoke(teacher, event.currentTarget); }));
    } else {
      row.appendChild(el("span", "code is-off", "已收回"));
      row.appendChild(el("span", "spacer"));
      row.appendChild(FORM.button("再发一个码", function () { renew(teacher); }, { ghost: false }));
    }
    return row;
  }

  function renew(teacher) {
    API.request("/api/v1/teachers/code", { method: "POST", body: { userId: teacher.id } })
      .then(function () {
        TEAM.reload(function () {
          APP.renderPane("share");
          toast("已换新码，旧链接失效", "ok");
        });
      })
      .catch(function (err) { toast(err.message, "error"); });
  }

  // 收回是不可逆的凭证操作：点第一下变「确认收回」，4 秒内再点才真收回（不用 confirm）。
  function revoke(teacher, btn) {
    if (!btn || btn.dataset.armed !== "1") {
      if (!btn) return;
      btn.dataset.armed = "1";
      btn.textContent = "确认收回";
      btn.classList.add("danger");
      setTimeout(function () {
        if (!btn.parentNode) return;
        btn.dataset.armed = "";
        btn.textContent = "收回";
        btn.classList.remove("danger");
      }, 4000);
      return;
    }
    API.request("/api/v1/teachers/code", { method: "DELETE", body: { userId: teacher.id } })
      .then(function () {
        TEAM.reload(function () {
          APP.renderPane("share");
          toast("已收回 " + teacher.name + " 的登录码", "ok");
        });
      })
      .catch(function (err) { toast(err.message, "error"); });
  }

  function drawQr(canvas, text) {
    if (!canvas) return false;
    if (typeof window.qrcode !== "function" || !text) return false;
    try {
      var qr = window.qrcode(0, "M");
      qr.addData(text);
      qr.make();
      var count = qr.getModuleCount();
      var size = 112;
      var cell = Math.floor(size / (count + 8)) || 1;
      var offset = Math.floor((size - cell * count) / 2);
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#1b2a38";
      for (var row = 0; row < count; row += 1) {
        for (var col = 0; col < count; col += 1) {
          if (qr.isDark(row, col)) ctx.fillRect(offset + col * cell, offset + row * cell, cell, cell);
        }
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  function linkBlock(teacher) {
    var url = teacherUrl(teacher.login_code);
    var block = el("div", "share-link");
    var input = el("input", "share-url");
    input.type = "text";
    input.readOnly = true;
    input.value = url;
    input.title = url;
    input.addEventListener("focus", function () { input.select(); });
    block.appendChild(input);
    block.appendChild(MODAL.copyButton(url, "复制链接", true));
    return block;
  }

  function qrBlock(teacher) {
    var url = teacherUrl(teacher.login_code);
    var wrap = el("div", "share-qr");
    var canvas = el("canvas", "share-canvas");
    canvas.setAttribute("aria-hidden", "true");
    var drawn = drawQr(canvas, url);
    if (!drawn) {
      wrap.classList.add("is-off");
      wrap.appendChild(el("span", "share-qr-fallback", "二维码画不出来时，复制链接一样能进"));
    } else {
      wrap.appendChild(canvas);
    }
    wrap.appendChild(MODAL.copyButton(inviteText(teacher, url), "复制邀请文案"));
    return wrap;
  }

  function teacherCard(teacher) {
    var card = el("article", "card share-card");
    if (teacher.id) card.dataset.teacher = teacher.id;

    var head = el("div", "share-head");
    head.appendChild(el("div", "share-name", teacher.name));
    head.appendChild(el("span", "share-subject", teacher.subject ? subjectLabel(teacher.subject) : "未填科目"));
    card.appendChild(head);

    card.appendChild(codeLine(teacher));
    if (teacher.login_code) {
      card.appendChild(linkBlock(teacher));
      card.appendChild(qrBlock(teacher));
    } else {
      card.appendChild(el("p", "note", "登录码已收回，重新发一个码就会生成新链接。"));
    }
    return card;
  }

  function showLink(teacher) {
    // POST /teachers 返回 camelCase（loginCode），列表接口返回蛇形（login_code），这里都认。
    var code = teacher.login_code || teacher.loginCode || "";
    var url = teacherUrl(code);
    var nodes = [];
    nodes.push(el("p", "modal-lead", "「" + className() + "」· " + teacher.name + " · " +
      (teacher.subject ? subjectLabel(teacher.subject) : "未填科目")));
    var input = el("input", "share-url");
    input.type = "text";
    input.readOnly = true;
    input.value = url;
    nodes.push(input);
    nodes.push(el("p", "modal-sub", "把链接发给这位老师，他点开就直接进班，只改自己那一科。链接就是凭证，别转发给别人；换码后旧链接失效。"));
    return MODAL.open({
      title: "分享链接已生成",
      nodes: nodes,
      actions: [
        { text: "复制链接", primary: false, onClick: function () { CLIP.copy(url, function () { toast("链接已复制", "ok"); }); } },
        { text: "完成" },
      ],
    });
  }

  function addCard() {
    var nameInput = el("input");
    nameInput.type = "text";
    nameInput.maxLength = 12;
    nameInput.placeholder = "老师姓名（≤12 字）";
    var subjectSelect = el("select");
    subjectOptions().forEach(function (option) {
      var node = el("option", null, option.label);
      node.value = option.value;
      subjectSelect.appendChild(node);
    });

    var row = el("div", "inline share-add");
    row.appendChild(FORM.field("姓名", nameInput));
    row.appendChild(FORM.field("科目", subjectSelect));
    row.appendChild(FORM.button("+ 新增任课老师", function () { addTeacher(nameInput, subjectSelect); }, { ghost: false }));

    return FORM.card({
      title: "新增任课老师",
      desc: "填姓名和科目，生成一条只进他这一科的免登链接",
      nodes: [row],
    });
  }

  function addTeacher(nameInput, subjectSelect) {
    var name = String(nameInput.value || "").trim();
    var subject = subjectSelect.value;
    if (!name) { toast("先填老师姓名", "error"); return; }
    if (!subject) { toast("先选他教哪一科", "error"); return; }
    API.request("/api/v1/teachers", { method: "POST", body: { name: name, subject: subject } })
      .then(function (res) {
        var teacher = res && res.teacher;
        TEAM.reload(function () {
          APP.renderPane("share");
          if (!teacher) { toast("已添加", "ok"); return; }
          var card = document.querySelector('[data-teacher="' + teacher.id + '"]');
          if (card) {
            card.classList.add("is-new");
            if (card.scrollIntoView) card.scrollIntoView({ block: "center" });
          }
          showLink(teacher);
        });
      })
      .catch(function (err) { toast(err.message, "error"); });
  }

  // 服务端 /me 的 teachers 现在带 createdAt，按创建时间升序即可（新加的永远排最后）。
  // 缺 createdAt 或解析失败时返回 0：sort 是稳定的，保持接口原序。
  function sortTeachers(list) {
    return list.slice().sort(function (a, b) {
      var ta = Date.parse(a && a.createdAt);
      var tb = Date.parse(b && b.createdAt);
      if (isNaN(ta) || isNaN(tb)) return 0;
      return ta - tb;
    });
  }

  // 早前版本用 localStorage 记过顺序，现在由服务端 createdAt 接管；进来顺手清掉旧 key。
  function dropLegacyOrder() {
    try {
      var doomed = [];
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        if (key && key.indexOf("bsp.teacher-order.") === 0) doomed.push(key);
      }
      doomed.forEach(function (key) { localStorage.removeItem(key); });
    } catch (err) { /* 隐私模式忽略 */ }
  }

  function roster(list) {
    var section = el("section", "share-roster");
    section.appendChild(el("p", "share-roster-note",
      "链接就是老师的身份凭证：转发给谁，谁就能以他的身份进班；换码或收回后旧链接立即失效。"));
    if (!list.length) {
      section.appendChild(FORM.card({
        title: "还没有任课老师",
        desc: "加一位老师，把免登链接发给他",
        nodes: [el("p", "empty", "点上面的「+ 新增任课老师」，填姓名和科目，系统会生成链接和二维码。")],
      }));
      return section;
    }
    var grid = el("div", "grid share-grid");
    list.forEach(function (teacher) { grid.appendChild(teacherCard(teacher)); });
    section.appendChild(grid);
    return section;
  }

  function render(container) {
    if (!container) return;
    container.textContent = "";
    if (STATE.isMember()) {
      container.appendChild(FORM.card({
        title: "分享",
        desc: "只有班主任能分享",
        nodes: [FORM.hintLine("你是任课老师，分享链接由班主任生成；你的链接打开即可直接进班。", true)],
      }));
      return;
    }

    dropLegacyOrder();
    container.appendChild(addCard());
    var list = (window.TEAM && TEAM.data() && TEAM.data().teachers) || [];
    container.appendChild(roster(sortTeachers(list)));
  }

  window.SHARE = { render: render };
})();
