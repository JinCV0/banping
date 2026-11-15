/*
  今日：日期与倒计时 + 每科作业卡 + 待办 / 通知 / 值日 / 寄语。
  科目卡按 subjects 顺序铺进网格——这就是"不只语文数学英语"的落点：
  班里有几科，这里就有几张卡；任课老师登录后只有自己那张能改。
*/
(function () {
  "use strict";

  var L = window.BOARD_LIMITS || {};
  var root = null;
  // 点过「＋ 布置」的空科目：本次会话内保持展开，别让老师刚点开就被收回去。
  var expanded = {};

  function touch() {
    if (window.STATE) STATE.touch();
  }

  function homeworkEntry(subjectId) {
    var list = STATE.state.today.homework || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].subject === subjectId) return list[i];
    }
    return null;
  }

  // 作业是"有内容才存在"：全空就把整条摘掉，免得服务端 minItems 校验拦下来。
  function writeHomework(subjectId, items, note) {
    var today = STATE.state.today;
    var list = today.homework || [];
    var cleaned = [];
    items.forEach(function (line) {
      var value = String(line || "").trim();
      if (value) cleaned.push(value.slice(0, L.homeworkItem || 42));
    });
    var index = -1;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].subject === subjectId) { index = i; break; }
    }
    if (!cleaned.length) {
      if (index >= 0) list.splice(index, 1);
      touch();
      return;
    }
    var entry = { subject: subjectId, items: cleaned.slice(0, 6) };
    var noteText = String(note || "").trim();
    if (noteText) entry.note = noteText.slice(0, L.homeworkNote || 24);
    if (index >= 0) list[index] = entry;
    else list.push(entry);
    touch();
  }

  function homeworkCard(subject) {
    var canEdit = STATE.canEditSubject(subject);
    var entry = homeworkEntry(subject.id);
    var items = entry ? entry.items.slice() : [];
    var noteInput = null;

    var rows = FORM.rowsEditor("作业内容", items, {
      limit: L.homeworkItem || 42,
      max: 6,
      disabled: !canEdit,
      placeholder: "如：完成练习册 P32–P34",
      onChange: function (next) {
        writeHomework(subject.id, next, noteInput ? noteInput.value : (entry && entry.note) || "");
      },
    });

    var noteField = FORM.textBox("这一科的通知", (entry && entry.note) || "", L.homeworkNote || 24, function (value) {
      var current = homeworkEntry(subject.id);
      var currentItems = current ? current.items.slice() : [];
      writeHomework(subject.id, currentItems, value);
    }, { placeholder: "如：明天带实验报告", disabled: !canEdit });
    noteInput = noteField.querySelector("input");

    var head = FORM.el("div", "subject-head");
    var dot = FORM.el("i", "subject-dot");
    dot.style.background = subject.color;
    head.appendChild(dot);
    head.appendChild(FORM.el("span", "subject-name", subject.name));
    if (!canEdit) head.appendChild(FORM.el("span", "subject-note-tag", "只读"));

    var card = FORM.el("section", "card subject-card");
    card.appendChild(head);
    card.appendChild(rows);
    card.appendChild(noteField);
    return card;
  }

  function countdownField(member) {
    var countdown = STATE.state.countdown;
    var enabled = !!(countdown && countdown.date);

    var toggle = FORM.el("label", "chk");
    var box = FORM.el("input");
    box.type = "checkbox";
    box.checked = enabled;
    box.disabled = member;
    toggle.appendChild(box);
    toggle.appendChild(FORM.el("span", null, "显示倒计时"));

    var labelField = FORM.textBox("倒计时标题", (countdown && countdown.label) || "距离期末", L.countdownLabel || 12, function (value) {
      if (!STATE.state.countdown) return;
      STATE.state.countdown.label = value;
      touch();
    }, { disabled: member || !enabled, placeholder: "如：距离期末" });
    var labelInput = labelField.querySelector("input");

    var dayField = FORM.textBox("目标日期", (countdown && countdown.date) || "", 0, function (value) {
      if (!STATE.state.countdown) return;
      STATE.state.countdown.date = value;
      touch();
    }, { type: "date", disabled: member || !enabled });
    var dateInput = dayField.querySelector("input");

    function syncCountdown() {
      if (box.checked) {
        STATE.state.countdown = {
          label: (labelInput.value || "距离期末").slice(0, L.countdownLabel || 12),
          date: dateInput.value || STATE.util.addDays(STATE.util.todayISO(), 30),
        };
        if (!dateInput.value) dateInput.value = STATE.state.countdown.date;
      } else {
        delete STATE.state.countdown;
      }
      labelInput.disabled = !box.checked;
      dateInput.disabled = !box.checked;
      touch();
    }
    box.addEventListener("change", syncCountdown);

    var cdWrap = FORM.el("div", "inline");
    cdWrap.appendChild(labelField);
    cdWrap.appendChild(dayField);

    var cdField = FORM.el("div", "field");
    cdField.appendChild(toggle);
    cdField.appendChild(cdWrap);
    return cdField;
  }

  function headerCard() {
    var member = STATE.isMember();
    var date = STATE.state.today.date || STATE.util.todayISO();
    var isToday = date === STATE.util.todayISO();

    var dateField = FORM.textBox("看板日期", date, 0, function (value) {
      STATE.state.today.date = value;
      touch();
    }, {
      type: "date",
      disabled: member,
      hint: isToday ? "就是今天" : "不是今天：大屏标题会写成「" + STATE.util.formatCN(date) + " 作业」",
    });

    return FORM.card({
      title: "今日",
      desc: "只改这一天；课表在「课表」里维护",
      nodes: [dateField, countdownField(member)],
    });
  }

  function todoCard() {
    var member = STATE.isMember();
    var rows = FORM.rowsEditor("待办（每行一条）", STATE.state.today.todo || [], {
      limit: L.todoItem || 24,
      max: 6,
      disabled: member,
      placeholder: "如：交回执单",
      onChange: function (next) {
        STATE.state.today.todo = next.map(function (line) {
          return String(line || "").trim().slice(0, L.todoItem || 24);
        }).filter(Boolean).slice(0, 6);
        touch();
      },
    });
    return FORM.card({ title: "今日待办", desc: "最多 6 条", nodes: [rows] });
  }

  function noticeCard() {
    var member = STATE.isMember();
    var notice = STATE.state.today.notice || {};
    var signInput = null;
    var textField = FORM.textBox("班级通知", notice.text || "", L.noticeText || 60, function (value) {
      var next = STATE.state.today.notice || {};
      next.text = value;
      if (signInput) next.sign = signInput.value;
      STATE.state.today.notice = next;
      touch();
    }, { rows: 3, disabled: member, placeholder: "如：周五下午家长会，请提前告知家长" });

    var signField = FORM.textBox("落款", notice.sign || "", L.noticeSign || 16, function (value) {
      var next = STATE.state.today.notice || {};
      if (!next.text) return;
      next.sign = value;
      STATE.state.today.notice = next;
      touch();
    }, { disabled: member, placeholder: "如：班主任" });
    signInput = signField.querySelector("input");

    return FORM.card({ title: "班级通知", desc: "大屏底部横条", nodes: [textField, signField] });
  }

  function dutyCard() {
    var member = STATE.isMember();
    var duty = STATE.state.today.duty || {};
    var textField = FORM.textBox("今日值日", duty.text || "", L.dutyText || 40, function (value) {
      STATE.state.today.duty = { text: value };
      touch();
    }, { disabled: member, placeholder: "如：第三组 · 李同学负责" });
    return FORM.card({ title: "值日", desc: "一行字，别写长", nodes: [textField] });
  }

  function quoteCard() {
    var member = STATE.isMember();
    var quote = STATE.state.today.quote || {};
    var signInput = null;
    var textField = FORM.textBox("每日寄语", quote.text || "", L.quoteText || 60, function (value) {
      var next = STATE.state.today.quote || {};
      next.text = value;
      if (signInput) next.sign = signInput.value;
      STATE.state.today.quote = next;
      touch();
    }, { rows: 2, disabled: member, placeholder: "如：把今天过成值得记住的一天" });

    var signField = FORM.textBox("署名", quote.sign || "", L.quoteSign || 16, function (value) {
      var next = STATE.state.today.quote || {};
      if (!next.text) return;
      next.sign = value;
      STATE.state.today.quote = next;
      touch();
    }, { disabled: member, placeholder: "如：班主任" });
    signInput = signField.querySelector("input");

    return FORM.card({ title: "每日寄语", desc: "大屏右下角", nodes: [textField, signField] });
  }

  function hasContent(subject) {
    var entry = homeworkEntry(subject.id);
    return !!(entry && ((entry.items && entry.items.length) || entry.note));
  }

  // 没布置的科目收成一行：色点 + 科目名 + 未布置 + 布置按钮，别用空卡占版面。
  function miniRow(subject) {
    var canEdit = STATE.canEditSubject(subject);
    var row = FORM.el("div", "subject-mini");
    var dot = FORM.el("i", "subject-dot");
    dot.style.background = subject.color;
    row.appendChild(dot);
    row.appendChild(FORM.el("span", "subject-mini-name", subject.name));
    row.appendChild(FORM.el("span", "subject-mini-state", "未布置"));
    if (canEdit) {
      row.appendChild(FORM.button("＋ 布置", function () {
        expanded[subject.id] = true;
        render(root);
      }, { ghost: true }));
    }
    return row;
  }

  function groupHead(title, desc) {
    var head = FORM.el("div", "group-head");
    head.appendChild(FORM.el("span", "group-bar"));
    var text = FORM.el("div", "group-title");
    text.appendChild(FORM.el("h2", null, title));
    if (desc) text.appendChild(FORM.el("p", null, desc));
    head.appendChild(text);
    return head;
  }

  function group(title, desc, nodes) {
    var section = FORM.el("section", "group");
    section.appendChild(groupHead(title, desc));
    nodes.forEach(function (node) { section.appendChild(node); });
    return section;
  }

  function render(container) {
    root = container;
    root.textContent = "";
    if (!STATE.state) return;

    var subjects = STATE.state.subjects || [];
    var cards = FORM.el("div", "grid");
    var minis = [];

    if (STATE.isMember()) {
      var mine = subjects.filter(function (s) { return STATE.canEditSubject(s); });
      subjects = mine.concat(subjects.filter(function (s) { return !STATE.canEditSubject(s); }));
    }

    subjects.forEach(function (subject) {
      if (hasContent(subject) || expanded[subject.id]) cards.appendChild(homeworkCard(subject));
      else minis.push(subject);
    });

    var homeworkNodes = [];
    if (STATE.isMember()) {
      homeworkNodes.push(FORM.hintLine("你是任课老师（" + STATE.mySubjectName() + "）：只有自己这一科可改，其余只读；保存时服务端只合并你这一科。", true));
    }
    if (cards.children.length) homeworkNodes.push(cards);
    if (minis.length) {
      var list = FORM.el("div", "mini-list");
      minis.forEach(function (subject) { list.appendChild(miniRow(subject)); });
      homeworkNodes.push(list);
    }
    if (!homeworkNodes.length) {
      homeworkNodes.push(FORM.el("p", "empty", "还没有科目，先去「班级」里勾选这个班开了哪些科。"));
    }

    var extras = FORM.el("div", "grid");
    extras.appendChild(todoCard());
    extras.appendChild(noticeCard());
    extras.appendChild(dutyCard());
    extras.appendChild(quoteCard());

    root.appendChild(headerCard());
    var callCard = window.CALL ? CALL.card() : null;
    if (callCard) root.appendChild(callCard);
    root.appendChild(group("作业", "有内容的科目展开成卡；没布置的收成一行，点「＋ 布置」再展开", homeworkNodes));
    root.appendChild(group("补充信息", "待办、通知、值日、寄语——大屏上不是作业的部分都在这", [extras]));
  }

  window.TODAY = { render: render };
})();

