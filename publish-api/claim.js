/*
  开通密钥的"规律核对器"：服务器只存一串种子，不存任何发出去的密钥。

  一个密钥 = CB-XXXX-XXXX-XXXX-XXXX（16 位），背后的 10 个字节是：

      0-4   随机数   （5 字节，每把都不一样）
      5-9   签名     （HMAC-SHA256(种子, 域名 + 前 5 字节) 的前 5 字节）

  密钥本身**不带时间**：有效期是"这个班级"的属性，建班时由服务器写进
  classes.expires_at（默认一年）。这样同一把密钥今天用还是明年用，
  建出来的班级都是满一年；密钥也不会因为放着没用而过期。

  字符集用 Crockford base32：去掉了 I / L / O / U，抄写时不会看错。

  "一钥一班"：claimUidOf() 把密钥算成一个稳定的班级 UID（票根），建班时写进
  classes.claim_uid，同一把密钥再来建班就会被 403 挡住。uid 用独立域分隔的
  HMAC，和验签互不相干。
*/
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PREFIX = "CB";

const BYTES = 10;
const MAC_BYTES = 5;
const MAC_START = 5;
const CHARS = (BYTES * 8) / 5; // 16
const DOMAIN = "class-board/claim/v3:";

export function encodeBase32(bytes, length) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (out.length < length && bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.padEnd(length, ALPHABET[0]);
}

export function decodeBase32(text) {
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const ch of text) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return bytes;
}

function macFor(secret, head) {
  return createHmac("sha256", secret).update(DOMAIN).update(head).digest().subarray(0, MAC_BYTES);
}

function formatBody(body) {
  const chars = encodeBase32(body, CHARS);
  return PREFIX + "-" + (chars.match(/.{4}/g) || []).join("-");
}

/** 发一个密钥（不带时间，有效期跟着班级走） */
export function createClaimKey(secret) {
  if (!secret) throw new Error("没有种子，发不了密钥");
  const head = randomBytes(MAC_START);
  return formatBody(Buffer.concat([head, macFor(secret, head)]));
}

/** 把用户输入整理成 10 个字节；格式不对返回 null */
export function normalizeClaimKey(input) {
  const raw = String(input || "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  if (!raw.startsWith(PREFIX)) return null;
  const body = raw.slice(PREFIX.length);
  if (body.length !== CHARS) return null;
  const bytes = decodeBase32(body);
  return bytes && bytes.length === BYTES ? Buffer.from(bytes) : null;
}

/**
 * 校验密钥。返回：
 *   { ok: true }                     真我们发的
 *   { ok: false, reason: "unset" }   服务器没配种子
 *   { ok: false, reason: "format" }  格式不对
 *   { ok: false, reason: "signature" } 签名不对（自己编的/抄错一位）
 */
export function verifyClaimKey(input, secret) {
  if (!secret) return { ok: false, reason: "unset" };
  const body = normalizeClaimKey(input);
  if (!body) return { ok: false, reason: "format" };
  const head = body.subarray(0, MAC_START);
  const mac = body.subarray(MAC_START);
  const expected = macFor(secret, head);
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return { ok: false, reason: "signature" };
  return { ok: true };
}

/*
  "一钥一班"：把一把密钥映射成班级 UID。

  密钥 = 票，UID = 票根。同一把密钥永远算出同一个 uid（与验签同源，
  都用 normalizeClaimKey 规范化过的 10 字节），所以二次建班能被认出来；
  改一位密钥，uid 完全不同（HMAC 雪崩）。

  域分隔 "claim-uid:" 让它和验签用的 DOMAIN 互不相干：
  知道 uid 推不出签名，知道签名也推不出 uid。
*/
const UID_DOMAIN = "claim-uid:";
const UID_BYTES = 9; // 72 位
const UID_CHARS = 15; // 75 位，够放 9 字节

/** 密钥 → 稳定的班级 UID；密钥格式不对返回 null */
export function claimUidOf(input, secret) {
  if (!secret) return null;
  const body = normalizeClaimKey(input);
  if (!body) return null;
  const digest = createHmac("sha256", secret).update(UID_DOMAIN).update(body).digest().subarray(0, UID_BYTES);
  return "uid_" + encodeBase32(digest, UID_CHARS);
}
