// 看板相关接口：读当前版本、发布新版本、大屏配对（claim/bind/revoke）与推送。
import { ApiError, badRequest, conflict, forbidden, notFound, assert } from "./errors.js";
import { newId, newShortCode, newToken, normalizeCode } from "./ids.js";
import { validateBoardState, invalidOverrideDates } from "./validate.js";
import { applyRevisionGuard, mergeSubjectEdit } from "./merge.js";
import { LAYOUT_PRESETS, SAMPLE_STUDENTS } from "./presets.js";

const CODE_TRIES = 12;

// 410：这次配对请求已经没救了（过期/被用掉/参数错），大屏该重新申请一个码
const gone = (message) => new ApiError(410, "CLAIM_GONE", message);
const tooMany = (message, details) => new ApiError(429, "RATE_LIMITED", message, details);

/** 认领配对码按 IP 限流：公网接口，不加限制就能被枚举 6 位码 */
function createRateLimiter({ limit, windowMs, now }) {
  const hits = new Map();
  return {
    hit(key) {
      const at = now();
      const list = (hits.get(key) || []).filter((stamp) => at - stamp < windowMs);
      if (list.length >= limit) {
        hits.set(key, list);
        return false;
      }
      list.push(at);
      hits.set(key, list);
      // 地图别无限长：顺手把已经空了的 IP 清掉
      if (hits.size > 2048) {
        for (const [entry, stamps] of hits) {
          if (!stamps.length || at - stamps[stamps.length - 1] >= windowMs) hits.delete(entry);
        }
      }
      return true;
    },
  };
}

/** 谁在申请配对码：反代后面看 x-forwarded-for，本机直连看 socket */
function clientIp(req) {
  const remote = req.socket?.remoteAddress || "unknown";
  const loopback = remote === "::1" || remote === "127.0.0.1" || remote.startsWith("::ffff:127.");
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return loopback && forwarded ? forwarded : remote;
}

/** 配对页地址：给大屏拿去生成二维码，扫了就进老师端 /pair.html?code= */
function pairUrlFor(req, code) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim()
    || (req.socket?.encrypted ? "https" : "http");
  const host = req.headers.host || "localhost";
  return `${proto}://${host}/pair.html?code=${encodeURIComponent(code)}`;
}

function uniqueClaimCode(store, now) {
  for (let i = 0; i < CODE_TRIES; i += 1) {
    const code = newShortCode(6);
    if (!store.pairClaims.pendingByCode(code, now)) return code;
  }
  throw conflict("CODE_EXHAUSTED", "配对码生成失败，请让大屏重试");
}

/** 屏码：绑定后常驻右下角的小号码，老师在"大屏管理"里靠它认屏；同班内唯一 */
function uniqueScreenCode(store, classId) {
  for (let i = 0; i < CODE_TRIES; i += 1) {
    const code = newShortCode(6);
    if (!store.devices.byScreenCode(classId, code)) return code;
  }
  throw conflict("CODE_EXHAUSTED", "屏码生成失败，请重试");
}

/** 一班一屏：已经绑过屏时，老师得先去「班级」页解除，别默默再建一条 */
function deviceLimitError(device) {
  const screenCode = device?.screen_code ?? null;
  return conflict(
    "DEVICE_LIMIT",
    `这个班已经绑了一块大屏（屏码 ${screenCode ?? "—"}），换大屏要先在「班级」页解除它`,
    { deviceId: device?.id ?? null, screenCode },
  );
}

// 报文里的 revision/updatedAt 一律由服务端写，客户端说什么都不作数；
// 校验跑在盖戳之后，这样"客户端塞了个假 revision"也会被 schema 拦下。
function withStamped(state, revision, updatedAt) {
  const next = { ...state, revision, updatedAt };
  const { ok, errors } = validateBoardState(next);
  if (!ok) {
    const heads = errors.slice(0, 6).map((item) => `${item.path}: ${item.message}`);
    throw badRequest("看板数据不符合 BoardState v3 契约", heads);
  }
  const badDates = invalidOverrideDates(next);
  if (badDates.length) {
    throw badRequest("校历里有对不上号的日期（日历上不存在这一天）", badDates.slice(0, 6));
  }
  return next;
}

export function boardRoutes({ config, schema }) {
  const claimLimiter = createRateLimiter({
    limit: config.claimRateLimit,
    windowMs: config.claimRateWindowMs,
    now: config.now,
  });

  return [
    {
      method: "GET",
      path: "/api/v1/board/state",
      auth: "any",
      // 宿主与老师端都用它拉当前版本；没有发布过时返回 revision=0 且 state=null
      handler: async ({ user, device, store, sendJson, res }) => {
        const classId = user?.class_id ?? device.class_id;
        const snapshot = store.snapshots.get(classId);
        if (device) store.devices.touch(device.id, config.now());
        // 班名以 classes 为准（改完名下一次拉取就生效，不用重新发布）；
        // 发布时 PUT 也是这么盖的，两边看到的是同一个名字。
        const klass = store.classes.byId(classId);
        const state =
          snapshot?.state && klass?.name ? { ...snapshot.state, class: { name: klass.name } } : snapshot?.state ?? null;
        return sendJson(res, 200, {
          revision: snapshot?.revision ?? 0,
          state,
          updatedAt: snapshot?.updatedAt ?? null,
        });
      },
    },

    {
      method: "PUT",
      path: "/api/v1/board/state",
      auth: "user",
      // 班主任发全量；任课老师只落自己那一科（其余字段保持上一版）
      handler: async ({ body, user, store, events, sendJson, res }) => {
        assert(user.role === "owner" || user.subject, forbidden("这位老师还没有分配科目"));
        // 班级服务到期后不能再发：登录、看历史都照旧，只有"推到大屏"停掉
        const klass = store.classes.byId(user.class_id);
        const now = config.now();
        assert(
          !klass?.expires_at || klass.expires_at > now,
          forbidden("班级服务已到期（" + new Date(klass.expires_at).toISOString().slice(0, 10) + "），续期后才能继续发布")
        );
        const incoming = body?.state;
        assert(incoming && typeof incoming === "object", badRequest("缺少 state"));

        const existing = store.snapshots.get(user.class_id);
        applyRevisionGuard(existing, body?.ifRevision);

        const previous = existing?.state ?? null;
        const merged =
          user.role === "owner"
            ? { ...incoming }
            : previous
              ? mergeSubjectEdit(previous, incoming, user.subject)
              : null;
        // 没有上一版时，任课老师不能凭自己的报文"发明"整份看板
        assert(merged, forbidden("班主任还没有发布过看板，请等班主任先发布一次"));

        // class.name 只有一个来源：库里的班级。客户端传什么都不作数（v2 契约第 1 节）
        if (klass?.name) merged.class = { name: klass.name };

        const revision = (existing?.revision ?? 0) + 1;
        const next = withStamped(merged, revision, new Date(now).toISOString());

        store.snapshots.put({
          classId: user.class_id,
          revision,
          state: next,
          updatedAt: now,
          updatedBy: user.id,
        });

        const pushed = events.publish(user.class_id, {
          revision,
          updatedAt: next.updatedAt,
          updatedBy: { id: user.id, name: user.name, role: user.role, subject: user.subject ?? null },
        });

        return sendJson(res, 200, { revision, updatedAt: next.updatedAt, pushed });
      },
    },

    {
      method: "GET",
      path: "/api/v1/board/schema",
      auth: "none",
      // 给 h5 老师端做前端即时校验用，避免两边规则漂移
      handler: async ({ sendJson, res }) => sendJson(res, 200, { schema: schema.schema }),
    },

    {
      method: "GET",
      path: "/api/v1/board/presets",
      auth: "user",
      // 预置布局与示例名单：老师端"套用布局""用示例名单"读这里，和建班时写进快照的是同一份
      handler: async ({ sendJson, res }) =>
        sendJson(res, 200, { layouts: LAYOUT_PRESETS, students: SAMPLE_STUDENTS }),
    },

    {
      method: "POST",
      path: "/api/v1/devices/claim",
      auth: "none",
      // ① 大屏自己领一个配对码（不需要登录）：返回 6 位码 + 轮询凭据 + 扫码地址。
      // 方向是"大屏显示、老师手机扫"，所以这块屏必须自己拿着 pollToken。
      handler: async ({ req, body, store, sendJson, res }) => {
        const ip = clientIp(req);
        assert(
          claimLimiter.hit(ip),
          tooMany(`申请配对码太频繁（每个 IP ${config.claimRateLimit} 次 / ${Math.round(config.claimRateWindowMs / 60000)} 分钟），请稍后再试`)
        );

        const now = config.now();
        // 顺手清掉过期且没绑定的旧 claim，免得这张表无限长（大屏刷新页面就会重新领码）。
        store.pairClaims.purgeExpired(now);
        assert(
          store.pairClaims.countPending(now) < config.claimPendingMax,
          tooMany("当前同时在配对的大屏太多，请稍后再试")
        );

        const code = uniqueClaimCode(store, now);
        const claimId = newId("pcl");
        const pollToken = newToken();
        const name = String(body?.name || "教室大屏").trim().slice(0, 40) || "教室大屏";
        const expiresAt = now + config.pairTtlMs;
        store.pairClaims.create({ id: claimId, code, pollToken, name, createdAt: now, expiresAt });

        return sendJson(res, 201, {
          code,
          claimId,
          pollToken,
          expiresAt: new Date(expiresAt).toISOString(),
          pairUrl: pairUrlFor(req, code),
        });
      },
    },

    {
      method: "GET",
      path: "/api/v1/devices/claim",
      auth: "none",
      // ② 大屏每 2 秒轮询一次：pending → 老师扫码绑定后 bound（token 只交付一次）→ used
      handler: async ({ url, store, sendJson, res }) => {
        const claimId = String(url.searchParams.get("claimId") || "").trim();
        const pollToken = String(url.searchParams.get("pollToken") || "").trim();
        // 参数不对和"不存在"回同一句话，别让枚举的人分辨出哪个 claimId 是真的
        assert(claimId && pollToken, gone("配对请求参数不完整，请让大屏重新申请配对码"));

        const now = config.now();
        const claim = store.pairClaims.byId(claimId);
        assert(claim, gone("配对请求不存在或已失效，请让大屏重新申请配对码"));
        // poll_token 被抹掉 = 已经交付过一次 token
        if (!claim.poll_token) return sendJson(res, 200, { status: "used" });
        assert(claim.poll_token === pollToken, gone("配对凭据不对，请让大屏重新申请配对码"));

        if (claim.bound_at) {
          const device = store.devices.byId(claim.device_id);
          assert(device, gone("这块大屏已经被解除了，请重新显示配对码"));
          store.pairClaims.markDelivered(claim.id);
          const klass = store.classes.byId(device.class_id);
          return sendJson(res, 200, {
            status: "bound",
            deviceToken: device.token,
            screenCode: device.screen_code,
            classId: device.class_id,
            className: klass?.name ?? null,
          });
        }

        assert(claim.expires_at > now, gone("配对码已过期，请让大屏重新申请一个"));
        return sendJson(res, 200, { status: "pending" });
      },
    },

    {
      method: "POST",
      path: "/api/v1/devices/bind",
      auth: "user",
      // ③ 老师手机扫码后确认绑定（仅班主任）：把这块屏绑到自己班，生成常驻屏码
      handler: async ({ body, user, store, sendJson, res }) => {
        assert(user.role === "owner", forbidden("只有班主任能把大屏绑定到班级"));
        const code = normalizeCode(body?.code);
        assert(code, badRequest("缺少配对码"));

        const now = config.now();
        const claim = store.pairClaims.pendingByCode(code, now);
        if (!claim) {
          const latest = store.pairClaims.latestByCode(code);
          assert(latest, notFound("配对码无效，请让大屏刷新出新的码"));
          if (latest.bound_at) {
            throw conflict("CLAIM_USED", "这个配对码已经被绑定过了，请让大屏刷新出新码");
          }
          throw conflict("CLAIM_EXPIRED", "配对码已过期，请让大屏刷新出新码");
        }

        // 一班一屏：这个班已经有屏就原样退回（不建记录、不消费 claim）。
        // 放在码校验之后：码本身无效/过期时先告诉老师码的问题，别把两个原因混成一条。
        const existing = store.devices.byClass(user.class_id);
        if (existing) throw deviceLimitError(existing);

        const klass = store.classes.byId(user.class_id);
        const deviceId = newId("dev");
        const token = newToken();
        const screenCode = uniqueScreenCode(store, user.class_id);
        try {
          store.devices.create({
            id: deviceId,
            classId: user.class_id,
            name: claim.name || "教室大屏",
            token,
            screenCode,
            createdAt: now,
          });
        } catch (err) {
          // 两个老师同时扫码：单实例里靠唯一索引兜底，输的一方也看到 409 而不是 500
          if (/UNIQUE constraint failed: devices\.class_id/.test(String(err?.message))) {
            throw deviceLimitError(store.devices.byClass(user.class_id));
          }
          throw err;
        }
        store.pairClaims.bind({ id: claim.id, deviceId, classId: user.class_id, boundAt: now });

        // 注意：设备 token 不在这里回给老师手机，只等大屏自己轮询取走（见 GET /devices/claim）
        return sendJson(res, 200, { deviceId, screenCode, className: klass?.name ?? null });
      },
    },

    {
      method: "POST",
      path: "/api/v1/devices/revoke",
      auth: "user",
      // ⑤ 老师在"大屏管理"里解除一块屏：设备下次请求就 401，屏上重新显示配对卡
      handler: async ({ body, user, store, sendJson, res }) => {
        assert(user.role === "owner", forbidden("只有班主任能解除大屏"));
        const deviceId = String(body?.deviceId || "").trim();
        assert(deviceId, badRequest("缺少字段 deviceId"));
        const device = store.devices.byId(deviceId);
        assert(device && device.class_id === user.class_id, notFound("没有这块大屏"));

        store.pairClaims.removeByDevice(deviceId);
        store.devices.remove(deviceId);
        return sendJson(res, 200, { ok: true });
      },
    },

    {
      method: "GET",
      path: "/api/v1/board/events",
      auth: "any",
      // 推送：老师一发布，宿主立刻收到新 revision（SSE，不用轮询）
      handler: async ({ user, device, store, events, res }) => {
        const classId = user?.class_id ?? device.class_id;
        const snapshot = store.snapshots.get(classId);
        events.subscribe(classId, res, {
          hello: { revision: snapshot?.revision ?? 0, updatedAt: snapshot?.updatedAt ?? null },
        });
        // subscribe 已经把响应头写出去并接管了 res 生命周期，这里不再 sendJson
      },
    },

    {
      method: "DELETE",
      path: "/api/v1/devices/self",
      auth: "device",
      // 换班/换教室时让旧设备自行退出
      handler: async ({ device, store, sendJson, res }) => {
        // 屏自己退出时也把配对凭据一起清掉，别在库里留一条指向空设备的认领
        store.pairClaims.removeByDevice(device.id);
        store.devices.remove(device.id);
        return sendJson(res, 200, { removed: true });
      },
    },
  ];
}
