/*
  接口调用只有这一处：带令牌、剥错误体、把 409 之类原样抛给调用方。
  页面脚本不许直接 fetch——统一入口才管得住令牌不该出现在哪里。
*/
(function () {
  "use strict";

  var TOKEN_KEY = "bsp.token";

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(value) {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function fail(res, data) {
    var body = data && data.error ? data.error : {};
    var error = new Error(body.message || "HTTP " + res.status);
    error.status = res.status;
    error.code = body.code || null;
    error.details = body.details || null;
    return error;
  }

  async function request(path, options) {
    var opt = options || {};
    var headers = {};
    if (opt.body !== undefined) headers["content-type"] = "application/json";
    if (opt.auth !== false && token()) headers.authorization = "Bearer " + token();

    var init = { method: opt.method || "GET", headers: headers };
    if (opt.body !== undefined) init.body = JSON.stringify(opt.body);

    var res = await fetch(path, init);
    var data = null;
    try {
      data = await res.json();
    } catch {
      data = null; // 204 或非 JSON
    }
    if (res.ok) return data;

    if (res.status === 401 && opt.auth !== false) setToken("");
    throw fail(res, data);
  }

  window.API = { request: request, token: token, setToken: setToken };
})();
