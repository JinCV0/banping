// 静态文件：老师端 h5 在 public/，看板渲染层在 ../board-web/（用 /board/ 前缀挂上）。
// 单容器部署时同一个进程既发接口也发页面，h5 与 /board/ 同源，预览 iframe 才能直接读写。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

// 防目录穿越：解析后的路径必须仍在根目录内
function inside(root, rel) {
  const full = path.resolve(root, "." + rel);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

export function createStaticHandler({ publicDir = path.join(HERE, "public"), boardDir = path.join(HERE, "..", "board-web") } = {}) {
  return async function serve(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;

    let rel = new URL(req.url, "http://localhost").pathname;
    let root = publicDir;
    if (rel === "/board" || rel.startsWith("/board/")) {
      root = boardDir;
      rel = rel.slice("/board".length) || "/";
    }
    if (rel === "/" || rel === "") rel = "/index.html";

    const file = inside(root, rel);
    if (!file) return false;

    let buf;
    try {
      buf = await readFile(file);
    } catch {
      return false; // 没有这个文件就交给路由去回 404
    }

    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": buf.length,
      "cache-control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : buf);
    return true;
  };
}
