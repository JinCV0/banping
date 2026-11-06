// 给已经升到 v3 的老班补上"倒计时 / 寄语"两块磁贴（迁移脚本只处理 version<3）
// 用法：node tools/add-tiles.mjs <班级码> <班主任密码>
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BOARD_BASE ?? "http://127.0.0.1:8787";
const [classCode, password] = process.argv.slice(2);
if (!classCode || !password) {
  console.error("用法：node tools/add-tiles.mjs <班级码> <班主任密码>");
  process.exit(1);
}

const call = async (path, { method = "GET", body, token } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
};

const login = await call("/api/v1/auth/login", { method: "POST", body: { classCode, password } });
if (login.status !== 200) throw new Error("登录失败：" + JSON.stringify(login.data).slice(0, 200));
const token = login.data.token;

const got = await call("/api/v1/board/state", { token });
if (got.status !== 200) throw new Error("取状态失败：" + JSON.stringify(got.data).slice(0, 200));
const state = got.data.state;
const revision = got.data.revision;

const tiles = state.layout?.tiles ?? [];
const have = new Set(tiles.map((tile) => tile.block));
const add = [];
if (!have.has("countdown") && state.countdown?.date) {
  add.push({ id: "cd", block: "countdown", x: 1, y: 7, w: 3, h: 2 });
}
if (!have.has("quote") && (state.quote?.text || state.today?.quote?.text)) {
  add.push({ id: "qt", block: "quote", x: 4, y: 7, w: 4, h: 2 });
}
if (!add.length) {
  console.log("不用补：已经有 countdown / quote 磁贴（或没有数据）");
  process.exit(0);
}

const next = { ...state, layout: { ...state.layout, tiles: [...tiles, ...add] } };
const put = await call("/api/v1/board/state", { method: "PUT", token, body: { state: next, ifRevision: revision } });
console.log("PUT", put.status, JSON.stringify(put.data).slice(0, 160));
if (put.status === 200) {
  console.log("tiles:", next.layout.tiles.map((tile) => `${tile.block}@${tile.x},${tile.y} ${tile.w}x${tile.h}`).join(" | "));
}
