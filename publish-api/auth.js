// 账号与会话：口令用 scrypt 加盐存哈希，会话就是一张 token 表。
// 这里不碰业务，只回答两件事：这人是谁、这设备属于哪个班。
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { newToken } from "./ids.js";

const KEY_LEN = 32;

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, KEY_LEN).toString("hex") };
}

export function verifyPassword(password, salt, hash) {
  const candidate = scryptSync(password, salt, KEY_LEN);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function issueSession(store, userId, ttlMs, now = Date.now()) {
  const token = newToken();
  store.sessions.create({ token, userId, expiresAt: now + ttlMs });
  return token;
}

export function bearerToken(req) {
  const raw = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : null;
}

// 老师（含班主任/任课老师）与设备是两套身份，别混用：
// - 老师 token 存在 sessions 表，能读能写
// - 设备 token 存在 devices 表，只读，用来拉当前看板
export function resolvePrincipal(store, req, now = Date.now()) {
  const token = bearerToken(req);
  if (!token) return null;
  const device = store.devices.byToken(token);
  if (device) return { kind: "device", device };
  const user = store.sessions.userByToken(token, now);
  if (user) return { kind: "user", user };
  return null;
}

export function roleOf(user) {
  return user.role === "owner" ? "owner" : "member";
}

export function canWriteBoard(user) {
  return Boolean(user) && (user.role === "owner" || Boolean(user.subject));
}
