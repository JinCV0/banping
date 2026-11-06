// 不停服备份：SQLite 的 VACUUM INTO 会生成一个自洽的单文件副本，绕开"复制 WAL 中的库"这个坑。
// 用法：node tools/backup.mjs [源库] [输出文件]
// 例：node tools/backup.mjs data/publish.db backups/publish-2026-11-03.db
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const src = process.argv[2] || "data/publish.db";
const stamp = new Date().toISOString().slice(0, 10);
const out = process.argv[3] || path.join("backups", `publish-${stamp}.db`);

if (!fs.existsSync(src)) {
  console.error(`源库不存在：${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
if (fs.existsSync(out)) {
  console.error(`输出文件已存在，先删掉或换个名字：${out}`);
  process.exit(1);
}

const db = new DatabaseSync(src);
try {
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const size = fs.statSync(out).size;
console.log(`备份完成：${src} → ${out}（${size} 字节）`);
