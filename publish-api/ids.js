// ID 与短码的生成：都只用 crypto，不带额外依赖。
import { randomBytes, randomInt } from "node:crypto";

// 字符集去掉了 0/O/1/I/L，避免老师在家长会上念错配对码
const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// 8 位数字班级码：整串都是数字，班主任在家长会上好念、手机键盘也好输。
// 首位固定 1~9，避免出现 0 开头被表格软件吃掉前导零。
export function newClassCode() {
  let out = String(randomInt(1, 10));
  for (let i = 1; i < 8; i += 1) out += String(randomInt(0, 10));
  return out;
}

export function newId(prefix) {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function newToken() {
  return randomBytes(24).toString("base64url");
}

export function newShortCode(length = 6) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizeCode(input) {
  return String(input || "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
}
