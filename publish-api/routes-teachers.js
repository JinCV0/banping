// 任课老师与登录码：班主任建一位老师 = 发一个 6 位登录码给他。
// 登录码长期有效、可重复登录；丢了或换人时在这里轮换，旧码立刻作废（留 revoke 时间戳）。
import { badRequest, conflict, forbidden, notFound, assert } from "./errors.js";
import { newId, newShortCode, normalizeCode } from "./ids.js";

const CODE_TRIES = 12;

function uniqueLoginCode(store) {
  for (let i = 0; i < CODE_TRIES; i += 1) {
    const code = newShortCode(6);
    if (!store.loginCodes.byCode(code)) return code;
  }
  throw conflict("CODE_EXHAUSTED", "登录码生成失败，请重试");
}

function teacherView(user) {
  const code = user.login_code ?? null;
  return {
    id: user.id,
    name: user.name,
    subject: user.subject ?? null,
    loginCode: code,
    lastUsedAt: user.last_used_at ?? null,
  };
}

export function teacherRoutes({ config }) {
  return [
    {
      method: "POST",
      path: "/api/v1/teachers",
      auth: "user",
      // 班主任给一位任课老师开登录码：姓名 + 科目（科目决定他能改哪一科）
      handler: async ({ body, user, store, sendJson, res }) => {
        assert(user.role === "owner", forbidden("只有班主任能添加任课老师"));
        const name = String(body?.name || "").trim().slice(0, 12);
        // 科目既可以填中文名（≤6 字）也可以填科目表里的 id，v2 的 id 最长 16 位
        // （^[a-z][a-z0-9_-]{0,15}$），所以这里按 16 截，别把 "chinese" 截成 "chines"。
        const subject = String(body?.subject || "").trim().slice(0, 16);
        assert(name, badRequest("缺少字段 name"));
        assert(subject, badRequest("缺少字段 subject"));

        const now = config.now();
        let record = store.users.byClassAndName(user.class_id, name);
        if (record) {
          // 同名老师已经存在：不新建账号，只把科目更新成这次填的，并轮换登录码
          assert(record.role === "member", conflict("NAME_TAKEN", "这个姓名已经是班主任了"));
          store.loginCodes.revokeByUser(record.id, now);
        } else {
          const id = newId("usr");
          store.users.create({
            id,
            classId: user.class_id,
            name,
            role: "member",
            subject,
            salt: null,
            hash: null,
            createdAt: now,
          });
          record = store.users.byId(id);
        }

        const code = uniqueLoginCode(store);
        store.loginCodes.create({ code, classId: user.class_id, userId: record.id, createdAt: now });
        const fresh = store.users.listByClass(user.class_id).find((item) => item.id === record.id);
        return sendJson(res, 201, { teacher: teacherView(fresh) });
      },
    },

    {
      method: "POST",
      path: "/api/v1/teachers/code",
      auth: "user",
      // 换码：旧码作废，给同一个老师发新码（手机丢了、码外传了都走这条）
      handler: async ({ body, user, store, sendJson, res }) => {
        assert(user.role === "owner", forbidden("只有班主任能换登录码"));
        const target = store.users.byId(normalizeId(body?.userId));
        assert(target && target.class_id === user.class_id, notFound("没有这位老师"));
        assert(target.role === "member", badRequest("班主任的登录码由密码管理，不需要换"));

        const now = config.now();
        store.loginCodes.revokeByUser(target.id, now);
        const code = uniqueLoginCode(store);
        store.loginCodes.create({ code, classId: user.class_id, userId: target.id, createdAt: now });
        const fresh = store.users.listByClass(user.class_id).find((item) => item.id === target.id);
        return sendJson(res, 201, { teacher: teacherView(fresh) });
      },
    },

    {
      method: "DELETE",
      path: "/api/v1/teachers/code",
      auth: "user",
      // 收回：只作废登录码，老师和他的历史（谁改过哪一版）都留着
      handler: async ({ body, user, store, sendJson, res }) => {
        assert(user.role === "owner", forbidden("只有班主任能收回登录码"));
        const target = store.users.byId(normalizeId(body?.userId));
        assert(target && target.class_id === user.class_id, notFound("没有这位老师"));
        store.loginCodes.revokeByUser(target.id, config.now());
        return sendJson(res, 200, { revoked: true });
      },
    },
  ];
}

function normalizeId(value) {
  return String(value || "").replace(/[^\w-]/g, "").slice(0, 40);
}
