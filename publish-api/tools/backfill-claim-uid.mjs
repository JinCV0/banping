/*
  给老库回填"票根"：把每一把已经发出去的开通密钥与它建的班对上（一钥一班）。

  为什么需要：claim_uid 是后来才加的能力。升级前建的班 claim_uid 是 NULL，
  那些密钥在升级后还能再建一次班，之后才被锁住。想彻底堵住，就得把
  "哪个班是哪把密钥建的" 清单回填进去。服务端不存明文密钥，所以清单得你提供。

  用法（在 publish-api 目录下执行）：

    node tools/backfill-claim-uid.mjs --db data/publish.db --list uid-list.txt
    node tools/backfill-claim-uid.mjs --db data/publish.db --list uid-list.txt --dry-run

  清单格式（txt，UTF-8）：每行「班级码,开通密钥」，逗号分隔。
  # 开头是注释，空行忽略；班级码里的空格/连字符会被忽略，密钥大小写不敏感。

    # 2026 届
    12345678,CB-A1B2-C3D4-E5F6-G7H8
    87654321,CB-1234-5678-9ABC-DEFG

  种子（三选一，优先 --secret）：
    --secret <种子>
    环境变量 CLAIM_KEY_SECRET
    --secret-file <文件>（一行种子；不给就用环境变量 CLAIM_KEY_SECRET）

  --dry-run：只算不写，适合先看一遍会改什么。
  退出码：有失败（找不到班 / 密钥格式不对 / uid 冲突）就返回 1，跳过的不算失败。
*/
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "../store.js";
import { claimUidOf } from "../claim.js";
import { normalizeCode } from "../ids.js";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(name);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readSecret() {
  const fromArg = arg("--secret", "");
  if (fromArg) return fromArg.trim();
  if (process.env.CLAIM_KEY_SECRET) return process.env.CLAIM_KEY_SECRET.trim();
  const file = arg("--secret-file", "");
  if (file) {
    try {
      const text = readFileSync(file, "utf8").trim();
      if (text) return text;
    } catch {
      // 落下去走下面的报错
    }
  }
  return "";
}

/** 解析清单：返回 { line, code, key } 数组，注释与空行跳过 */
function parseList(text) {
  const rows = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const at = line.indexOf(",");
    if (at < 0) {
      rows.push({ line: index + 1, code: line, key: "", bad: "缺少逗号（格式：班级码,开通密钥）" });
      return;
    }
    rows.push({ line: index + 1, code: line.slice(0, at).trim(), key: line.slice(at + 1).trim() });
  });
  return rows;
}

const dbPath = arg("--db", "");
const listPath = arg("--list", "");
if (!dbPath) fail("缺 --db <路径>（例：--db data/publish.db）");
if (!listPath) fail("缺 --list <清单文件>（每行：班级码,开通密钥）");

const secret = readSecret();
if (!secret) {
  fail("没拿到种子：用 --secret <种子>、--secret-file <文件>，或设环境变量 CLAIM_KEY_SECRET");
}

let listText;
try {
  listText = readFileSync(listPath, "utf8");
} catch (err) {
  fail(`读不了清单 ${listPath}：${err.message}`);
}

const rows = parseList(listText);
if (!rows.length) fail(`清单里没有有效行：${listPath}`);

const dryRun = flag("--dry-run");
const store = openStore(resolve(dbPath));

const stats = { ok: 0, skip: 0, fail: 0 };
const failures = [];

for (const row of rows) {
  const where = `第 ${row.line} 行`;
  if (row.bad) {
    stats.fail += 1;
    failures.push(`${where}：${row.bad}`);
    continue;
  }
  const code = normalizeCode(row.code);
  const klass = store.classes.byCode(code);
  if (!klass) {
    stats.fail += 1;
    failures.push(`${where}：没有这个班（班级码 ${row.code}）`);
    continue;
  }
  const uid = claimUidOf(row.key, secret);
  if (!uid) {
    stats.fail += 1;
    failures.push(`${where}：密钥格式不对（${row.key}）`);
    continue;
  }
  if (klass.claim_uid) {
    if (klass.claim_uid === uid) {
      stats.skip += 1;
      console.log(`· ${code} 已经回填过（${uid}），跳过`);
    } else {
      stats.fail += 1;
      failures.push(`${where}：班级 ${code} 已有别的 claim_uid（${klass.claim_uid}），不覆盖`);
    }
    continue;
  }
  const taken = store.classes.byClaimUid(uid);
  if (taken && taken.id !== klass.id) {
    stats.fail += 1;
    failures.push(`${where}：这把密钥已经占给了班级 ${taken.code}（${uid}）`);
    continue;
  }
  if (!dryRun) store.classes.setClaimUid(klass.id, uid);
  stats.ok += 1;
  console.log(`${dryRun ? "（dry-run）将回填" : "✓ 回填"} ${code} → ${uid}`);
}

store.close();

console.log(`\n成功 ${stats.ok} 条 / 跳过 ${stats.skip} 条 / 失败 ${stats.fail} 条${dryRun ? "（dry-run，未写库）" : ""}`);
if (failures.length) {
  console.error("\n失败明细：");
  for (const item of failures) console.error("  ✗ " + item);
  process.exit(1);
}
