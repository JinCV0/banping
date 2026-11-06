// 极简路由：静态路径 + JSON body + 统一错误。没有框架，也没有中间件栈。
import { ApiError, notFound } from "./errors.js";
import { resolvePrincipal } from "./auth.js";

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError(413, "BODY_TOO_LARGE", "请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, "BAD_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

// route: { method, path, auth: "none" | "user" | "device" | "any", handler(ctx) }
export function createRouter({ routes, store, config, events }) {
  const table = new Map(routes.map((route) => [`${route.method} ${route.path}`, route]));

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const route = table.get(`${req.method} ${url.pathname}`);

    if (!route) {
      if (url.pathname === "/api/v1/health" && req.method === "GET") {
        return sendJson(res, 200, { ok: true, uptimeSec: Math.round(process.uptime()) });
      }
      if (url.pathname.startsWith("/api/")) {
        return sendJson(res, 404, { error: { code: notFound().code, message: `没有这个接口：${url.pathname}` } });
      }
      return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "没有这个页面" } });
    }

    try {
      const principal = route.auth === "none" ? null : resolvePrincipal(store, req, config.now());
      if (route.auth === "user" && principal?.kind !== "user") {
        throw new ApiError(401, "UNAUTHORIZED", "请先登录");
      }
      if (route.auth === "device" && principal?.kind !== "device") {
        throw new ApiError(401, "UNAUTHORIZED", "设备未配对");
      }
      if (route.auth === "any" && !principal) {
        throw new ApiError(401, "UNAUTHORIZED", "未登录或设备未配对");
      }

      const body = req.method === "GET" ? {} : await readBody(req, config.maxBodyBytes);
      await route.handler({
        req,
        res,
        url,
        body,
        store,
        config,
        events,
        user: principal?.kind === "user" ? principal.user : null,
        device: principal?.kind === "device" ? principal.device : null,
        sendJson,
      });
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof ApiError) {
        return sendJson(res, error.status, {
          error: { code: error.code, message: error.message, details: error.details },
        });
      }
      console.error("[publish-api] 未处理异常:", error);
      return sendJson(res, 500, { error: { code: "INTERNAL", message: "服务端异常" } });
    }
  };
}

export { sendJson };
