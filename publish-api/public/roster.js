/*
  班级页的两张 v3 卡：花名册、值日安排。
  - 花名册：粘贴一列名字（支持从 Excel 复制的 tab 分隔）或上传 CSV，本地解析，不上传文件；
    导入时按姓名保住老 id，值日轮换不会因为重导一次就乱。上限 80 人。
  - 值日：按周/按天/不排 + 每组几人 + 起始日期；旁边直接算「本周该谁」。
  规则写进 STATE.state.duty，花名册写进 STATE.state.roster，保存仍走底部发布。
*/
(function () {
  "use strict";

  var root = null;

  function students() {
    return (STATE.state.roster && STATE.state.roster.students) || [];
  }

  function saveRoster(list, stamp) {
    var roster = MODEL3.cleanRoster({ students: list, updatedAt: stamp });
    STATE.state.roster = roster;
    STATE.touch();
  }

  function trim(value) { return String(value == null ? "" : value).trim(); }

  function splitCells(line) {
    var out = [];
    var cell = "";
    var quoted = false;
    for (var i = 0; i < line.length; i += 1) {
      var ch = line.charAt(i);
      if (quoted) {
        if (ch === '"' && line.charAt(i + 1) === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === "," || ch === ";") { out.push(cell); cell = ""; }
      else cell += ch;
    }
    out.push(cell);
    return out;
  }

  function parseText(raw) {
    var rows = [];
    String(raw || "").split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var cells = line.indexOf("\t") >= 0 ? line.split("\t") : splitCells(line);
      rows.push({ name: trim(cells[0]), no: trim(cells[1] || "") });
    });
    return rows.filter(function (row) { return row.name; });
  }

  function parseCsv(raw) {
    var rows = [];
    var row = [];
    var cell = "";
    var quoted = false;
    var text = String(raw || "").replace(/\r\n?/g, "\n");
    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (quoted) {
        if (ch === '"' && text.charAt(i + 1) === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (cells) { return trim(cells[0]); }).map(function (cells) {
      return { name: trim(cells[0]), no: trim(cells[1] || "") };
    });
  }

  function isHeader(row) {
    return /^(姓名|名字|学生|name|student)$/i.test(trim(row && row.name));
  }

  // 同名保 id：先建 name→id 的旧表，新名单里能对上的沿用，其余发新 id。
  function withStableIds(rows) {
    var old = {};
    students().forEach(function (student) { old[student.name] = student.id; });
    var used = {};
    var seen = {};
    var out = [];
    rows.forEach(function (row) {
      var name = trim(row.name).slice(0, 12);
      if (!name || seen[name]) return;
      seen[name] = true;
      var id = old[name] || MODEL3.newStudentId(used);
      used[id] = true;
      out.push({ id: id, name: name, no: trim(row.no).slice(0, 6) });
    });
    return out;
  }

  function importRows(rows) {
    var list = withStableIds(rows);
    if (!list.length) {
      APP.toast("没认出名字，一行一个再试一次");
      return;
    }
    if (list.length > 80) {
      list = list.slice(0, 80);
      APP.toast("最多 80 人，只保留前 80 个");
    }
    saveRoster(list, MODEL3.stampOf(new Date()));
    render(root);
  }

  function countNode() {
    return FORM.el("p", "roster-count", "共 " + students().length + " 人 / 上限 80");
  }

  function rosterList() {
    var list = FORM.el("div", "roster-list");
    if (!students().length) {
      list.appendChild(FORM.el("p", "empty", "还没导入名单。粘贴一列名字，或上传 CSV。"));
      return list;
    }
    students().forEach(function (student, index) {
      var row = FORM.el("div", "roster-row");
      row.appendChild(FORM.el("span", "roster-no", student.no || String(index + 1)));
      row.appendChild(FORM.el("span", "roster-name", student.name));
      var del = FORM.el("button", "row-del", "×");
      del.type = "button";
      del.title = "从名单里删掉";
      del.addEventListener("click", function () {
        saveRoster(students().filter(function (item) { return item.id !== student.id; }), MODEL3.stampOf(new Date()));
        paintRoster();
      });
      row.appendChild(del);
      list.appendChild(row);
    });
    return list;
  }

  function rosterCard() {
    var area = FORM.el("textarea");
    area.rows = 5;
    area.className = "roster-paste";
    area.placeholder = "张梓萱\n李思远\n…（一行一个名字；从 Excel 复制一列也行）";

    var file = FORM.el("input");
    file.type = "file";
    file.accept = ".csv,text/csv,text/plain";
    file.hidden = true;
    file.addEventListener("change", function () {
      var picked = file.files && file.files[0];
      if (!picked) return;
      var reader = new FileReader();
      reader.onload = function () { importRows(parseCsv(reader.result)); };
      reader.readAsText(picked, "utf-8");
      file.value = "";
    });

    /* 示例名单：12 个常见姓名，让"抽一个""本周值日"马上能用；导入后随时能改 */
    var sample = null;
    var actions = [
      FORM.button("导入名单", function () {
        var rows = parseText(area.value);
        if (isHeader(rows[0])) rows.shift();
        importRows(rows);
        area.value = "";
      }, { ghost: false }),
      FORM.button("上传 CSV", function () { file.click(); }),
      FORM.button("用示例名单", function () {
        if (students().length) {
          MODAL.open({
            title: "换成示例名单？",
            nodes: [FORM.el("p", "modal-lead", "现在的 " + students().length + " 个名字会被这 12 个示例名字替换。")],
            actions: [
              { text: "先不换", primary: false },
              { text: "换成示例", onClick: fillSample },
            ],
          });
          return;
        }
        fillSample();
      }),
    ];

    function fillSample() {
      API.request("/api/v1/board/presets")
        .then(function (res) {
          var names = res.students || [];
          if (!names.length) {
            APP.toast("示例名单没取到", "error");
            return;
          }
          importRows(names.map(function (name, i) {
            return { name: name, no: String(i + 1).padStart(2, "0") };
          }));
        })
        .catch(function () { APP.toast("示例名单没取到", "error"); });
    }
    if (students().length) {
      actions.push(FORM.button("清空", function () {
        MODAL.open({
          title: "清空花名册？",
          nodes: [FORM.el("p", "modal-lead", "清空后值日排班和「抽一个」都没法用；重新导入就行。")],
          dismissable: true,
          actions: [
            { text: "不清空", primary: false },
            { text: "清空", onClick: function () {
              saveRoster([], MODEL3.stampOf(new Date()));
              render(root);
            } },
          ],
        });
      }));
    }

    var actionRow = FORM.el("div", "card-actions");
    actions.forEach(function (button) { actionRow.appendChild(button); });

    var card = FORM.card({
      title: "花名册",
      desc: "粘贴一列名字，或上传 CSV（第一列姓名、第二列学号）；只在本机解析。",
      nodes: [area, actionRow, file, countNode(), rosterList()],
    });
    card.dataset.card = "roster";
    return card;
  }

  function paintRoster() {
    var card = root && root.querySelector('[data-card="roster"]');
    if (!card) return;
    var count = card.querySelector(".roster-count");
    var list = card.querySelector(".roster-list");
    if (count) count.textContent = "共 " + students().length + " 人 / 上限 80";
    if (list && list.parentNode) list.parentNode.replaceChild(rosterList(), list);
  }

  function dutyRule() {
    if (!STATE.state.duty) STATE.state.duty = MODEL3.cleanDuty(null);
    return STATE.state.duty;
  }

  function dutyCard() {
    var rule = dutyRule();
    var out = FORM.el("div", "duty-now");

    function sync() {
      var info = MODEL3.dutyFor(students(), rule, STATE.util.todayISO());
      out.textContent = "";
      if (!students().length) {
        out.appendChild(FORM.el("p", "empty", "先导入花名册，这里才会算值日。"));
      } else if (info.mode === "off") {
        out.appendChild(FORM.el("p", "empty", "现在不自动排班；大屏今日值日用手写的「今日值日」。"));
      } else if (!info.names.length) {
        out.appendChild(FORM.el("p", "empty", "这组没人了，检查每组人数。"));
      } else {
        out.appendChild(FORM.el("p", "duty-names", (info.mode === "weekly" ? "本周值日：" : "今天值日：") + info.names.join("、")));
        out.appendChild(FORM.el("p", "duty-sub", "第 " + info.index + " 组 / 共 " + info.groups + " 组，每组 " + info.size + " 人"));
      }
    }

    var mode = FORM.selectBox("排班方式", [
      { value: "weekly", label: "按周（每组值一周）" },
      { value: "daily", label: "按天（每天一组）" },
      { value: "off", label: "不自动排" },
    ], rule.mode, function (value) {
      rule.mode = value;
      STATE.touch();
      sync();
    });

    var size = FORM.selectBox("每组人数", [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) {
      return { value: String(n), label: n + " 人" };
    }), String(rule.size), function (value) {
      rule.size = Number(value);
      STATE.touch();
      sync();
    });

    var anchor = FORM.textBox("起始日期", rule.anchor || "", 0, function (value) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) rule.anchor = value;
      STATE.touch();
      sync();
    }, { type: "date", hint: "从这天开始轮；不填按开学（9 月 1 日）算。" });

    sync();
    var fields = FORM.el("div", "field-row");
    fields.appendChild(mode);
    fields.appendChild(size);
    fields.appendChild(anchor);
    var card = FORM.card({
      title: "值日安排",
      desc: "按花名册顺序分组轮换；大屏的「今日值日」磁贴读这个规则。",
      nodes: [fields, out],
    });
    card.dataset.card = "duty";
    return card;
  }

  function render(container) {
    root = container;
    if (STATE.isMember()) return; // 班级级配置只有班主任能改，任课老师那边不渲染这两张卡
    // 导入/删除后只重画这两张卡：先把旧的摘掉，避免同一个 grid 里叠出两张花名册。
    Array.prototype.forEach.call(container.querySelectorAll('[data-card="roster"], [data-card="duty"]'), function (card) {
      if (card.parentNode) card.parentNode.removeChild(card);
    });
    container.appendChild(rosterCard());
    container.appendChild(dutyCard());
  }

  window.ROSTER = { render: render };
})();
