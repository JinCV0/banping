// 老快照升级：v1 → v2 → v3（启动时逐级升，幂等）
// ---------------------------------------------------------------------------
// v1 的屏上数据是"发布那一刻的定格"：date.text 写着"10月26日 周一"、clock.text 写着 16:07、
// 课表是当天那八节、还有 weather / hygiene / event 这些自由文本卡。
// v2 把这些全交给渲染层按日期推：整周 schedule、periods 带上下课时间、today 只放"这一天"的内容。
//
// 升级原则是"搬得动就搬、搬不动就丢"，绝不编造：v1 没有的东西（周末课表、校历、
// 每节课的具体科目）不会凭空造出来，只把已有的科目/作业/待办/通知/寄语原样搬过去。
import { validateBoardState } from "./validate.js";

const SUBJECT_IDS = new Map([
  ["语文", "chinese"], ["数学", "math"], ["英语", "english"], ["物理", "physics"],
  ["化学", "chemistry"], ["生物", "biology"], ["政治", "politics"], ["历史", "history"],
  ["地理", "geography"], ["体育", "pe"], ["音乐", "music"], ["美术", "art"],
  ["班会", "class"], ["自习", "self"], ["信息", "it"], ["通用", "general"],
]);

const COLORS = ["#e8624a", "#5b8ff9", "#f0954a", "#8b6cf2", "#3fae6a", "#2f9e8f", "#4fc08d", "#e3b23c", "#8e9aa6"];

// 和 board-web/state.sample.js 的作息一致：v1 没有上下课时间，只能给一套常规的
const PERIOD_TIMES = [
  ["08:00", "08:45"], ["08:55", "09:40"], ["10:00", "10:45"], ["10:55", "11:40"],
  ["14:00", "14:45"], ["14:55", "15:40"], ["15:55", "16:40"], ["16:50", "17:35"],
  ["18:30", "19:15"], ["19:25", "20:10"], ["20:20", "21:05"], ["21:15", "22:00"],
];

const BLOCK_TYPES = new Set(["homework", "todo", "timetable", "notice", "duty"]);

// v2 的三栏版面（main / side / strip）在 v3 里换成 12×8 磁贴。这张表就是"老样子"：
// 作业 7×4 左上、待办 5×2 右上、课表 5×3、值日 4×2、通知 4×2 底部（坐标见 docs/board-v3.md §5）。
const TILE_TEMPLATE = {
  homework: { id: "hw", block: "homework", x: 1, y: 1, w: 7, h: 4 },
  todo: { id: "td", block: "todo", x: 8, y: 1, w: 5, h: 2 },
  timetable: { id: "tt", block: "timetable", x: 8, y: 3, w: 5, h: 3 },
  duty: { id: "du", block: "duty", x: 1, y: 5, w: 4, h: 2 },
  notice: { id: "nt", block: "notice", x: 5, y: 5, w: 3, h: 2 },
  // v2 里倒计时在头部、寄语在页脚，v3 都变成磁贴；不补的话老班升级后这两样直接消失
  countdown: { id: "cd", block: "countdown", x: 1, y: 7, w: 3, h: 2 },
  quote: { id: "qt", block: "quote", x: 4, y: 7, w: 4, h: 2 },
};
const TILE_ORDER = ["homework", "todo", "timetable", "duty", "notice", "countdown", "quote"];
const WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const HEX = /^#[0-9a-fA-F]{6}$/;
const THEME_KEYS = ["bg", "panel", "panelInner", "accent", "text", "muted"];

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function dateKey(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** v1 的星期只写在 date.text 里（"10月26日 周一"），没有就退回 updatedAt 那天 */
function pickWeekday(v1) {
  const hit = String(v1?.date?.text ?? "").match(/周([一二三四五六日天])/);
  if (hit) return WEEKDAYS[hit[1]];
  const at = Date.parse(String(v1?.updatedAt ?? ""));
  if (!Number.isFinite(at)) return null;
  const day = new Date(at).getDay();
  return day === 0 ? 7 : day;
}

/** 科目表：v1 的科目散在 homework.subjects 和 timetable.items 两处，按出现顺序去重 */
function collectSubjects(v1) {
  const seen = new Map();
  const add = (name, color) => {
    const label = text(name, 6);
    if (!label || seen.has(label)) return;
    let id = SUBJECT_IDS.get(label);
    if (!id) {
      let n = 1;
      const taken = new Set([...seen.values()].map((item) => item.id));
      while (taken.has(`s${n}`)) n += 1;
      id = `s${n}`;
    }
    seen.set(label, {
      id,
      name: label,
      color: HEX.test(String(color)) ? String(color) : COLORS[seen.size % COLORS.length],
    });
  };
  for (const row of v1?.homework?.subjects ?? []) add(row?.subject, row?.color);
  for (const row of v1?.timetable?.items ?? []) add(row?.subject, row?.color);
  return [...seen.values()];
}

const idOf = (subjects, name) => {
  const label = text(name, 6);
  const hit = subjects.find((item) => item.name === label);
  return hit ? hit.id : null;
};

function buildPeriods(v1) {
  const rows = Array.isArray(v1?.timetable?.items) ? v1.timetable.items : [];
  const maxIndex = rows.reduce((max, row) => Math.max(max, Number(row?.index) || 0), 0);
  const count = Math.min(Math.max(maxIndex || 8, 1), 12);
  return Array.from({ length: count }, (_, i) => {
    const [start, end] = PERIOD_TIMES[i] ?? PERIOD_TIMES[PERIOD_TIMES.length - 1];
    return { index: i + 1, start, end };
  });
}

/** 课表：v1 那八节就是"那一天"的课，落到对应星期；别的日子空着，由老师以后自己填 */
function buildSchedule(v1, subjects, periodCount) {
  const rows = Array.isArray(v1?.timetable?.items) ? v1.timetable.items : [];
  const ids = [];
  for (let index = 1; index <= periodCount; index += 1) {
    const row = rows.find((item) => Number(item?.index) === index);
    ids.push((row && idOf(subjects, row.subject)) || "");
  }
  const weekday = pickWeekday(v1);
  const schedule = {};
  if (weekday && ids.some(Boolean)) schedule[String(weekday)] = ids;
  return schedule;
}

function buildToday(v1, subjects, today) {
  const homework = [];
  for (const row of v1?.homework?.subjects ?? []) {
    const id = idOf(subjects, row?.subject);
    const items = (Array.isArray(row?.items) ? row.items : []).map((line) => text(line, 42)).filter(Boolean).slice(0, 6);
    if (id && items.length) homework.push({ subject: id, items });
  }
  const todo = (Array.isArray(v1?.todo?.items) ? v1.todo.items : []).map((line) => text(line, 24)).filter(Boolean).slice(0, 6);

  const out = { date: today };
  if (homework.length) out.homework = homework;
  if (todo.length) out.todo = todo;

  const notice = text(v1?.notice?.text, 60);
  if (notice) out.notice = { text: notice, ...(text(v1?.notice?.sign, 16) ? { sign: text(v1.notice.sign, 16) } : {}) };

  const duty = (Array.isArray(v1?.duty?.items) ? v1.duty.items : []).map((name) => text(name, 8)).filter(Boolean);
  if (duty.length) out.duty = { text: duty.join("、").slice(0, 40) };

  const quote = text(v1?.quote?.text, 60);
  if (quote) out.quote = { text: quote, ...(text(v1?.quote?.sign, 16) ? { sign: text(v1.quote.sign, 16) } : {}) };

  return out;
}

/** 倒计时：v1 存的是"还剩 N 天"的快照，按 updatedAt + N 天还原成考试日期 */
function buildCountdown(v1) {
  const days = Number(v1?.countdown?.days);
  const base = Date.parse(String(v1?.updatedAt ?? ""));
  const label = text(v1?.countdown?.label, 12);
  if (!label || !Number.isFinite(days) || !Number.isFinite(base)) return null;
  return { label, date: dateKey(new Date(base + days * 86_400_000)) };
}

/** 问候：v1 是"同学们，下午好"这种整句，v2 只留称呼，时段由渲染层自己算 */
function buildGreeting(v1) {
  const raw = text(v1?.greeting?.text, 40);
  if (!raw) return null;
  const name = raw.replace(/(?:早上|上午|中午|下午|晚上)?好[！!，,。.]?$/u, "").replace(/[，,]$/u, "").trim();
  return name ? { name: name.slice(0, 8) } : null;
}

function buildTheme(theme) {
  if (!theme || typeof theme !== "object") return null;
  const out = {};
  for (const key of THEME_KEYS) {
    if (!HEX.test(String(theme[key] ?? ""))) return null;
    out[key] = String(theme[key]);
  }
  return out;
}

function buildBlocks(blocks, today) {
  if (!Array.isArray(blocks)) return null;
  const out = [];
  const seen = new Set();
  for (const item of blocks) {
    if (!BLOCK_TYPES.has(item?.type) || seen.has(item.type)) continue; // weather / hygiene / event 在 v2 里已经删了
    seen.add(item.type);
    const column = ["main", "side", "strip"].includes(item?.column) ? item.column : "main";
    out.push({ type: item.type, column, ...(Number.isFinite(Number(item?.order)) ? { order: Number(item.order) } : {}) });
  }
  // v1 的底部通栏是固定的"值日 + 通知"，没写进 blocks；内容还在就补两块，别让家长会通知凭空消失
  if (today?.duty?.text && !seen.has("duty")) out.push({ type: "duty", column: "strip", order: 1 });
  if (today?.notice?.text && !seen.has("notice")) out.push({ type: "notice", column: "strip", order: 2 });
  return out.length ? out.slice(0, 8) : null;
}

/**
 * 把一份 v1 快照变成 v2。today 用服务端"今天"，revision/updatedAt 由调用方给（升级算一次内容变更）。
 * 返回的对象还不保证过契约，调用方要跑一遍 validateBoardState。
 */
export function upgradeV1ToV2(v1, { today, revision, updatedAt } = {}) {
  const subjects = collectSubjects(v1);
  const periods = buildPeriods(v1);
  const next = {
    schema: "board-state",
    version: 2,
    revision: revision ?? (Number(v1?.revision) || 0),
    updatedAt: updatedAt ?? (text(v1?.updatedAt, 40) || new Date().toISOString()),
    subjects,
    periods,
    schedule: buildSchedule(v1, subjects, periods.length),
    today: buildToday(v1, subjects, today ?? dateKey(new Date())),
  };

  const name = text(v1?.class?.name, 20);
  if (name) next.class = { name };
  const greeting = buildGreeting(v1);
  if (greeting) next.greeting = greeting;
  const countdown = buildCountdown(v1);
  if (countdown) next.countdown = countdown;
  const blocks = buildBlocks(v1?.blocks, next.today);
  if (blocks) next.blocks = blocks;
  const theme = buildTheme(v1?.theme);
  if (theme) next.theme = theme;
  return next;
}

/**
 * v2 blocks[] → v3 磁贴：按"老样子"模板摆回去。
 * 没写过 blocks 的老班（v2 里它可选）用 v2 的默认版面 —— 五块全要，宁可空着也不让内容消失；
 * 内容为空时组件自己返回 null、磁贴不画，所以多给一块不会留下空白框。
 */
function buildLayout(v2) {
  const present = new Set();
  for (const item of Array.isArray(v2?.blocks) ? v2.blocks : []) {
    if (TILE_TEMPLATE[item?.type]) present.add(item.type);
  }
  const types = present.size ? TILE_ORDER.filter((type) => present.has(type)) : TILE_ORDER.slice(0, 5);
  // 倒计时/寄语在 v2 不是"板块"，但在版面上一直显示；有数据就补一块，否则老班升级后它们会凭空消失
  if (text(v2?.countdown?.date, 10)) types.push("countdown");
  // 寄语在 v2 里挂在 today.quote（v1 升级时落在那里），两种位置都认
  if (text(v2?.quote?.text ?? v2?.today?.quote?.text, 40)) types.push("quote");
  return { cols: 12, rows: 8, tiles: types.map((type) => ({ ...TILE_TEMPLATE[type] })) };
}

/**
 * 把一份 v2 快照变成 v3：字段原样保留，blocks 换成 12×8 的 layout 磁贴。
 * roster / duty 规则留空 —— 值日磁贴继续用 today.duty.text（老班级照旧），花名册磁贴不画。
 */
export function upgradeV2ToV3(v2, { revision, updatedAt } = {}) {
  const { blocks, ...rest } = v2 ?? {};
  return {
    ...rest,
    version: 3,
    revision: revision ?? (Number(v2?.revision) || 0),
    updatedAt: updatedAt ?? (text(v2?.updatedAt, 40) || new Date().toISOString()),
    layout: buildLayout(v2),
  };
}

/**
 * 任意老版本 → 当前版本（v3）：1 → 2 → 3 逐级升。
 * 已经是当前版本（或版本号不认识）返回 null，调用方据此"没变化就别写库"。
 */
export function upgradeState(state, opts = {}) {
  const from = Number(state?.version) || 0;
  if (from !== 1 && from !== 2) return null; // 已经是 v3、或者版本号认不出来
  const v2 = from === 1 ? upgradeV1ToV2(state, opts) : state;
  const next = upgradeV2ToV3(v2, opts);
  return Number(next?.version) === 3 ? next : null;
}

/**
 * 启动时把所有老快照升到当前版本（v3）：v1 走 1→2→3，v2 走 2→3，已经是 v3 的直接跳过，所以幂等。
 * 升级算一次内容变更，revision + 1，这样已经连着的大屏会收到推送、重新拉一遍。
 * 返回一份给人看的报告，调用方打日志。
 */
export function upgradeStoredStates(store, now = Date.now()) {
  const report = { scanned: 0, upgraded: [], skipped: [], failed: [] };
  for (const row of store.snapshots.all()) {
    report.scanned += 1;
    const from = Number(row.state?.version) || 0;
    if (!row.state || from === 3) {
      report.skipped.push(row.classId);
      continue;
    }
    if (from !== 1 && from !== 2) {
      report.failed.push({ classId: row.classId, errors: [`不认识的快照版本 v${from}，保持原样`] });
      continue;
    }
    const next = upgradeState(row.state, {
      today: dateKey(new Date(now)),
      revision: (Number(row.revision) || 0) + 1,
      updatedAt: new Date(now).toISOString(),
    });
    const { ok, errors } = next ? validateBoardState(next) : { ok: false, errors: [{ path: "$", message: "升级结果不是 v3" }] };
    if (!ok) {
      report.failed.push({ classId: row.classId, errors: errors.slice(0, 3).map((item) => `${item.path}: ${item.message}`) });
      continue;
    }
    store.snapshots.put({
      classId: row.classId,
      revision: next.revision,
      state: next,
      updatedAt: now,
      updatedBy: "migrate-v3",
    });
    report.upgraded.push({ classId: row.classId, revision: next.revision, from, to: 3 });
  }
  return report;
}
