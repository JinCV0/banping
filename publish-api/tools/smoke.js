// 一次跑完的冒烟测试：建班 → 发布 v2 看板 → 发登录码给科任老师 → 科任只改自己那科
// → 大屏自助领码 → 老师手机扫码绑定 → 大屏轮询拿到设备令牌 → 解绑后大屏回到 401。
// 用内存库 + 随机端口，不碰 data/ 里的真数据；v2 样例数据由本文件自己造，不读 board-web/。
import { createServer } from "../server.js";
import { createClaimKey, verifyClaimKey } from "../claim.js";
import { openStore } from "../store.js";
import { upgradeState, upgradeV1ToV2, upgradeV2ToV3, upgradeStoredStates } from "../migrate.js";
import { loadSchema, validateBoardState } from "../validate.js";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// 中间产物（v1 → v2 那一步）也要能验：v2 的契约文件还在仓库里，这里单独加载它
const TOOLS_DIR = fileURLToPath(new URL(".", import.meta.url));
const V2_SCHEMA_PATH = join(TOOLS_DIR, "..", "..", "board-web", "schema", "board-state.v2.schema.json");

const CLAIM_SECRET = "smoke-claim-secret";
// 用同一串种子现场造两个密钥：一个真的、一个签名被改过的
// 密钥本身不带日期：有效期是建班那一刻服务器写在班级上的
const CLAIM_KEY = createClaimKey(CLAIM_SECRET);
const CLAIM_KEY_TAMPERED = CLAIM_KEY.slice(0, -1) + (CLAIM_KEY.endsWith("Z") ? "Y" : "Z");
// 另一个班的密钥：一钥一班，测到期要另开一把（同一把再 claim 会 403）
const OTHER_CLASS_KEY = createClaimKey(CLAIM_SECRET);
const OWNER_PASSWORD = "123456";
const CLASS_NAME = "三年级二班";

// v3 契约样例：字段与上限见 board-web/schema/board-state.v3.schema.json
function makeState(overrides = {}) {
  return {
    schema: "board-state",
    version: 3,
    revision: 0,
    updatedAt: "2026-11-03T08:00:00+08:00",
    class: { name: CLASS_NAME },
    greeting: { name: "王老师" },
    countdown: { label: "期中考试", date: "2026-11-20" },
    subjects: [
      { id: "chinese", name: "语文", color: "#e8624a" },
      { id: "math", name: "数学", color: "#5b8ff9" },
      { id: "english", name: "英语", color: "#7ac74f" },
    ],
    periods: [
      { index: 1, start: "08:00", end: "08:45" },
      { index: 2, start: "08:55", end: "09:40" },
    ],
    schedule: { 1: ["chinese", "math", ""], 2: ["math", "english", ""] },
    overrides: [{ date: "2026-11-06", periods: ["chinese", "english", ""] }],
    today: {
      date: "2026-11-03",
      homework: [
        { subject: "chinese", items: ["背《古诗二首》", "生字抄写一遍"], note: "明天带字典" },
        { subject: "math", items: ["练习册 P32-33"] },
      ],
      todo: ["交科学实验报告"],
      notice: { text: "周五下午大扫除", sign: "班主任" },
      duty: { text: "第三组" },
      quote: { text: "行百里者半九十", sign: "班主任" },
      call: { name: "李思远", at: "2026-11-03T06:32:00+08:00" },
    },
    roster: {
      students: [
        { id: "s1a2b3", name: "张梓萱", no: "01" },
        { id: "s4c5d6", name: "李思远", no: "02" },
      ],
      updatedAt: "2026-11-03T07:00:00+08:00",
    },
    duty: { mode: "weekly", size: 2, anchor: "2026-09-01" },
    layout: {
      cols: 12,
      rows: 8,
      tiles: [
        { id: "hw", block: "homework", x: 1, y: 1, w: 7, h: 4 },
        { id: "td", block: "todo", x: 8, y: 1, w: 5, h: 2 },
        { id: "tt", block: "timetable", x: 8, y: 3, w: 5, h: 3 },
      ],
    },
    theme: {
      bg: "#0f1626",
      panel: "#1b2437",
      panelInner: "#22304a",
      accent: "#5b8ff9",
      text: "#eaf0ff",
      muted: "#93a4c4",
    },
    ...overrides,
  };
}

const results = [];
function check(name, condition, extra) {
  results.push({ name, ok: Boolean(condition), extra });
  if (!condition) console.error(`✗ ${name}`, extra ?? "");
  else console.log(`✓ ${name}`);
}

async function call(base, method, pathname, { token, body } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

// 起一个独立实例（独立内存库、独立端口），用于测限流/超时这类需要专门配置的规则
async function withServer(overrides, fn) {
  const app = createServer({ dbPath: ":memory:", claimKeySecret: CLAIM_SECRET, ...overrides });
  const address = await app.listen(0, "127.0.0.1");
  try {
    return await fn(app, `http://127.0.0.1:${address.port}`);
  } finally {
    app.close();
  }
}

const state0 = makeState();
const app = createServer({ dbPath: ":memory:", claimKeySecret: CLAIM_SECRET });
const address = await app.listen(0, "127.0.0.1");
const base = `http://127.0.0.1:${address.port}`;

try {
  // 1. 建班：没有开通密钥或密钥不对都不行
  const noKey = await call(base, "POST", "/api/v1/class/claim", {
    body: { className: CLASS_NAME, ownerName: "王老师", password: OWNER_PASSWORD },
  });
  check("缺开通密钥被拒 400", noKey.status === 400, noKey.body);

  const badKey = await call(base, "POST", "/api/v1/class/claim", {
    body: { className: CLASS_NAME, ownerName: "王老师", password: OWNER_PASSWORD, claimKey: CLAIM_KEY_TAMPERED },
  });
  check("开通密钥不对 403", badKey.status === 403 && badKey.body.error.code === "FORBIDDEN", badKey.body);

  // 密钥是"验规律"不是"对暗号"：乱写的格式、没配种子都要被挡
  check("乱写的密钥判格式不对", verifyClaimKey("这是一个密钥", CLAIM_SECRET).reason === "format");
  check("服务器没配种子时判 unset", verifyClaimKey(CLAIM_KEY, "").reason === "unset");
  check("真密钥校验通过", verifyClaimKey(CLAIM_KEY, CLAIM_SECRET).ok === true);

  const formatKey = await call(base, "POST", "/api/v1/class/claim", {
    body: { className: CLASS_NAME, ownerName: "王老师", password: OWNER_PASSWORD, claimKey: "CB-1234" },
  });
  check("格式不对的密钥 403", formatKey.status === 403, formatKey.body);

  const claim = await call(base, "POST", "/api/v1/class/claim", {
    body: { className: CLASS_NAME, ownerName: "王老师", password: OWNER_PASSWORD, claimKey: CLAIM_KEY },
  });
  check("建班返回 201 且带 token", claim.status === 201 && claim.body.token, claim.body);
  const ownerToken = claim.body.token;
  const classCode = claim.body.user.class.code;
  check("班级码是 8 位数字", typeof classCode === "string" && /^\d{8}$/.test(classCode), classCode);
  check("新班服务期一年（密钥不带日期）", claim.body.user.license?.daysLeft >= 364, claim.body.user.license);

  // 一钥一班：同一把密钥再 claim 必须被挡住，并且告诉对方已有班级码
  const secondClaim = await call(base, "POST", "/api/v1/class/claim", {
    body: { className: "另一个班", ownerName: "赵老师", password: OWNER_PASSWORD, claimKey: CLAIM_KEY },
  });
  check(
    "同一把密钥再建班 403 且带 CLAIM_TAKEN 与已有班级码",
    secondClaim.status === 403 &&
      secondClaim.body.error.code === "CLAIM_TAKEN" &&
      secondClaim.body.error.message.includes(classCode) &&
      secondClaim.body.error.details?.classCode === classCode,
    secondClaim.body.error,
  );
  const loginWithCode = await call(base, "POST", "/api/v1/auth/login", {
    body: { classCode, password: OWNER_PASSWORD },
  });
  check("被拒后用班级码仍能登录", loginWithCode.status === 200 && loginWithCode.body.user.class.id === claim.body.user.class.id, loginWithCode.body.error);

  // 2. 建班时服务端已经写好"预置内容"：revision=1、v3、带 12 人示例名单
  const seeded = await call(base, "GET", "/api/v1/board/state", { token: ownerToken });
  check(
    "建班自带预置内容（revision=1 / v3 / 12 人名单）",
    seeded.status === 200 && seeded.body.revision === 1 && seeded.body.state?.version === 3 &&
      seeded.body.state?.roster?.students?.length === 12 && seeded.body.state?.layout?.tiles?.length >= 4,
    seeded.body.state?.roster,
  );

  // 3. 班主任发布整份 v2 看板
  const publish = await call(base, "PUT", "/api/v1/board/state", { token: ownerToken, body: { state: state0 } });
  check("班主任发布 v2 成功 revision=2", publish.status === 200 && publish.body.revision === 2, publish.body);

  const loaded = await call(base, "GET", "/api/v1/board/state", { token: ownerToken });
  check(
    "拉回来的是刚发布的 v2 版本",
    loaded.body.revision === 2 && loaded.body.state.today.homework[0].items.length === 2,
    loaded.body.state?.today,
  );

  // 4. 老 v1 形状被 v2 契约挡住
  const v1Shaped = await call(base, "PUT", "/api/v1/board/state", {
    token: ownerToken,
    body: {
      state: {
        schema: "board-state",
        version: 1,
        revision: 0,
        updatedAt: "2026-10-26T16:07:00+08:00",
        homework: { subjects: [] },
      },
    },
  });
  check(
    "v1 形状发布被拒 400 且提示 BoardState v3",
    v1Shaped.status === 400 && /BoardState v3/.test(v1Shaped.body.error.message),
    v1Shaped.body.error,
  );

  // v2 的形状（三栏 blocks、没有 layout）现在也发不上来：契约版本由服务端说了算
  const v2Shaped = await call(base, "PUT", "/api/v1/board/state", {
    token: ownerToken,
    body: { state: { ...makeState(), version: 2 } },
  });
  check(
    "version 2 的快照发不上去（必须 v3）",
    v2Shaped.status === 400 &&
      v2Shaped.body.error.details.some((item) => /必须是 3/.test(item)),
    v2Shaped.body.error,
  );

  // 5. 客户端塞假 revision / 假班名都会被服务端盖掉
  const fake = await call(base, "PUT", "/api/v1/board/state", {
    token: ownerToken,
    body: { state: makeState({ revision: 99, class: { name: "冒牌三年级二班" } }) },
  });
  check("假 revision 由服务端覆盖为 3", fake.status === 200 && fake.body.revision === 3, fake.body);

  const stamped = await call(base, "GET", "/api/v1/board/state", { token: ownerToken });
  check("班名以服务端班级为准", stamped.body.state.class.name === CLASS_NAME, stamped.body.state.class);

  // 6. 超上限的文本被拒（schema maxLength）
  const tooLong = await call(base, "PUT", "/api/v1/board/state", {
    token: ownerToken,
    body: { state: makeState({ today: { ...state0.today, notice: { text: "字".repeat(61) } } }) },
  });
  check("超 60 字的通知被拒 400", tooLong.status === 400, tooLong.body.error);

  // 7. 陈旧 revision 触发 409
  const stale = await call(base, "PUT", "/api/v1/board/state", {
    token: ownerToken,
    body: { state: state0, ifRevision: 1 },
  });
  check("ifRevision 过期返回 409 STALE", stale.status === 409 && stale.body.error.code === "STALE", stale.body.error);

  // 8. 班主任给科任老师发 6 位登录码（科目按 id 填，不能被截断）
  const makeTeacher = await call(base, "POST", "/api/v1/teachers", {
    token: ownerToken,
    body: { name: "李老师", subject: "chinese" },
  });
  check(
    "生成语文登录码",
    makeTeacher.status === 201 && /^[2-9A-Z]{6}$/.test(makeTeacher.body.teacher.loginCode),
    makeTeacher.body,
  );
  check("科目 id 完整保存（chinese 不被截成 chines）", makeTeacher.body.teacher.subject === "chinese", makeTeacher.body.teacher);
  const teacherLoginCode = makeTeacher.body.teacher.loginCode;

  // 分享页要按"谁先建谁在前"排，不看名字 —— /me 的 teachers 必须带 createdAt 且升序
  await new Promise((resolve) => setTimeout(resolve, 20));
  const makeTeacher2 = await call(base, "POST", "/api/v1/teachers", {
    token: ownerToken,
    body: { name: "陈老师", subject: "math" },
  });
  check("第二个任课老师（数学）也建成功", makeTeacher2.status === 201 && makeTeacher2.body.teacher.subject === "math", makeTeacher2.body);

  const meRoster = await call(base, "GET", "/api/v1/me", { token: ownerToken });
  const roster = meRoster.body.teachers;
  check(
    "班主任 /me 的每位任课老师都带 createdAt（ISO 字符串）",
    Array.isArray(roster) &&
      roster.length === 2 &&
      roster.every((item) => typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt))),
    roster,
  );
  check(
    "teachers 按创建先后升序（李老师先建，排陈老师前面）",
    Array.isArray(roster) &&
      roster.length === 2 &&
      roster[0].name === "李老师" &&
      roster[1].name === "陈老师" &&
      Date.parse(roster[0].createdAt) <= Date.parse(roster[1].createdAt),
    Array.isArray(roster) ? roster.map((item) => `${item.name}@${item.createdAt}`) : roster,
  );

  const teacherLogin = await call(base, "POST", "/api/v1/auth/teacher-login", {
    body: { classCode, loginCode: teacherLoginCode },
  });
  check(
    "任课老师用登录码登录",
    teacherLogin.status === 200 && teacherLogin.body.user.subject === "chinese",
    teacherLogin.body.user,
  );
  const memberToken = teacherLogin.body.token;

  // 任课老师的 teachers 语义不变：只看得到自己那一行，且不带登录码
  const meMember = await call(base, "GET", "/api/v1/me", { token: memberToken });
  const memberRoster = meMember.body.teachers ?? [];
  check(
    "任课老师的 /me 只看得到自己、不带任何登录码",
    Array.isArray(memberRoster) &&
      memberRoster.length <= 1 &&
      memberRoster.every((item) => item.name === "李老师" && item.login_code === null),
    memberRoster,
  );

  const teacherAgain = await call(base, "POST", "/api/v1/auth/teacher-login", {
    body: { classCode, loginCode: teacherLoginCode },
  });
  check("同一个登录码可以重复登录", teacherAgain.status === 200 && teacherAgain.body.token, teacherAgain.body);

  const crossClass = await call(base, "POST", "/api/v1/auth/teacher-login", {
    body: { classCode: "00000000", loginCode: teacherLoginCode },
  });
  check("班级码不对 404", crossClass.status === 404, crossClass.body);

  // 9. 科任老师只改自己那一科：连数学、寄语、科目表一起改，都应当被忽略
  const edited = makeState();
  edited.today.homework = [
    { subject: "chinese", items: ["《日月潭》生字抄写一遍", "朗读课文三遍"] },
    { subject: "math", items: ["数学作业被科任老师篡改"] },
    { subject: "english", items: ["英语作业被科任老师加上"] },
  ];
  edited.today.quote = { text: "科任老师改寄语" };
  edited.today.notice = { text: "科任老师改通知" };
  edited.subjects = [{ id: "chinese", name: "语文课", color: "#000000" }];
  edited.schedule = { 1: ["math", "math", ""] };
  edited.layout = { cols: 12, rows: 8, tiles: [{ id: "nt", block: "notice", x: 1, y: 1, w: 4, h: 2 }] };
  edited.unknownField = 1;
  const memberPush = await call(base, "PUT", "/api/v1/board/state", { token: memberToken, body: { state: edited } });
  check("科任老师发布成功 revision=4", memberPush.status === 200 && memberPush.body.revision === 4, memberPush.body);

  const afterMember = await call(base, "GET", "/api/v1/board/state", { token: ownerToken });
  const hw = afterMember.body.state.today.homework;
  const chineseEntry = hw.find((item) => item.subject === "chinese");
  const mathEntry = hw.find((item) => item.subject === "math");
  check("语文条目已更新", chineseEntry.items[0] === "《日月潭》生字抄写一遍", chineseEntry);
  check("没填 note 时保留班主任原来的备注", chineseEntry.note === "明天带字典", chineseEntry.note);
  check("数学条目没被科任老师改掉", JSON.stringify(mathEntry.items) === JSON.stringify(["练习册 P32-33"]), mathEntry.items);
  check("科目表没被科任老师改掉", afterMember.body.state.subjects.length === 3, afterMember.body.state.subjects);
  check("课表没被科任老师改掉", JSON.stringify(afterMember.body.state.schedule) === JSON.stringify(state0.schedule));
  check("磁贴布局没被科任老师改掉", afterMember.body.state.layout?.tiles?.length === 3, afterMember.body.state.layout);
  check("寄语没被科任老师改掉", afterMember.body.state.today.quote.text === "行百里者半九十");
  check("通知没被科任老师改掉", afterMember.body.state.today.notice.text === "周五下午大扫除");

  // 10. 大屏自助领码（方向反过来：大屏出码，老师手机扫）
  const claimRes = await call(base, "POST", "/api/v1/devices/claim", { body: { name: "教室希沃" } });
  check(
    "大屏领到配对码 201",
    claimRes.status === 201 && /^[2-9A-Z]{6}$/.test(claimRes.body.code),
    claimRes.body,
  );
  const screenClaim = claimRes.body;
  check("领码返回轮询凭据 pollToken", typeof screenClaim.pollToken === "string" && screenClaim.pollToken.length >= 20);
  check(
    "领码返回扫码地址 pairUrl",
    screenClaim.pairUrl.endsWith(`/pair.html?code=${screenClaim.code}`),
    screenClaim.pairUrl,
  );
  check("领码带过期时间", !Number.isNaN(Date.parse(screenClaim.expiresAt)), screenClaim.expiresAt);

  const pollPending = await call(
    base,
    "GET",
    `/api/v1/devices/claim?claimId=${screenClaim.claimId}&pollToken=${screenClaim.pollToken}`,
  );
  check("没人扫码前轮询是 pending", pollPending.status === 200 && pollPending.body.status === "pending", pollPending.body);

  const pollWrongToken = await call(
    base,
    "GET",
    `/api/v1/devices/claim?claimId=${screenClaim.claimId}&pollToken=someone-else`,
  );
  check(
    "拿着码猜不到别人的轮询凭据（410）",
    pollWrongToken.status === 410 && pollWrongToken.body.error.code === "CLAIM_GONE",
    pollWrongToken.body.error,
  );

  const pollNoParams = await call(base, "GET", "/api/v1/devices/claim");
  check("轮询缺参数 410", pollNoParams.status === 410, pollNoParams.body.error);

  const memberBind = await call(base, "POST", "/api/v1/devices/bind", { token: memberToken, body: { code: screenClaim.code } });
  check("任课老师不能替班里绑屏 403", memberBind.status === 403 && memberBind.body.error.code === "FORBIDDEN", memberBind.body.error);

  const bindUnknown = await call(base, "POST", "/api/v1/devices/bind", { token: ownerToken, body: { code: "ZZZZZZ" } });
  check("绑一个不存在的码 404", bindUnknown.status === 404, bindUnknown.body.error);

  const bind = await call(base, "POST", "/api/v1/devices/bind", { token: ownerToken, body: { code: screenClaim.code } });
  check("老师扫码绑定成功", bind.status === 200 && bind.body.deviceId && bind.body.screenCode, bind.body);
  check("绑定响应里不把设备令牌交给手机", bind.body.deviceToken === undefined, bind.body);
  check("绑定返回班名", bind.body.className === CLASS_NAME, bind.body.className);

  const pollBound = await call(
    base,
    "GET",
    `/api/v1/devices/claim?claimId=${screenClaim.claimId}&pollToken=${screenClaim.pollToken}`,
  );
  check(
    "大屏轮询拿到设备令牌",
    pollBound.status === 200 && pollBound.body.status === "bound" && pollBound.body.deviceToken,
    pollBound.body.status,
  );
  check("轮询带屏幕码", pollBound.body.screenCode === bind.body.screenCode, pollBound.body);
  const deviceToken = pollBound.body.deviceToken;

  const pollUsed = await call(
    base,
    "GET",
    `/api/v1/devices/claim?claimId=${screenClaim.claimId}&pollToken=${screenClaim.pollToken}`,
  );
  check("令牌只交付一次，再轮询是 used", pollUsed.status === 200 && pollUsed.body.status === "used", pollUsed.body);

  const bindAgain = await call(base, "POST", "/api/v1/devices/bind", { token: ownerToken, body: { code: screenClaim.code } });
  check("同一个码不能绑第二次 409", bindAgain.status === 409 && bindAgain.body.error.code === "CLAIM_USED", bindAgain.body.error);

  const deviceRead = await call(base, "GET", "/api/v1/board/state", { token: deviceToken });
  check("大屏能拉看板", deviceRead.status === 200 && deviceRead.body.revision === 4, deviceRead.body.revision);

  const deviceWrite = await call(base, "PUT", "/api/v1/board/state", { token: deviceToken, body: { state: state0 } });
  check("大屏不能发布 401", deviceWrite.status === 401, deviceWrite.body.error);

  const meDevices = await call(base, "GET", "/api/v1/me", { token: ownerToken });
  check(
    "老师端 /me 里能查到大屏屏幕码",
    meDevices.body.devices.length === 1 && meDevices.body.devices[0].screenCode === bind.body.screenCode,
    meDevices.body.devices,
  );

  // 一班一屏：班里已经有一块屏时，再扫一个新码要被挡住（不建记录、不消费那个码）
  const extraClaim = await call(base, "POST", "/api/v1/devices/claim", { body: {} });
  const extraBind = await call(base, "POST", "/api/v1/devices/bind", { token: ownerToken, body: { code: extraClaim.body.code } });
  check(
    "一班一屏：已绑屏的班再绑第二块 409 DEVICE_LIMIT",
    extraBind.status === 409 &&
      extraBind.body.error.code === "DEVICE_LIMIT" &&
      extraBind.body.error.details?.screenCode === bind.body.screenCode,
    extraBind.body.error,
  );
  const extraPoll = await call(
    base,
    "GET",
    `/api/v1/devices/claim?claimId=${extraClaim.body.claimId}&pollToken=${extraClaim.body.pollToken}`,
  );
  check(
    "被 DEVICE_LIMIT 挡下的码没被消费（大屏那边还停在 pending）",
    extraPoll.status === 200 && extraPoll.body.status === "pending",
    extraPoll.body,
  );

  // 11. SSE：大屏订阅后，班主任再发一版应当收到 revision 事件
  const events = [];
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/v1/board/events`, {
    headers: { authorization: `Bearer ${deviceToken}` },
    signal: controller.signal,
  });
  check("SSE 连接建立", stream.status === 200 && stream.headers.get("content-type").includes("text/event-stream"));
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        events.push(decoder.decode(value));
      }
    } catch {
      /* abort 是正常结束 */
    }
  })();

  await new Promise((resolve) => setTimeout(resolve, 150));
  const latest = await call(base, "GET", "/api/v1/board/state", { token: ownerToken });
  const nextRevision = latest.body.revision;
  await call(base, "PUT", "/api/v1/board/state", {
    token: ownerToken,
    body: { state: makeState({ today: { ...state0.today, duty: { text: "第四组" } } }), ifRevision: nextRevision },
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  controller.abort();
  await pump;

  const joined = events.join("");
  check("SSE 收到 hello", joined.includes("event: hello"), joined.slice(0, 120));
  check("SSE 收到 revision 推送", joined.includes("event: revision") && joined.includes(`"revision":${nextRevision + 1}`), joined.slice(-200));

  // 12. 解绑：大屏下次请求就该 401，回去重新显示配对码
  const revoke = await call(base, "POST", "/api/v1/devices/revoke", {
    token: ownerToken,
    body: { deviceId: bind.body.deviceId },
  });
  check("老师解绑大屏", revoke.status === 200 && revoke.body.ok === true, revoke.body);

  const afterRevoke = await call(base, "GET", "/api/v1/board/state", { token: deviceToken });
  check("解绑后大屏 401", afterRevoke.status === 401 && afterRevoke.body.error.code === "UNAUTHORIZED", afterRevoke.body.error);

  const claimAfterRevoke = await call(
    base,
    "GET",
    `/api/v1/devices/claim?claimId=${screenClaim.claimId}&pollToken=${screenClaim.pollToken}`,
  );
  check("解绑后这条配对记录一起消失 410", claimAfterRevoke.status === 410, claimAfterRevoke.body.error);

  const meAfterRevoke = await call(base, "GET", "/api/v1/me", { token: ownerToken });
  check("解绑后设备列表清空", meAfterRevoke.body.devices.length === 0, meAfterRevoke.body.devices);

  // 换屏：解除之后能绑一块新的，屏码是新的（旧 token 的 401 上面已经断言过）
  const swapClaim = await call(base, "POST", "/api/v1/devices/claim", { body: {} });
  const swapBind = await call(base, "POST", "/api/v1/devices/bind", { token: ownerToken, body: { code: swapClaim.body.code } });
  check(
    "解除后能换成新屏，屏码与旧屏不同",
    swapBind.status === 200 && Boolean(swapBind.body.screenCode) && swapBind.body.screenCode !== bind.body.screenCode,
    swapBind.body,
  );
  const swapRevoke = await call(base, "POST", "/api/v1/devices/revoke", {
    token: ownerToken,
    body: { deviceId: swapBind.body.deviceId },
  });
  check("换屏验证完再解除干净（后面的用例还要空位）", swapRevoke.status === 200, swapRevoke.body);

  // 13. 大屏自己注销（换新屏）/ 旧的"老师发码"接口已彻底删除
  const second = await call(base, "POST", "/api/v1/devices/claim", { body: {} });
  const secondBind = await call(base, "POST", "/api/v1/devices/bind", { token: ownerToken, body: { code: second.body.code } });
  const secondPoll = await call(
    base,
    "GET",
    `/api/v1/devices/claim?claimId=${second.body.claimId}&pollToken=${second.body.pollToken}`,
  );
  check("第二块屏也能绑定", secondBind.status === 200 && secondPoll.body.status === "bound", secondPoll.body.status);
  const selfDelete = await call(base, "DELETE", "/api/v1/devices/self", { token: secondPoll.body.deviceToken });
  check("大屏可以自己注销 200", selfDelete.status === 200, selfDelete.body);
  const afterSelfDelete = await call(base, "GET", "/api/v1/board/state", { token: secondPoll.body.deviceToken });
  check("注销后令牌立即失效 401", afterSelfDelete.status === 401, afterSelfDelete.body.error);

  const oldPairCode = await call(base, "POST", "/api/v1/devices/pair-code", { token: ownerToken });
  check("旧的 pair-code 接口已删除 404", oldPairCode.status === 404, oldPairCode.status);
  const oldPair = await call(base, "POST", "/api/v1/devices/pair", { body: { code: "ABC234", name: "教室希沃" } });
  check("旧的 pair 接口已删除 404", oldPair.status === 404, oldPair.status);

  // 14. 领码限流 / 同时待配对上限 / 过期码
  await withServer({ claimRateLimit: 2, claimRateWindowMs: 60_000 }, async (_app, limitedBase) => {
    const first = await call(limitedBase, "POST", "/api/v1/devices/claim", { body: {} });
    const second = await call(limitedBase, "POST", "/api/v1/devices/claim", { body: {} });
    const third = await call(limitedBase, "POST", "/api/v1/devices/claim", { body: {} });
    check("同一 IP 连续领码第 3 次被限流 429", first.status === 201 && second.status === 201 && third.status === 429, third.status);
    check("限流响应是 RATE_LIMITED", third.body.error.code === "RATE_LIMITED", third.body.error);
  });

  await withServer({ claimPendingMax: 1 }, async (_app, cappedBase) => {
    const first = await call(cappedBase, "POST", "/api/v1/devices/claim", { body: {} });
    const second = await call(cappedBase, "POST", "/api/v1/devices/claim", { body: {} });
    check("同时待配对的大屏超上限 429", first.status === 201 && second.status === 429, second.status);
  });

  await withServer({ pairTtlMs: -1000 }, async (_app, expiredBase) => {
    const shortLived = await call(expiredBase, "POST", "/api/v1/devices/claim", { body: {} });
    const expiredPoll = await call(
      expiredBase,
      "GET",
      `/api/v1/devices/claim?claimId=${shortLived.body.claimId}&pollToken=${shortLived.body.pollToken}`,
    );
    check("过期码轮询 410", expiredPoll.status === 410 && expiredPoll.body.error.code === "CLAIM_GONE", expiredPoll.body.error);
  });

  // 15. 登录：班主任班级码 + 密码；老师登录码可以轮换
  const login = await call(base, "POST", "/api/v1/auth/login", {
    body: { classCode, password: OWNER_PASSWORD },
  });
  check("班主任能重新登录", login.status === 200 && login.body.user.role === "owner", login.body.user);

  const badLogin = await call(base, "POST", "/api/v1/auth/login", {
    body: { classCode, password: "错误密码" },
  });
  check("密码不对 401", badLogin.status === 401, badLogin.body.error);

  const rotated = await call(base, "POST", "/api/v1/teachers/code", {
    token: ownerToken,
    body: { userId: makeTeacher.body.teacher.id },
  });
  check("轮换后拿到新登录码", rotated.status === 201 && rotated.body.teacher.loginCode !== teacherLoginCode, rotated.body);

  const oldCode = await call(base, "POST", "/api/v1/auth/teacher-login", {
    body: { classCode, loginCode: teacherLoginCode },
  });
  check("旧登录码作废 401", oldCode.status === 401, oldCode.body.error);

  await call(base, "DELETE", "/api/v1/teachers/code", {
    token: ownerToken,
    body: { userId: makeTeacher.body.teacher.id },
  });
  const revoked = await call(base, "POST", "/api/v1/auth/teacher-login", {
    body: { classCode, loginCode: rotated.body.teacher.loginCode },
  });
  check("收回后登录码失效 401", revoked.status === 401, revoked.body.error);

  // 16. 服务到期：还能登录、能看历史，但不能继续发布
  const expiredClass = await call(base, "POST", "/api/v1/class/claim", {
    body: { className: "到期测试班", ownerName: "李老师", password: OWNER_PASSWORD, claimKey: OTHER_CLASS_KEY },
  });
  check("换一把新密钥能建第二个班", expiredClass.status === 201, expiredClass.body.error);
  const expiredId = expiredClass.body.user.class.id;
  const expiredToken = expiredClass.body.token;
  app.store.classes.setExpiry(expiredId, Date.now() - 86_400_000);
  const expiredPush = await call(base, "PUT", "/api/v1/board/state", { token: expiredToken, body: { state: state0 } });
  check("到期后不能发布 403 并说明到期日", expiredPush.status === 403 && /到期/.test(expiredPush.body.error.message), expiredPush.body.error);
  const expiredRead = await call(base, "GET", "/api/v1/board/state", { token: expiredToken });
  check("到期后仍能读历史", expiredRead.status === 200, expiredRead.body.error);
  const expiredMe = await call(base, "GET", "/api/v1/me", { token: expiredToken });
  check("/me 里标出已到期", expiredMe.body.license && expiredMe.body.license.expired === true, expiredMe.body.license);
  const expiredClaimAgain = await call(base, "POST", "/api/v1/class/claim", {
    body: { className: "到期测试班2", ownerName: "李老师", password: OWNER_PASSWORD, claimKey: OTHER_CLASS_KEY },
  });
  check(
    "第二把密钥同样一钥一班（再 claim 403 CLAIM_TAKEN）",
    expiredClaimAgain.status === 403 &&
      expiredClaimAgain.body.error.code === "CLAIM_TAKEN" &&
      expiredClaimAgain.body.error.message.includes(expiredClass.body.user.class.code),
    expiredClaimAgain.body.error,
  );

  // 17. 班级改名：只有班主任能改；改完不用重新发布，拉看板就是新名字
  const RENAMED = "四年级一班";
  const rename = await call(base, "POST", "/api/v1/class/rename", { token: ownerToken, body: { name: `  ${RENAMED}  ` } });
  check("班主任改班级名 200", rename.status === 200 && rename.body.user.class.name === RENAMED, rename.body);

  const meAfterRename = await call(base, "GET", "/api/v1/me", { token: ownerToken });
  check("/me 里班级名已变", meAfterRename.body.user.class.name === RENAMED, meAfterRename.body.user.class);

  const renameEmpty = await call(base, "POST", "/api/v1/class/rename", { token: ownerToken, body: { name: "   " } });
  check("空班级名 400", renameEmpty.status === 400, renameEmpty.body.error);
  const renameTooLong = await call(base, "POST", "/api/v1/class/rename", {
    token: ownerToken,
    body: { name: "字".repeat(21) },
  });
  check("超过 20 字的班级名 400", renameTooLong.status === 400, renameTooLong.body.error);

  const memberRename = await call(base, "POST", "/api/v1/class/rename", { token: memberToken, body: { name: "任课老师改的班名" } });
  check(
    "任课老师改名 403 且提示只有班主任能改",
    memberRename.status === 403 && /只有班主任能改班级名/.test(memberRename.body.error.message),
    memberRename.body.error,
  );

  // 改名后不重新发布，直接拉：服务端用 classes.name 盖掉发布数据里的旧班名
  const stateAfterRename = await call(base, "GET", "/api/v1/board/state", { token: ownerToken });
  check("改名后拉看板就是新班名（不用重新发布）", stateAfterRename.body.state.class.name === RENAMED, stateAfterRename.body.state.class);

  // 再发布一次：报文里 class.name 还是旧名字（makeState 里是 CLASS_NAME），服务端照样盖成新名
  const republish = await call(base, "PUT", "/api/v1/board/state", { token: ownerToken, body: { state: makeState() } });
  const afterRepublish = await call(base, "GET", "/api/v1/board/state", { token: ownerToken });
  check(
    "重新发布后班名仍是新名字（发布数据里的旧班名被盖掉）",
    republish.status === 200 && afterRepublish.body.state.class.name === RENAMED,
    afterRepublish.body.state.class,
  );

  // 换一块新屏验证：大屏拉到的班名同样来自 classes
  const freshClaim = await call(base, "POST", "/api/v1/devices/claim", { body: { name: "改名测试屏" } });
  await call(base, "POST", "/api/v1/devices/bind", { token: ownerToken, body: { code: freshClaim.body.code } });
  const freshPoll = await call(
    base,
    "GET",
    `/api/v1/devices/claim?claimId=${freshClaim.body.claimId}&pollToken=${freshClaim.body.pollToken}`,
  );
  const deviceAfterRename = await call(base, "GET", "/api/v1/board/state", { token: freshPoll.body.deviceToken });
  check("大屏看到的也是新班名", deviceAfterRename.status === 200 && deviceAfterRename.body.state.class.name === RENAMED, deviceAfterRename.body.state?.class);

  // 18. 静态页面：h5 与 /board/ 渲染层由同一个进程发
  const home = await fetch(`${base}/`);
  const homeHtml = await home.text();
  // 首页内容由 h5 同事持续改版，这里只认"发得出来、有标题、引了 app.js"，不锁具体文案
  check(
    "老师端首页 200 且有标题",
    home.status === 200 && /<title>[^<]+<\/title>/.test(homeHtml),
    home.status,
  );
  check("首页带 app.js", homeHtml.includes("app.js"), homeHtml.slice(0, 80));

  const boardPage = await fetch(`${base}/board/index.html`);
  const boardHtml = await boardPage.text();
  check("/board/ 发渲染层", boardPage.status === 200 && boardHtml.includes("board.js"), boardPage.status);

  const limits = await fetch(`${base}/board/limits.js`);
  const limitsText = await limits.text();
  check("/board/limits.js 是同一份上限", limitsText.includes("window.BOARD_LIMITS"), limitsText.slice(0, 40));

  const noSuch = await fetch(`${base}/board/nope.js`);
  check("静态 404 不落到接口", noSuch.status === 404, noSuch.status);

  const escape = await fetch(`${base}/board/../../package.json`);
  check("目录穿越被挡", escape.status === 404, escape.status);

  // 19. 一班一屏的老库迁移：同班重复设备在 openStore 时去重，并补上唯一索引
  const legacyPath = join(tmpdir(), `bsp-smoke-legacy-${process.pid}.db`);
  const wipeLegacy = () => {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(legacyPath + suffix, { force: true });
  };
  wipeLegacy();
  const legacy = openStore(legacyPath);
  // 拆掉唯一索引后塞两条同班设备 + 一条指向旧屏的配对记录，模拟升级前的老库
  const rawLegacy = new DatabaseSync(legacyPath);
  rawLegacy.exec("DROP INDEX IF EXISTS devices_class_unique;");
  const insertDevice = rawLegacy.prepare(
    "INSERT INTO devices (id, class_id, name, token, screen_code, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insertDevice.run("dev_legacy_old", "cls_legacy", "旧屏", "tok_legacy_old", "OLD001", 1000);
  insertDevice.run("dev_legacy_new", "cls_legacy", "新屏", "tok_legacy_new", "NEW002", 2000);
  rawLegacy
    .prepare(
      "INSERT INTO pair_claims (id, code, poll_token, name, created_at, expires_at, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("pcl_legacy", "OLD001", "poll_legacy", "旧屏", 1000, Date.now() + 60_000, "dev_legacy_old");
  rawLegacy.close();
  legacy.close();

  const reopened = openStore(legacyPath);
  const keptDevices = reopened.devices.listByClass("cls_legacy");
  check(
    "老库同班重复设备启动后只剩 created_at 最新的一条",
    keptDevices.length === 1 && keptDevices[0].id === "dev_legacy_new",
    keptDevices,
  );
  check("被删设备的配对记录也一起清掉", reopened.pairClaims.byId("pcl_legacy") === null);
  const inspect = new DatabaseSync(legacyPath);
  const indexRow = inspect
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'devices_class_unique'")
    .all();
  inspect.close();
  check("老库启动后补上了 devices(class_id) 唯一索引", indexRow.length === 1, indexRow);
  let duplicateRejected = false;
  try {
    reopened.devices.create({
      id: "dev_legacy_dup",
      classId: "cls_legacy",
      name: "第三块",
      token: "tok_legacy_dup",
      screenCode: "DUP003",
      createdAt: 3000,
    });
  } catch (err) {
    duplicateRejected = /UNIQUE constraint failed: devices\.class_id/.test(String(err?.message));
  }
  check("唯一索引真的生效（同班塞不进第二块）", duplicateRejected);
  reopened.close();
  wipeLegacy();
} finally {
  app.close();
}

// ---- 老快照升级：线上那份 v1 数据（2026-11-05 生产库里的样子）必须能原样搬成 v2 ----
const V1 = {
  schema: "board-state",
  version: 1,
  revision: 7,
  updatedAt: "2026-10-26T08:07:00.000Z",
  greeting: { text: "同学们，下午好" },
  date: { text: "10月26日 周一" },
  clock: { text: "16:07" },
  countdown: { label: "距离期末考试", days: 97, sub: "加油" },
  homework: {
    title: "今日作业",
    subjects: [
      { subject: "语文", color: "#e8624a", items: ["今天学完《日月潭》", "复习背诵《古诗二首》"] },
      { subject: "数学", color: "#5b8ff9", items: ["背诵乘法口诀"] },
    ],
  },
  todo: { title: "今日待办", items: ["明天队形表演，穿长裤", "带美术画笔"] },
  timetable: {
    title: "今日课表",
    items: [
      { index: 1, subject: "语文", color: "#e8624a" },
      { index: 2, subject: "数学", color: "#5b8ff9" },
      { index: 3, subject: "体育", color: "#4fc08d" },
    ],
  },
  duty: { title: "今日值日", items: ["张梓萱", "李思远"] },
  notice: { title: "班级通知", text: "周五 15:00 家长会", sign: "—— 班主任" },
  quote: { text: "不负晨光，不负自己", sign: "—— 班主任寄语" },
  weather: { title: "天气", text: "多云 18℃" },
  hygiene: { title: "卫生", text: "本周文明班" },
  event: { title: "活动", text: "周五运动会" },
  blocks: [
    { type: "homework", column: "main", order: 1 },
    { type: "todo", column: "side", order: 1 },
    { type: "timetable", column: "side", order: 2 },
    { type: "weather", column: "strip", order: 1 },
    { type: "hygiene", column: "strip", order: 2 },
    { type: "event", column: "strip", order: 3 },
  ],
  theme: { bg: "#2f493c", panel: "#35553f", panelInner: "#40634c", accent: "#f1bd4e", text: "#f5f8f4", muted: "#b7c9bd" },
};

{
  // 第一级：v1 → v2（字段还原），中间产物仍要能过 v2 契约
  const v2 = upgradeV1ToV2(V1, { today: "2026-11-05", revision: 8, updatedAt: "2026-11-05T01:00:00.000Z" });
  const v2Check = validateBoardState(v2, loadSchema(V2_SCHEMA_PATH));
  check("v1 快照升级后过 v2 契约（中间产物）", v2Check.ok, v2Check.errors.slice(0, 2));
  check(
    "科目从作业和课表两处合并去重",
    v2.subjects.map((item) => item.name).join(",") === "语文,数学,体育",
    v2.subjects.map((item) => item.name),
  );
  check("v1 那天的课落到 date.text 写的周一", v2.schedule?.["1"]?.join(",") === "chinese,math,pe", v2.schedule);
  check("倒计时还原成日期（10-26 + 97 天）", v2.countdown?.date === "2027-01-31", v2.countdown);
  check("问候只留称呼，时段交给渲染层", v2.greeting?.name === "同学们", v2.greeting);
  check("作业条目原样搬过来", v2.today.homework.length === 2 && v2.today.homework[0].items.length === 2);
  check("值日拼成一行", v2.today.duty?.text === "张梓萱、李思远", v2.today.duty);
  check("通知带署名", v2.today.notice?.text === "周五 15:00 家长会" && !!v2.today.notice.sign);
  check(
    "v1 的底部通栏（值日 + 通知）补回 blocks，天气/卫生/活动丢掉",
    v2.blocks.map((item) => item.type).join(",") === "homework,todo,timetable,duty,notice",
    v2.blocks,
  );
  check("主题六个颜色原样保留", v2.theme?.accent === "#f1bd4e");

  // 第二级：v2 → v3（blocks 换成 12×8 磁贴）
  const v3 = upgradeState(V1, { today: "2026-11-05", revision: 8, updatedAt: "2026-11-05T01:00:00.000Z" });
  const v3Check = validateBoardState(v3);
  check("v1 一路升到 v3 且过 v3 契约", v3?.version === 3 && v3Check.ok, v3Check.errors.slice(0, 3));
  const expectedTiles = [
    { id: "hw", block: "homework", x: 1, y: 1, w: 7, h: 4 },
    { id: "td", block: "todo", x: 8, y: 1, w: 5, h: 2 },
    { id: "tt", block: "timetable", x: 8, y: 3, w: 5, h: 3 },
    { id: "du", block: "duty", x: 1, y: 5, w: 4, h: 2 },
    { id: "nt", block: "notice", x: 5, y: 5, w: 3, h: 2 },
    { id: "cd", block: "countdown", x: 1, y: 7, w: 3, h: 2 },
    { id: "qt", block: "quote", x: 4, y: 7, w: 4, h: 2 },
  ];
  check(
    "blocks 按「老样子」模板换成 12×8 磁贴（坐标与尺寸都对）",
    JSON.stringify(v3?.layout?.tiles) === JSON.stringify(expectedTiles),
    v3?.layout?.tiles,
  );
  check("升级后不再留 blocks 字段", v3 && v3.blocks === undefined);
  check(
    "v2 里没写过 blocks 的老班按默认五块补齐，倒计时/寄语有数据也各补一块",
    upgradeV2ToV3({ ...v2, blocks: undefined }, {}).layout.tiles.length === 7,
    upgradeV2ToV3({ ...v2, blocks: undefined }, {}).layout.tiles.map((item) => item.block),
  );
  check(
    "v2 只写了部分 blocks 时只补那几块，顺序按模板",
    upgradeV2ToV3(
      { ...v2, blocks: [{ type: "notice", column: "strip", order: 1 }, { type: "homework", column: "main", order: 0 }] },
      {},
    ).layout.tiles.map((item) => item.block).join(",") === "homework,notice,countdown,quote",
  );
  check("已经是 v3 的快照不再升级（upgradeState 返回 null）", upgradeState(v3) === null);
  check(
    "升级出的 v3 保留了今天的值日文本（老班级照旧显值日）",
    v3?.today?.duty?.text === "张梓萱、李思远" && v3?.roster === undefined && v3?.duty === undefined,
    v3?.today?.duty,
  );

  // 启动升级链：v1 → v3、v2 → v3，v3 跳过，坏数据保持原样
  const pushed = [];
  const stub = {
    snapshots: {
      all: () => [
        { classId: "cls_a", revision: 7, state: V1, updatedAt: 1, updatedBy: "teacher" },
        { classId: "cls_b", revision: 3, state: { ...v2 }, updatedAt: 2, updatedBy: "teacher" },
        { classId: "cls_c", revision: 5, state: v3, updatedAt: 3, updatedBy: "teacher" },
        { classId: "cls_d", revision: 1, state: null, updatedAt: 4, updatedBy: "teacher" },
      ],
      put: (row) => pushed.push(row),
    },
  };
  const report = upgradeStoredStates(stub, Date.parse("2026-11-05T02:00:00.000Z"));
  check(
    "启动升级链把 v1 和 v2 都升到 v3，已经是 v3 的跳过",
    report.upgraded.length === 2 && report.skipped.length === 2 && report.failed.length === 0,
    report,
  );
  const upgradedA = pushed.find((row) => row.classId === "cls_a");
  const upgradedB = pushed.find((row) => row.classId === "cls_b");
  check(
    "升级算一次变更：revision + 1（v1 的 7→8、v2 的 3→4）",
    upgradedA?.revision === 8 && upgradedB?.revision === 4,
    [upgradedA?.revision, upgradedB?.revision],
  );
  check(
    "写回库里的都是 v3 且过契约，updatedBy 标成 migrate-v3",
    pushed.every((row) => row.state.version === 3 && validateBoardState(row.state).ok && row.updatedBy === "migrate-v3"),
  );

  // 幂等：把刚升级完的结果再喂一遍，应该全部跳过、一条都不写
  const secondPushed = [];
  const again = upgradeStoredStates(
    { snapshots: { all: () => pushed.map((row) => ({ ...row })), put: (row) => secondPushed.push(row) } },
    Date.parse("2026-11-05T03:00:00.000Z"),
  );
  check(
    "二次启动不重复升级（全部跳过、不写库）",
    again.upgraded.length === 0 && again.skipped.length === 2 && secondPushed.length === 0,
    { upgraded: again.upgraded.length, skipped: again.skipped.length, written: secondPushed.length },
  );

  // v3 里 roster / duty 规则 / 点名都是可选的：老班级照样合法
  const bare = makeState();
  delete bare.roster;
  delete bare.duty;
  delete bare.today.call;
  const bareCheck = validateBoardState(bare);
  check("缺 roster / 值日规则 / 点名的 v3 仍然合法", bareCheck.ok, bareCheck.errors.slice(0, 3));

  // 磁贴范围：按契约只查单字段范围；x+w-1 > 12 这种"组合越界"协议上合法，渲染端裁掉不画
  const combo = makeState();
  combo.layout.tiles = [{ id: "hw", block: "homework", x: 8, y: 1, w: 6, h: 4 }];
  const comboCheck = validateBoardState(combo);
  check("x+w-1 > 12 的越界磁贴按文档仍合法（校验器只查范围，渲染端裁）", comboCheck.ok, comboCheck.errors);
  const outOfRange = makeState();
  outOfRange.layout.tiles = [{ id: "hw", block: "homework", x: 13, y: 1, w: 7, h: 4 }];
  const outCheck = validateBoardState(outOfRange);
  check(
    "磁贴单字段越界（x=13）被校验器拒",
    !outCheck.ok && outCheck.errors.some((item) => /不能大于 12/.test(item.message)),
    outCheck.errors,
  );
}


const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exit(1);
