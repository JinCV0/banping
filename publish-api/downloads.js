// 安装包下载：msi/exe 这类大文件不进 git，放在服务器目录里用流发出去。
// 目录默认在数据库旁边（线上 = /var/lib/class-board/downloads），发版时人工上传新包。
// 只认安装包文件名，避免顺手把目录里别的东西发出去，也挡掉 ../ 这类穿越。
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const PREFIX = "/download/";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(msi|exe|zip)$/i;

function sendText(res, status, text) {
  const body = Buffer.from(text, "utf8");
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}

/** 解析 Range: bytes=a-b / bytes=a- / bytes=-n；不合法返回 null（按整份发） */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start;
  let end;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Number(m[2]);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  if (start >= size || start > end) return { invalid: true };
  return { start, end: Math.min(end, size - 1) };
}

export function createDownloadHandler({ dir }) {
  const root = path.resolve(dir);

  return async function serveDownload(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith(PREFIX)) return false;

    let name = "";
    try {
      name = decodeURIComponent(url.pathname.slice(PREFIX.length));
    } catch {
      sendText(res, 400, "文件名不合法");
      return true;
    }
    if (!NAME_RE.test(name)) {
      sendText(res, 404, "找不到这个文件");
      return true;
    }
    const file = path.resolve(root, name);
    if (file !== path.join(root, name)) {
      sendText(res, 404, "找不到这个文件");
      return true;
    }

    let info;
    try {
      info = await stat(file);
    } catch {
      sendText(res, 404, "找不到这个文件");
      return true;
    }
    if (!info.isFile()) {
      sendText(res, 404, "找不到这个文件");
      return true;
    }

    const size = info.size;
    const range = parseRange(req.headers.range, size);
    if (range?.invalid) {
      res.writeHead(416, { "content-range": `bytes */${size}`, "cache-control": "no-store" });
      res.end();
      return true;
    }

    let start = 0;
    let end = size - 1;
    const headers = {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"`,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    };
    if (range) {
      start = range.start;
      end = range.end;
      headers["content-range"] = `bytes ${start}-${end}/${size}`;
      res.writeHead(206, { ...headers, "content-length": String(end - start + 1) });
    } else {
      res.writeHead(200, { ...headers, "content-length": String(size) });
    }
    if (req.method === "HEAD" || size === 0) {
      res.end();
      return true;
    }

    const stream = createReadStream(file, { start, end });
    // 客户端中途断开（点取消）时 stream 会报错，丢掉连接即可，不要当成服务端错误打日志
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
    return true;
  };
}
