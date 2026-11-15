// 仓储层：上层只认这里暴露的函数，SQL 与表结构全部藏在这个文件里。
// 只依赖 node:sqlite（Node 22.5+ 内置），没有 npm 依赖，也没有原生编译。
//
// 身份模型（2026-11-03 改版）：
//   班主任 owner      —— 8 位数字班级码 + 自设口令登录
//   任课老师 member   —— 6 位登录码登录，没有口令，登录码由班主任建/轮换
// 一台教室大屏是 devices 里的设备令牌，只读。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { newShortCode } from "./ids.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS classes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,   -- 8 位数字班级码
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER,                -- 建班时写死：这个班能用到哪天（默认一年）
  claim_uid   TEXT                    -- 开通密钥的票根：一钥一班，同一个 uid 只能建一个班
);
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,          -- owner 班主任 | member 任课老师
  subject     TEXT,                   -- member 只能改自己这一科的作业
  salt        TEXT,                   -- 只有班主任有口令，任课老师为 NULL
  hash        TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (class_id, name)
);
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_codes (
  code          TEXT PRIMARY KEY,     -- 6 位字母数字，任课老师长期登录码
  class_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER,              -- 轮换时旧码填时间戳，不再能登录
  last_used_at  INTEGER
);
CREATE TABLE IF NOT EXISTS pair_codes (
  code        TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
-- 老表 pair_codes 只留表结构，不再读写：v2 把配对方向反过来（大屏出码、老师手机扫码），
-- 旧流程的"老师发码、大屏输码"已删除。留着是为了老库升级时不用改历史数据。
CREATE TABLE IF NOT EXISTS pair_claims (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,          -- 6 位码，大屏右下角显示
  poll_token  TEXT,                   -- 防别人猜中码：token 只交付一次，交付后置 NULL
  name        TEXT,                   -- 大屏自报的名字，绑定时写进 devices.name
  class_id    TEXT,                   -- 绑定后才有值（绑之前不知道要进哪个班）
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  bound_at    INTEGER,                -- 老师扫码绑定的时刻
  device_id   TEXT                    -- 绑定出来的设备；解绑时连同这条一起删
);
CREATE INDEX IF NOT EXISTS idx_pair_claims_code ON pair_claims (code);
CREATE INDEX IF NOT EXISTS idx_pair_claims_device ON pair_claims (device_id);
CREATE INDEX IF NOT EXISTS idx_pair_claims_expires ON pair_claims (expires_at);
CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL,
  name        TEXT,
  token       TEXT NOT NULL UNIQUE,
  screen_code TEXT,                   -- 绑定后常驻右下角的屏码，同班内唯一
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);
CREATE TABLE IF NOT EXISTS snapshots (
  class_id    TEXT PRIMARY KEY,
  revision    INTEGER NOT NULL,
  state_json  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL
);
`;

/** 老库升级：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，这里补一次 */
function ensureColumn(db, table, column, type) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/**
 * 老库升级：v1 配对建立的设备没有屏幕码，这里补一个（班内唯一）。
 * 不补的话老师端"大屏管理"里这列是空的，只有重新配对才会生成。
 */
function backfillScreenCodes(db) {
  const rows = db.prepare("SELECT id, class_id FROM devices WHERE screen_code IS NULL OR screen_code = ''").all();
  if (!rows.length) return;
  const used = new Map();
  for (const row of db.prepare("SELECT class_id, screen_code FROM devices WHERE screen_code IS NOT NULL AND screen_code <> ''").all()) {
    if (!used.has(row.class_id)) used.set(row.class_id, new Set());
    used.get(row.class_id).add(row.screen_code);
  }
  const update = db.prepare("UPDATE devices SET screen_code = ? WHERE id = ?");
  for (const row of rows) {
    if (!used.has(row.class_id)) used.set(row.class_id, new Set());
    const taken = used.get(row.class_id);
    let code = newShortCode(6);
    while (taken.has(code)) code = newShortCode(6);
    taken.add(code);
    update.run(code, row.id);
  }
}

/**
 * 老库升级：一个班只留一块大屏。历史上同一班可能绑出过好几条 devices，
 * 这里按 created_at 保留最新的一条，其余连同它们的 pair_claims 关联一起删掉，
 * 之后才能建 devices(class_id) 唯一索引。已经干净的库跑一遍是空操作。
 */
function dedupeDevices(db) {
  const extras = db
    .prepare(
      `SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY class_id ORDER BY created_at DESC, id DESC
         ) AS n FROM devices
       ) WHERE n > 1`,
    )
    .all();
  if (!extras.length) return 0;
  const dropClaim = db.prepare("DELETE FROM pair_claims WHERE device_id = ?");
  const dropDevice = db.prepare("DELETE FROM devices WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const row of extras) {
      dropClaim.run(row.id);
      dropDevice.run(row.id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return extras.length;
}

export function openStore(dbPath) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  ensureColumn(db, "classes", "expires_at", "INTEGER");
  // 一钥一班：老库补 claim_uid 列 + 部分唯一索引（NULL 的老班级不参与唯一约束，启动幂等）
  ensureColumn(db, "classes", "claim_uid", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS classes_claim_uid ON classes (claim_uid) WHERE claim_uid IS NOT NULL;");
  ensureColumn(db, "devices", "screen_code", "TEXT");
  backfillScreenCodes(db);
  // 一班一屏：先去掉老库里同班的重复设备，再上唯一索引（顺序不能反，否则老库建索引会失败）
  dedupeDevices(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS devices_class_unique ON devices (class_id);");

  const stmt = (sql) => db.prepare(sql);

  const classes = {
    byId: (id) => stmt("SELECT * FROM classes WHERE id = ?").get(id) || null,
    byCode: (code) => stmt("SELECT * FROM classes WHERE code = ?").get(code) || null,
    byClaimUid: (uid) => (uid ? stmt("SELECT * FROM classes WHERE claim_uid = ?").get(uid) || null : null),
    create: ({ id, name, code, createdAt, expiresAt, claimUid }) =>
      stmt("INSERT INTO classes (id, name, code, created_at, expires_at, claim_uid) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, name, code, createdAt, expiresAt ?? null, claimUid ?? null),
    rename: (id, name) => stmt("UPDATE classes SET name = ? WHERE id = ?").run(name, id),
    // 升级老库时回填"票根"：只写 claim_uid，别的字段一律不碰
    setClaimUid: (id, claimUid) => stmt("UPDATE classes SET claim_uid = ? WHERE id = ?").run(claimUid, id),
    // 给"没有到期日"的老班级补一个：建班时间 + span；早就过期的按 now + grace 顺延
    backfillExpiry: ({ now, span, grace }) =>
      stmt(
        `UPDATE classes
            SET expires_at = CASE
              WHEN COALESCE(created_at, 0) + ? > ? THEN COALESCE(created_at, 0) + ?
              ELSE ? + ?
            END
          WHERE expires_at IS NULL`,
      ).run(span, now, span, now, grace),
    setExpiry: (id, expiresAt) => stmt("UPDATE classes SET expires_at = ? WHERE id = ?").run(expiresAt, id),
  };

  const users = {
    byId: (id) => stmt("SELECT * FROM users WHERE id = ?").get(id) || null,
    byClassAndName: (classId, name) =>
      stmt("SELECT * FROM users WHERE class_id = ? AND name = ?").get(classId, name) || null,
    ownerOf: (classId) => stmt("SELECT * FROM users WHERE class_id = ? AND role = 'owner'").get(classId) || null,
    // 带上 created_at：分享页要按"谁先建谁在前"排，不能只靠名字（换浏览器就乱）
    listByClass: (classId) =>
      stmt(
        `SELECT u.id, u.name, u.role, u.subject, u.created_at, c.code AS login_code, c.last_used_at
           FROM users u
           LEFT JOIN login_codes c ON c.user_id = u.id AND c.revoked_at IS NULL
          WHERE u.class_id = ?
          ORDER BY u.role, u.created_at, u.name`,
      ).all(classId),
    create: ({ id, classId, name, role, subject, salt, hash, createdAt }) =>
      stmt(
        `INSERT INTO users (id, class_id, name, role, subject, salt, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, classId, name, role, subject ?? null, salt ?? null, hash ?? null, createdAt),
  };

  const sessions = {
    create: ({ token, userId, expiresAt }) =>
      stmt("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt),
    userByToken: (token, now) =>
      stmt(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`,
      ).get(token, now) || null,
    purgeExpired: (now) => stmt("DELETE FROM sessions WHERE expires_at <= ?").run(now),
  };

  const loginCodes = {
    byCode: (code) => stmt("SELECT * FROM login_codes WHERE code = ?").get(code) || null,
    activeByUser: (userId) =>
      stmt("SELECT * FROM login_codes WHERE user_id = ? AND revoked_at IS NULL").get(userId) || null,
    create: ({ code, classId, userId, createdAt }) =>
      stmt("INSERT INTO login_codes (code, class_id, user_id, created_at) VALUES (?, ?, ?, ?)")
        .run(code, classId, userId, createdAt),
    // 轮换：旧码打上撤销时间，历史留痕（谁什么时候换过码还能查）
    revokeByUser: (userId, at) =>
      stmt("UPDATE login_codes SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(at, userId),
    touch: (code, at) => stmt("UPDATE login_codes SET last_used_at = ? WHERE code = ?").run(at, code),
  };

  // 配对认领：大屏 POST /devices/claim 领一个码 → 老师手机扫码 POST /devices/bind →
  // 大屏轮询 GET /devices/claim 拿设备 token。poll_token 是这块屏的凭据，别处拿不到。
  const pairClaims = {
    create: ({ id, code, pollToken, name, createdAt, expiresAt }) =>
      stmt(
        `INSERT INTO pair_claims (id, code, poll_token, name, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, code, pollToken, name ?? null, createdAt, expiresAt),
    byId: (id) => stmt("SELECT * FROM pair_claims WHERE id = ?").get(id) || null,
    // 还没绑定、还没过期的码才算"可用"；同一个码可能历史上出现过，取最新的一条
    pendingByCode: (code, now) =>
      stmt(
        `SELECT * FROM pair_claims
          WHERE code = ? AND bound_at IS NULL AND expires_at > ?
          ORDER BY created_at DESC LIMIT 1`,
      ).get(code, now) || null,
    latestByCode: (code) =>
      stmt("SELECT * FROM pair_claims WHERE code = ? ORDER BY created_at DESC LIMIT 1").get(code) || null,
    byCodeAndClass: (code, classId) =>
      stmt("SELECT * FROM pair_claims WHERE code = ? AND class_id = ?").get(code, classId) || null,
    countPending: (now) =>
      stmt("SELECT COUNT(*) AS n FROM pair_claims WHERE bound_at IS NULL AND expires_at > ?").get(now).n,
    bind: ({ id, deviceId, classId, boundAt }) =>
      stmt("UPDATE pair_claims SET device_id = ?, class_id = ?, bound_at = ? WHERE id = ?")
        .run(deviceId, classId, boundAt, id),
    // token 只交付一次：取走之后把 poll_token 抹掉，再轮询就只剩 { status: "used" }
    markDelivered: (id) => stmt("UPDATE pair_claims SET poll_token = NULL WHERE id = ?").run(id),
    removeByDevice: (deviceId) => stmt("DELETE FROM pair_claims WHERE device_id = ?").run(deviceId),
    purgeExpired: (now) =>
      stmt("DELETE FROM pair_claims WHERE expires_at <= ? AND bound_at IS NULL").run(now),
  };

  const devices = {
    byToken: (token) => stmt("SELECT * FROM devices WHERE token = ?").get(token) || null,
    byId: (id) => stmt("SELECT * FROM devices WHERE id = ?").get(id) || null,
    // 一班一屏：正常只会有一条，老库去重前后都取 created_at 最新那条
    byClass: (classId) =>
      stmt("SELECT * FROM devices WHERE class_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").get(classId) || null,
    byScreenCode: (classId, screenCode) =>
      stmt("SELECT * FROM devices WHERE class_id = ? AND screen_code = ?").get(classId, screenCode) || null,
    // 给 /api/v1/me 用：老师端只认 camelCase（screenCode 是认屏的关键）
    listByClass: (classId) =>
      stmt(
        `SELECT id, name, screen_code AS screenCode, created_at AS createdAt, last_seen AS lastSeen
           FROM devices WHERE class_id = ? ORDER BY created_at`,
      ).all(classId),
    create: ({ id, classId, name, token, screenCode, createdAt }) =>
      stmt(
        "INSERT INTO devices (id, class_id, name, token, screen_code, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, classId, name ?? null, token, screenCode ?? null, createdAt),
    touch: (id, at) => stmt("UPDATE devices SET last_seen = ? WHERE id = ?").run(at, id),
    remove: (id) => stmt("DELETE FROM devices WHERE id = ?").run(id),
  };

  const snapshots = {
    get: (classId) => {
      const row = stmt("SELECT * FROM snapshots WHERE class_id = ?").get(classId);
      if (!row) return null;
      return { revision: row.revision, state: JSON.parse(row.state_json), updatedAt: row.updated_at, updatedBy: row.updated_by };
    },
    // 全部快照：只给启动时的 v1→v2 升级用，不进请求路径
    // 单条 JSON 坏掉不该让服务起不来：解析失败给 null，升级那步会跳过它并打日志
    all: () =>
      stmt("SELECT * FROM snapshots")
        .all()
        .map((row) => {
          let state = null;
          try {
            state = JSON.parse(row.state_json);
          } catch {
            state = null;
          }
          return {
            classId: row.class_id,
            revision: row.revision,
            state,
            updatedAt: row.updated_at,
            updatedBy: row.updated_by,
          };
        }),
    put: ({ classId, revision, state, updatedAt, updatedBy }) =>
      stmt(
        `INSERT INTO snapshots (class_id, revision, state_json, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (class_id) DO UPDATE SET
           revision = excluded.revision,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      ).run(classId, revision, JSON.stringify(state), updatedAt, updatedBy),
  };

  return { classes, users, sessions, loginCodes, pairClaims, devices, snapshots, close: () => db.close() };
}
