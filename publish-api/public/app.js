/*
  装配层：登录判定 → 拉看板 → 三个 tab 的渲染 → 保存/冲突 → 退出。
  这里不放任何业务字段的编辑逻辑（那在 today/schedule/settings/team 里），
  只负责"什么时候画哪一屏"和"保存时怎么跟服务端对齐 revision"。
*/
(function () {
  "use strict";

  var activeTab = "today";
  var saving = false;
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }

  function toast(text, kind) {
    var node = $("toast");
    if (!node) return;
    node.hidden = false;
    node.textContent = text || "";
    node.className = "toast" + (kind ? " is-" + kind : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 2800);
  }

  function setSaveMsg(text, kind) {
    var node = $("save-msg");
    if (!node) return;
    node.textContent = text || "";
    node.className = "save-msg" + (kind ? " is-" + kind : "");
  }

  function paintDirty() {
    var wrap = $("dirty");
    var text = $("dirty-text");
    if (!wrap || !text) return;
    wrap.className = "dirty" + (STATE.dirty ? " is-dirty" : "");
    text.textContent = STATE.dirty ? "有未发布的修改" : "已同步";
    var btn = $("save-btn");
    if (btn) btn.disabled = saving || !STATE.state;
  }

  function paintWho() {
    var who = $("who");
    if (!who || !STATE.user) return;
    var user = STATE.user;
    var klass = user.class ? user.class.name : "";
    if (STATE.isMember()) {
      who.textContent = klass + " · " + user.name + " · " + (STATE.mySubjectName() || "任课") + "（只改自己这一科）";
    } else {
      who.textContent = klass + " · " + user.name + " · 班主任";
    }
  }

  function renderPane(name) {
    var container = $("pane-" + name);
    if (!container || !STATE.state) return;
    if (name === "today" && window.TODAY) TODAY.render(container);
    if (name === "schedule" && window.SCHEDULE) SCHEDULE.render(container);
    if (name === "class" && window.SETTINGS) SETTINGS.render(container);
    if (name === "share" && window.SHARE) SHARE.render(container);
    if (name === "layout" && window.LAYOUT) LAYOUT.render(container);
  }

  function switchTab(name) {
    // 任课老师没有分享/布局权：地址栏里带 share 或 layout 也退回今日，避免露出班主任才能用的入口。
    if ((name === "share" || name === "layout") && STATE.isMember()) name = "today";
    activeTab = name;
    if (window.history && history.replaceState) {
      try { history.replaceState(null, "", "?tab=" + name); } catch (err) { /* file:// 之类忽略 */ }
    }
    Array.prototype.forEach.call(document.querySelectorAll("#main-tabs .seg-btn"), function (btn) {
      btn.classList.toggle("is-on", btn.dataset.tab === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tabpane"), function (pane) {
      pane.hidden = pane.dataset.pane !== name;
    });
    renderPane(name);
  }

  async function refreshFromServer(message) {
    await STATE.load();
    renderPane(activeTab);
    paintDirty();
    PREVIEW.flush();
    if (window.OVERVIEW) OVERVIEW.render();
    if (message) setSaveMsg(message, "warn");
  }

  // 重新拉 /me：绑定大屏、改名、加老师之后都要让顶栏/概览/大屏卡跟上。
  async function refreshMe() {
    var me = await API.request("/api/v1/me");
    STATE.user = me.user || STATE.user;
    if (window.TEAM) TEAM.setData(me);
    paintWho();
    renderPane(activeTab);
    if (window.OVERVIEW) OVERVIEW.render();
    if (window.GATE) GATE.paintHint();
    return me;
  }

  function logout() {
    API.setToken("");
    STATE.reset();
    if (window.TEAM) TEAM.setData(null);
    LOGIN.show();
  }

  function memberCheck() {
    if (!STATE.isMember()) return true;
    var id = STATE.mySubjectId();
    var name = STATE.mySubjectName();
    var entry = (STATE.state.today.homework || []).filter(function (item) {
      return item.subject === id;
    })[0];
    if (!entry || !entry.items.length) {
      setSaveMsg("先给「" + name + "」填至少一条作业再发布", "warn");
      return false;
    }
    return true;
  }

  async function save() {
    if (saving || !STATE.state) return;
    if (!memberCheck()) return;
    saving = true;
    paintDirty();
    setSaveMsg("正在发布…");
    try {
      var res = await STATE.save();
      setSaveMsg("已发布 · revision " + STATE.revision + " · " + (res && res.pushed ? "已推送到大屏" : "已保存"), "ok");
      toast("已发布", "ok");
      PREVIEW.flush();
    } catch (err) {
      if (err.status === 409) {
        try {
          await refreshFromServer("看板已被更新，已刷新到最新版本；请确认后重新发布");
          toast("看板已被更新，已刷新", "error");
        } catch (again) {
          setSaveMsg(again.message || "刷新失败", "warn");
        }
      } else {
        var detail = err.details && err.details.length ? String(err.details[0]) : err.message;
        setSaveMsg(detail || "发布失败", "warn");
        toast(detail || "发布失败", "error");
      }
    } finally {
      saving = false;
      paintDirty();
    }
  }

  function bindChrome() {
    Array.prototype.forEach.call(document.querySelectorAll("#main-tabs .seg-btn"), function (btn) {
      btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
    });

    $("save-btn").addEventListener("click", save);

    $("logout").addEventListener("click", logout);

    var toggle = $("preview-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var open = document.body.classList.toggle("preview-open");
        toggle.textContent = open ? "收起" : "预览";
      });
    }
    var close = $("preview-close");
    if (close) {
      close.addEventListener("click", function () {
        document.body.classList.remove("preview-open");
        if (toggle) toggle.textContent = "预览";
      });
    }

    document.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        save();
      }
    });

    STATE.subscribe(function (kind) {
      if (kind === "dirty" || kind === "saved") paintDirty();
      if (kind === "change") PREVIEW.schedule();
      if (kind === "change" || kind === "saved") {
        if (window.OVERVIEW) OVERVIEW.render();
      }
    });
  }

  async function boot(user) {
    STATE.user = user;
    var me = null;
    try {
      me = await API.request("/api/v1/me");
      STATE.user = me.user || user;
      STATE.license = me.license || null;
      if (window.TEAM) TEAM.setData(me);
      await STATE.load();
    } catch (err) {
      if (err.status === 401) {
        LOGIN.show();
        LOGIN.message("登录已过期，请重新登录", "error");
        return;
      }
      LOGIN.show();
      LOGIN.message(err.message || "加载看板失败", "error");
      return;
    }
    LOGIN.hide();
    paintWho();
    var btn = $("save-btn");
    if (btn) btn.textContent = STATE.isMember() ? "保存我这一科" : "保存并发布";
    var shareTab = $("tab-share");
    if (shareTab) shareTab.hidden = STATE.isMember();
    var layoutTab = $("tab-layout");
    if (layoutTab) layoutTab.hidden = STATE.isMember();
    switchTab(activeTab);
    // 其余几屏也先按当前身份画一遍：任课老师登录后，切过去之前隐藏的旧 DOM 也不该留着可编辑控件。
    ["today", "schedule", "class", "share", "layout"].forEach(function (name) {
      if (name === activeTab) return;
      if ((name === "share" || name === "layout") && STATE.isMember()) return;
      renderPane(name);
    });
    paintDirty();
    setSaveMsg(STATE.revision ? "当前 revision " + STATE.revision : "第一次发布：保存后会出现在大屏上");
    PREVIEW.flush();
    if (window.OVERVIEW) OVERVIEW.render();
    // 班主任没绑大屏就直接拦路；member 不弹，/me 失败上面已经提前 return 了。
    if (window.GATE) GATE.check(me);
  }

  function initialTab() {
    var match = /[?&]tab=(today|schedule|class|share|layout)/.exec(window.location.search || "");
    return match ? match[1] : "today";
  }

  async function start() {
    activeTab = initialTab();
    PREVIEW.init();
    LOGIN.init(function (user) { boot(user); });
    bindChrome();

    if (!API.token()) {
      LOGIN.show();
      return;
    }
    try {
      var me = await API.request("/api/v1/me");
      boot(me.user);
    } catch (err) {
      API.setToken("");
      LOGIN.show();
      if (err.status !== 401) LOGIN.message(err.message || "登录状态失效", "error");
    }
  }

  window.APP = {
    toast: toast,
    renderPane: renderPane,
    paintWho: paintWho,
    switchTab: switchTab,
    refreshMe: refreshMe,
    logout: logout,
    boot: boot,
    start: start,
  };

  document.addEventListener("DOMContentLoaded", start);
})();



