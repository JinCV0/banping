// 开通密钥的小工具：生成种子、发密钥。
//
//   node tools/claim-key.mjs --init              生成一串新种子（服务器只存这个）
//   node tools/claim-key.mjs --key               用环境变量里的种子发一把密钥
//   node tools/claim-key.mjs --key --secret 种子  用指定种子发一把密钥
//
// 为什么要分成"种子"和"密钥"两块：服务器上只存种子（一串随机字符），
// 发给学校的开通密钥由种子和你自己的签名算出来，服务器不存已发出的密钥，
// 所以数据库泄露也拿不到能用的密钥；密钥本身不带时间，有效期跟着班级走。
//
// 一把密钥建一个班（"一钥一班"）：同一把密钥第二次建班会 403。

import { randomBytes } from "node:crypto";
import { createClaimKey, verifyClaimKey, claimUidOf } from "../claim.js";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SECRET_BYTES = 32;

/** 32 字节随机数转成 52 个字符的 base32（去掉 I/L/O/U 那套字母表） */
function newSecret() {
  const bytes = randomBytes(SECRET_BYTES);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

async function init() {
  const secret = newSecret();
  console.log("新的种子（服务器环境变量 CLAIM_KEY_SECRET 用这串）：\n");
  console.log("  " + secret + "\n");
  console.log("把它存到安全的地方（密码管理器 / 只读的部署文件）。丢了不影响已经建好的班，");
  console.log("但没法再发新的开通密钥；泄露了等于谁都能发密钥，要换就得重建服务端。");
  if (has("--write")) {
    const path = valueOf("--write");
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, secret + "\n", "utf8");
      console.log(`\n已写入 ${path}（记得把它加进 .gitignore）`);
    }
  }
}

function issue(secret) {
  if (!secret) {
    console.error("没有种子：先跑 --init 生成，再用 CLAIM_KEY_SECRET=... 或 --secret 传进来。");
    process.exit(1);
  }
  const key = createClaimKey(secret);
  const check = verifyClaimKey(key, secret);
  if (!check.ok) {
    console.error("自己发的密钥居然验不过：" + check.reason);
    process.exit(1);
  }
  console.log("新的开通密钥（发给学校，用来建一个班）：\n");
  console.log("  " + key + "\n");
  console.log("对应的班级 UID：" + claimUidOf(key, secret) + "（同一把密钥只能建一个班）");
}

if (has("--init")) {
  await init();
} else if (has("--key")) {
  issue((valueOf("--secret") ?? process.env.CLAIM_KEY_SECRET ?? "").trim());
} else {
  console.log(`
用法：
  node tools/claim-key.mjs --init [--write <路径>]   生成新种子
  node tools/claim-key.mjs --key --secret <种子>     用指定种子发一把密钥
  node tools/claim-key.mjs --key                     用 CLAIM_KEY_SECRET 环境变量发密钥
`);
}
