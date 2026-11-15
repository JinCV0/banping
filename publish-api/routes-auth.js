// 账号相关接口：建班、班主任登录、任课老师登录、看我是谁。
// 身份模型见 store.js 顶部注释；这里只做三件事：校验、找对的人、发会话。
import { badRequest, claimTaken, conflict, forbidden, notFound, unauthorized, assert } from "./errors.js";
import { hashPassword, verifyPassword, issueSession } from "./auth.js";
import { newClassCode, newId, normalizeCode } from "./ids.js";
import { verifyClaimKey, claimUidOf } from "./claim.js";
import { sampleState } from "./presets.js";

const CLASS_CODE_TRIES = 12;

const DAY_MS = 86_400_000;

// 服务端本地日期（YYYY-MM-DD），示例内容用它当'今天'
function dateKeyOf(ms) {
  const d = new Date(ms);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** 这个班还能用到哪天 —— 建班时写死，不看密钥、不看谁在登录 */
export function licenseOf(klass, now) {
  const expiresAt = klass?.expires_at ?? null;
  if (!expiresAt) return { expiresAt: null, daysLeft: null, expired: false };
  return {
    expiresAt: new Date(expiresAt).toISOString(),
    daysLeft: Math.ceil((expiresAt - now) / DAY_MS),
    expired: expiresAt <= now,
  };
}

export function publicUser(user, klass, now) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    subject: user.subject ?? null,
    class: {
      id: klass.id,
      name: klass.name,
      // 班级码对所有成员可见：任课老师登录时本来就要输它
      code: klass.code,
    },
    license: licenseOf(klass, now),
  };
}

/** 任课老师对外形状：created_at（毫秒）→ createdAt（ISO）。分享页按建号先后排就靠它 */
function publicTeacher(row) {
  const at = row?.created_at ? new Date(row.created_at) : null;
  return {
    ...row,
    createdAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
  };
}

function requireFields(body, fields) {
  for (const field of fields) {
    assert(typeof body[field] === "string" && body[field].trim(), badRequest(`缺少字段 ${field}`));
  }
}

function requirePassword(password) {
  assert(typeof password === "string" && password.length >= 6, badRequest("密码至少 6 位"));
}

// 班级码是 8 位数字，输入框里带空格/连字符也认
export function normalizeClassCode(input) {
  return String(input || "").replace(/\D/g, "");
}

function uniqueClassCode(store) {
  for (let i = 0; i < CLASS_CODE_TRIES; i += 1) {
    const code = newClassCode();
    if (!store.classes.byCode(code)) return code;
  }
  throw conflict("CODE_EXHAUSTED", "班级码生成失败，请重试");
}

function claimKeyMessage(reason) {
  if (reason === "format") return "开通密钥格式不对，应该是 CB-XXXX-XXXX-XXXX-XXXX";
  return "开通密钥无效";
}

export function authRoutes({ config }) {
  return [
    {
      method: "POST",
      path: "/api/v1/class/claim",
      auth: "none",
      // 只有拿到我们发的开通密钥的人能建班；密钥用"规律核对"验，服务器不存任何密钥
      handler: async ({ body, store, sendJson, res }) => {
        assert(
          config.claimKeySecret,
          forbidden("服务端没有配置开通密钥的种子（CLAIM_KEY_SECRET），暂时不能新建班级")
        );
        requireFields(body, ["className", "ownerName", "password", "claimKey"]);
        const check = verifyClaimKey(body.claimKey, config.claimKeySecret);
        assert(check.ok, forbidden(claimKeyMessage(check.reason)));
        requirePassword(body.password);

        // 一钥一班：密钥是票，票根（uid）只能换一个班。二次使用直接告诉他班级码。
        const claimUid = claimUidOf(body.claimKey, config.claimKeySecret);
        const existing = store.classes.byClaimUid(claimUid);
        assert(
          !existing,
          claimTaken(`这把密钥已经建过班级（班级码 ${existing?.code}），请用班级码登录`, {
            classCode: existing?.code,
          })
        );

        const now = config.now();
        const classId = newId("cls");
        const code = uniqueClassCode(store);
        // 有效期绑在班级上：建班这一刻起算（密钥本身不带日期，放多久都还能用）
        const expiresAt = now + config.licenseDays * DAY_MS;
        store.classes.create({
          id: classId,
          name: body.className.trim().slice(0, 20),
          code,
          createdAt: now,
          expiresAt,
          claimUid,
        });

        const { salt, hash } = hashPassword(body.password);
        const userId = newId("usr");
        store.users.create({
          id: userId,
          classId,
          name: body.ownerName.trim().slice(0, 12),
          role: "owner",
          subject: null,
          salt,
          hash,
          createdAt: now,
        });

        const token = issueSession(store, userId, config.sessionTtlMs, now);
        const user = store.users.byId(userId);
        const klass = store.classes.byId(classId);

        // 建班就把预置内容写成第一版快照：老师登录后大屏不是空的（示例，不是模板）
        store.snapshots.put({
          classId,
          revision: 1,
          state: sampleState(klass.name, dateKeyOf(now)),
          updatedAt: now,
          updatedBy: userId,
        });

        return sendJson(res, 201, { token, user: publicUser(user, klass, now) });
      },
    },

    {
      method: "POST",
      path: "/api/v1/auth/login",
      auth: "none",
      // 班主任：班级码 + 密码
      handler: async ({ body, store, sendJson, res }) => {
        requireFields(body, ["classCode", "password"]);
        const klass = store.classes.byCode(normalizeClassCode(body.classCode));
        assert(klass, notFound("班级码不对"));
        const owner = store.users.ownerOf(klass.id);
        assert(owner && verifyPassword(body.password, owner.salt, owner.hash), unauthorized("密码不对"));
        const token = issueSession(store, owner.id, config.sessionTtlMs, config.now());
        return sendJson(res, 200, { token, user: publicUser(owner, klass, config.now()) });
      },
    },

    {
      method: "POST",
      path: "/api/v1/auth/teacher-login",
      auth: "none",
      // 任课老师：班级码 + 班主任给的 6 位登录码（长期有效，可重复登录）
      handler: async ({ body, store, sendJson, res }) => {
        requireFields(body, ["classCode", "loginCode"]);
        const klass = store.classes.byCode(normalizeClassCode(body.classCode));
        assert(klass, notFound("班级码不对"));
        const record = store.loginCodes.byCode(normalizeCode(body.loginCode));
        assert(record && record.class_id === klass.id, unauthorized("登录码不对"));
        assert(!record.revoked_at, unauthorized("这个登录码已经被换掉了，请找班主任要新的"));
        const user = store.users.byId(record.user_id);
        assert(user, unauthorized("登录码对应的老师已不在班里"));
        const now = config.now();
        store.loginCodes.touch(record.code, now);
        const token = issueSession(store, user.id, config.sessionTtlMs, now);
        return sendJson(res, 200, { token, user: publicUser(user, klass, now) });
      },
    },

    {
      method: "POST",
      path: "/api/v1/class/rename",
      auth: "user",
      // 只有班主任能改班级名。班名只存在 classes 里，发布数据里的 class.name 由服务端盖，
      // 所以改完不用重新发布：下一次拉看板就是新名字。
      handler: async ({ body, user, store, sendJson, res }) => {
        assert(user.role === "owner", forbidden("只有班主任能改班级名"));
        const name = String(body?.name ?? "").replace(/\s+/g, " ").trim();
        assert(name.length >= 1 && name.length <= 20, badRequest("班级名 1-20 个字"));
        store.classes.rename(user.class_id, name);
        const klass = store.classes.byId(user.class_id);
        return sendJson(res, 200, { user: publicUser(store.users.byId(user.id), klass, config.now()) });
      },
    },

    {
      method: "GET",
      path: "/api/v1/me",
      auth: "user",
      handler: async ({ user, store, sendJson, res }) => {
        const klass = store.classes.byId(user.class_id);
        const teachers = store.users.listByClass(user.class_id);
        const now = config.now();
        // 班主任要能看见每位老师的登录码才好发出去；任课老师只看自己。
        // 班主任自己不在这个列表里（那是"我"，不是"我发的码"）。
        const visible =
          user.role === "owner"
            ? teachers.filter((item) => item.role === "member")
            : teachers.filter((item) => item.id === user.id).map((item) => ({ ...item, login_code: null }));
        return sendJson(res, 200, {
          user: publicUser(user, klass, now),
          license: licenseOf(klass, now),
          teachers: visible.map(publicTeacher),
          devices: store.devices.listByClass(user.class_id),
        });
      },
    },
  ];
}
