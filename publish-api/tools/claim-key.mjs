/*
  开通密钥生成器（命令行版）。随仓库发布，自己部署的人用它发密钥。

  密钥本身不带有效期：建班时服务器给这个班写死服务期（默认一年，见 LICENSE_DAYS）。

  在 publish-api 目录里跑（下面的路径都按脚本自身位置算，从仓库根跑也行）：
    node tools/claim-key.mjs                     # 发 1 个
    node tools/claim-key.mjs 5                   # 发 5 个
    node tools/claim-key.mjs --verify CB-XXXX-XXXX-XXXX-XXXX
    node tools/claim-key.mjs --secret <种子> ...  # 临时指定种子
    node tools/claim-key.mjs --init              # 生成种子（写仓库根的 deploy/claim-secret.txt）

  种子按顺序找：--secret > 环境变量 CLAIM_KEY_SECRET > deploy/claim-secret.txt
*/
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const SECRET_FILE = path.join(REPO, "deploy", "claim-secret.txt");

const { createClaimKey, verifyClaimKey } = await import(
  pathToFileURL(path.join(REPO, "publish-api", "claim.js")).href
);

function readSecretFile() {
  try {
    return fs.readFileSync(SECRET_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function resolveSecret(argv) {
  const i = argv.indexOf("--secret");
  if (i > -1 && argv[i + 1]) return argv[i + 1].trim();
  if (process.env.CLAIM_KEY_SECRET) return process.env.CLAIM_KEY_SECRET.trim();
  return readSecretFile();
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : undefined;
}


const argv = process.argv.slice(2);

if (argv[0] === "--init") {
  if (fs.existsSync(SECRET_FILE)) {
    console.error("已经有种子了：" + SECRET_FILE);
    console.error("换种子 = 已发出的开通密钥全部作废，真要换就先手动删掉它（并当作一次停服变更）。");
    process.exit(1);
  }
  const secret = randomBytes(24).toString("base64url");
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret + "\n", { encoding: "utf8", mode: 0o600 });
  console.log("新种子已写入 " + SECRET_FILE);
  console.log("服务器上要配的这一行（/etc/class-board.env）：");
  console.log("CLAIM_KEY_SECRET=" + secret);
  process.exit(0);
}

const secret = resolveSecret(argv);
if (!secret) {
  console.error("没有种子。先跑一次：node tools/claim-key.mjs --init");
  process.exit(1);
}

const verifyKey = argValue(argv, "--verify");
if (verifyKey) {
  const res = verifyClaimKey(verifyKey, secret);
  console.log(res.ok ? "有效（我们发的）" : "无效（" + res.reason + "）");
  process.exit(res.ok ? 0 : 2);
}

const count = Math.max(1, Math.min(200, Number(argv.find((a) => /^\d+$/.test(a)) || 1)));

for (let n = 0; n < count; n += 1) {
  console.log(createClaimKey(secret));
}
