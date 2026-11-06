/*
  未绑定屏的配对卡（方向反转：大屏显示，老师手机扫码）
  ---------------------------------------------------------------
  时序见 docs/board-v2.md 第 4 节：
    ① 大屏 POST /api/v1/devices/claim 拿 {code, claimId, pollToken, pairUrl}
    ② 右下角显示 6 位码 + 二维码；每 2s 用 claimId+pollToken 轮询
    ③ 老师手机打开 pairUrl（或输码）确认绑定
    ④ 轮询拿到 deviceToken → postMessage 给宿主 → 宿主落盘并开始同步
  pollToken 只有这块屏知道，别人就算看到 6 位码也换不到令牌。
  本地 file:// 预览没有 BOARD_HOST，也不会起轮询（不会去骚扰服务端）。
*/
(function () {
  var host = window.BOARD_HOST || null;
  var card = document.getElementById("pair");
  var canvas = document.getElementById("pair-qr");
  var codeEl = document.getElementById("pair-code");
  var urlEl = document.getElementById("pair-url");
  var noteEl = document.getElementById("pair-note");
  var screenEl = document.getElementById("screen-code");

  var claim = null;
  var pollTimer = 0;
  var retryTimer = 0;
  var fails = 0;
  var stopped = false;

  function isHost() {
    return Boolean(host && host.mode === "host");
  }

  function setNote(text) {
    if (noteEl) noteEl.textContent = text;
  }

  function showCard() {
    if (card) card.hidden = false;
    document.body.classList.add("is-unpaired");
  }

  function hideCard() {
    if (card) card.hidden = true;
    document.body.classList.remove("is-unpaired");
  }

  function showScreenCode(code) {
    if (!screenEl || !code) return;
    screenEl.textContent = "屏码 " + code;
    screenEl.hidden = false;
  }

  function postToHost(message) {
    try {
      if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
        window.chrome.webview.postMessage(message);
      }
    } catch (err) {
      /* 不是宿主环境就没有接收方，忽略 */
    }
  }

  /* ---- 二维码：画不进就只留大号数字码，绝不挡住配对 ---- */
  function setQrVisible(visible) {
    if (!canvas) return;
    canvas.hidden = !visible;
    // 有些 UA/样式会把 canvas 的 display 撑开，hidden 属性靠不住，再补一手内联样式
    canvas.style.display = visible ? "" : "none";
  }

  function drawQr(text) {
    if (!canvas) return;
    if (typeof window.qrcode !== "function" || !text) {
      setQrVisible(false);
      return;
    }
    try {
      var qr = window.qrcode(0, "M");
      qr.addData(text);
      qr.make();
      var count = qr.getModuleCount();
      var size = canvas.width;
      var cell = Math.floor(size / count);
      var offset = Math.floor((size - cell * count) / 2);
      var ctx = canvas.getContext("2d");
      setQrVisible(true);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#101a14";
      for (var row = 0; row < count; row += 1) {
        for (var col = 0; col < count; col += 1) {
          if (qr.isDark(row, col)) ctx.fillRect(offset + col * cell, offset + row * cell, cell, cell);
        }
      }
    } catch (err) {
      setQrVisible(false);
    }
  }

  function paint(data) {
    if (codeEl) codeEl.textContent = String(data.code || "").toUpperCase();
    if (urlEl) urlEl.textContent = String(data.pairUrl || "").replace(/^https?:\/\//, "");
    drawQr(data.pairUrl);
    // 服务端 expiresAt 是 ISO 字符串，直接相减会得到 NaN 分钟
    var expiresAt = new Date(data.expiresAt).getTime();
    var minutes = Number.isFinite(expiresAt)
      ? Math.max(1, Math.round((expiresAt - Date.now()) / 60000))
      : 10;
    setNote("配对码 " + minutes + " 分钟内有效，过期会自动换新的");
  }

  /* ---- ① 申请配对码 ---- */
  function mint() {
    if (stopped) return;
    if (isHost() && host.paired) return;
    showCard();
    setQrVisible(false); // 还没拿到 pairUrl 之前不要摆一个白方块
    setNote("正在获取配对码…");
    fetch("/api/v1/devices/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: host.screenCode ? String(host.screenCode) : "" }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        fails = 0;
        claim = data;
        paint(data);
        schedulePoll();
      })
      .catch(function (err) {
        fails += 1;
        var wait = Math.min(30, 5 * fails);
        setNote("配不上服务（" + err.message + "），" + wait + " 秒后重试");
        clearTimeout(retryTimer);
        retryTimer = setTimeout(mint, wait * 1000);
      });
  }

  /* ---- ② 轮询绑定结果 ---- */
  function pollOnce() {
    if (!claim || stopped) return;
    var url = "/api/v1/devices/claim?claimId=" + encodeURIComponent(claim.claimId) +
      "&pollToken=" + encodeURIComponent(claim.pollToken);
    fetch(url)
      .then(function (res) {
        return res.json().then(function (body) {
          return { status: res.status, body: body };
        });
      })
      .then(function (out) {
        var body = out.body || {};
        if (out.status === 200 && body.status === "bound") {
          finish(body);
          return;
        }
        if (out.status === 200 && body.status === "used") {
          setNote("这块大屏已经绑定过了，正在等待数据…");
          return;
        }
        if (out.status === 410) {
          stopPoll();
          claim = null;
          setNote("配对码过期了，正在重新生成…");
          retryTimer = setTimeout(mint, 1500);
        }
      })
      .catch(function () {
        /* 网络抖一下不影响，下一轮继续 */
      });
  }

  function schedulePoll() {
    stopPoll();
    pollTimer = setInterval(pollOnce, 2000);
  }

  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = 0;
  }

  /* ---- ③ 绑定成功：交给宿主，屏上换成小号屏码 ---- */
  function finish(body) {
    stopped = true;
    stopPoll();
    clearTimeout(retryTimer);
    hideCard();
    showScreenCode(body.screenCode);
    postToHost({
      type: "board:paired",
      token: body.deviceToken,
      screenCode: body.screenCode,
      classId: body.classId,
      className: body.className,
    });
  }

  /* 宿主发现令牌失效时会调用它：重新显示配对卡 */
  window.BOARD_PAIR_RESET = function () {
    if (!isHost()) return false;
    stopped = false;
    claim = null;
    host.paired = false;
    if (screenEl) screenEl.hidden = true;
    mint();
    return true;
  };

  /*
    宿主换了 BOARD_HOST（绑定/解绑之后）时调用。
    有了它宿主就不用整页重载来回倒——重载会闪白一帧，而且刚注入的 BOARD_HOST 又是旧值。
  */
  window.BOARD_HOST_CHANGED = function (next) {
    if (!next || next.mode !== "host") return false;
    host = next;
    if (host.paired) {
      stopped = true;
      stopPoll();
      clearTimeout(retryTimer);
      claim = null;
      hideCard();
      showScreenCode(host.screenCode);
      return true;
    }
    return window.BOARD_PAIR_RESET();
  };

  if (!isHost()) {
    hideCard();
    if (host && host.paired) showScreenCode(host.screenCode);
    return;
  }

  if (host.paired) {
    hideCard();
    showScreenCode(host.screenCode);
    return;
  }

  mint();
})();


