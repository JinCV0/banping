/*
  今日页的「抽一个」：花名册不为空时出现。
  抽人只是老师端的一次编辑——写进 state.today.call 再走保存发布，大屏的点名磁贴读它。
  最近的 8 个名字存在本机 localStorage，随机时先避开；换电脑不跟着走，但一轮课上够用了。
*/
(function () {
  "use strict";

  var RECENT_KEY = "bsp.call.recent";
  var root = null;

  function recent() {
    try {
      var list = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(list) ? list.filter(function (n) { return typeof n === "string"; }).slice(-8) : [];
    } catch (err) {
      return [];
    }
  }

  function remember(name) {
    var list = recent().filter(function (item) { return item !== name; });
    list.push(name);
    try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(-8))); } catch (err) { /* 隐私模式忽略 */ }
  }

  function pick(studentList) {
    var avoid = recent();
    var pool = studentList.filter(function (student) { return avoid.indexOf(student.name) < 0; });
    if (!pool.length) pool = studentList;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function card() {
    if (!STATE.state || STATE.isMember()) return null;
    var studentList = (STATE.state.roster && STATE.state.roster.students) || [];
    if (!studentList.length) return null;

    var call = STATE.state.today.call;
    var box = FORM.el("div", "call-now");

    function paint() {
      call = STATE.state.today.call;
      box.textContent = "";
      if (call && call.name) {
        box.appendChild(FORM.el("span", "call-label", "抽到"));
        box.appendChild(FORM.el("span", "call-name", call.name));
        box.appendChild(FORM.el("span", "call-at", String(call.at || "").slice(11, 16)));
      } else {
        box.appendChild(FORM.el("span", "call-name is-empty", "还没抽"));
      }
    }

    function draw() {
      STATE.touch();
      paint();
      var cancel = cardBox.querySelector(".call-cancel");
      if (cancel) cancel.hidden = !(STATE.state.today.call && STATE.state.today.call.name);
    }

    function drawOne() {
      var student = pick(studentList);
      if (!student) return;
      STATE.state.today.call = { name: student.name, at: MODEL3.stampOf(new Date()) };
      remember(student.name);
      APP.toast("抽到 " + student.name);
      draw();
    }

    var drawBtn = FORM.button("抽一个", drawOne, { ghost: false });
    var cancelBtn = FORM.button("取消点名", function () {
      delete STATE.state.today.call;
      draw();
    });
    cancelBtn.className = "ghost small call-cancel";

    var cardBox = FORM.card({
      title: "课堂点名",
      desc: "从花名册随机点一位；最近点过的会先避开。",
      actions: [drawBtn],
      nodes: [box, cancelBtn],
    });
    paint();
    cancelBtn.hidden = !(STATE.state.today.call && STATE.state.today.call.name);
    root = cardBox;
    return cardBox;
  }

  window.CALL = { card: card };
})();
