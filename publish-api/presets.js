// 预置内容：五套布局 + 一份 12 人的示例名单 + 一套"看得过去"的示例内容。
//
// 给谁用：
//   1. 建班时（routes-auth 的 class/claim）直接把示例内容写成第一版快照——
//      老师登录后大屏就不是空的，能立刻看到"这块屏长什么样"，再改成自己班的。
//   2. 老师端「布局」页的"预置布局"、班级页花名册的"用示例名单"，
//      都读同一份常量，所以这里只写一次。
//
// 坐标是 12×8 网格（x 从 1 开始、y 从 1 开始），和 BoardState v3 一致。

export const LAYOUT_PRESETS = [
  {
    id: "balanced",
    name: "均衡",
    desc: "作业占左半边，课表与待办在右；底部值日、通知、倒计时、寄语铺满",
    tiles: [
      { id: "hw", block: "homework", x: 1, y: 1, w: 7, h: 4 },
      { id: "tt", block: "timetable", x: 8, y: 1, w: 5, h: 3 },
      { id: "td", block: "todo", x: 8, y: 4, w: 5, h: 2 },
      { id: "du", block: "duty", x: 1, y: 5, w: 3, h: 2 },
      { id: "nt", block: "notice", x: 4, y: 5, w: 4, h: 2 },
      { id: "cd", block: "countdown", x: 8, y: 6, w: 2, h: 3 },
      { id: "qt", block: "quote", x: 1, y: 7, w: 4, h: 2 },
      { id: "rc", block: "rollcall", x: 5, y: 7, w: 3, h: 2 },
    ],
  },
  {
    id: "homework-first",
    name: "作业优先",
    desc: "作业给到最大，课表竖排一栏；通知和值日压到最下面一行",
    tiles: [
      { id: "hw", block: "homework", x: 1, y: 1, w: 8, h: 5 },
      { id: "tt", block: "timetable", x: 9, y: 1, w: 4, h: 5 },
      { id: "td", block: "todo", x: 1, y: 6, w: 4, h: 3 },
      { id: "du", block: "duty", x: 5, y: 6, w: 3, h: 2 },
      { id: "cd", block: "countdown", x: 5, y: 8, w: 3, h: 1 },
      { id: "nt", block: "notice", x: 8, y: 6, w: 5, h: 3 },
    ],
  },
  {
    id: "day-plan",
    name: "一天的安排",
    desc: "左边课表从上到下走一遍，右边作业与待办；点名和倒计时在底部当焦点",
    tiles: [
      { id: "tt", block: "timetable", x: 1, y: 1, w: 4, h: 6 },
      { id: "hw", block: "homework", x: 5, y: 1, w: 5, h: 4 },
      { id: "td", block: "todo", x: 10, y: 1, w: 3, h: 4 },
      { id: "rc", block: "rollcall", x: 5, y: 5, w: 3, h: 2 },
      { id: "cd", block: "countdown", x: 8, y: 5, w: 2, h: 2 },
      { id: "du", block: "duty", x: 10, y: 5, w: 3, h: 2 },
      { id: "nt", block: "notice", x: 1, y: 7, w: 6, h: 2 },
      { id: "qt", block: "quote", x: 7, y: 7, w: 6, h: 2 },
    ],
  },
  {
    id: "numbers",
    name: "数字墙",
    desc: "倒计时、点名这类大字占主位，作业与课表退到两侧",
    tiles: [
      { id: "cd", block: "countdown", x: 1, y: 1, w: 3, h: 3 },
      { id: "rc", block: "rollcall", x: 4, y: 1, w: 3, h: 3 },
      { id: "hw", block: "homework", x: 7, y: 1, w: 6, h: 4 },
      { id: "tt", block: "timetable", x: 1, y: 4, w: 3, h: 5 },
      { id: "td", block: "todo", x: 4, y: 4, w: 3, h: 3 },
      { id: "du", block: "duty", x: 4, y: 7, w: 3, h: 2 },
      { id: "nt", block: "notice", x: 7, y: 5, w: 6, h: 2 },
      { id: "qt", block: "quote", x: 7, y: 7, w: 6, h: 2 },
    ],
  },
  {
    id: "quiet",
    name: "清爽",
    desc: "只留四块：作业、课表、通知、值日。信息少的时候别把屏塞满",
    tiles: [
      { id: "hw", block: "homework", x: 1, y: 1, w: 8, h: 5 },
      { id: "tt", block: "timetable", x: 9, y: 1, w: 4, h: 4 },
      { id: "du", block: "duty", x: 9, y: 5, w: 4, h: 2 },
      { id: "nt", block: "notice", x: 1, y: 6, w: 8, h: 3 },
    ],
  },
];

// 示例名单：12 个常见的中文姓名，够把"本周值日""抽一个"跑起来
export const SAMPLE_STUDENTS = [
  "张梓萱",
  "李思远",
  "王浩然",
  "陈雨桐",
  "赵梓涵",
  "周子航",
  "孙以宁",
  "吴晓桐",
  "郑亦然",
  "徐清和",
  "马明轩",
  "何雨晴",
];

// 示例内容：都是"老师第一天会填的那种"，不是广告语
export function sampleState(className, todayIso) {
  const subjects = [
    { id: "chinese", name: "语文", color: "#e8705f" },
    { id: "math", name: "数学", color: "#4b7fd1" },
    { id: "english", name: "英语", color: "#e3a23c" },
    { id: "physics", name: "物理", color: "#8f6fd0" },
    { id: "chemistry", name: "化学", color: "#4fae7a" },
    { id: "history", name: "历史", color: "#b07a4a" },
    { id: "pe", name: "体育", color: "#4aa3a3" },
    { id: "class-meeting", name: "班会", color: "#c9a227" },
  ];
  const periods = [
    { index: 1, start: "08:00", end: "08:45" },
    { index: 2, start: "08:55", end: "09:40" },
    { index: 3, start: "10:00", end: "10:45" },
    { index: 4, start: "10:55", end: "11:40" },
    { index: 5, start: "14:00", end: "14:45" },
    { index: 6, start: "14:55", end: "15:40" },
    { index: 7, start: "15:55", end: "16:40" },
    { index: 8, start: "16:50", end: "17:35" },
  ];
  const week = ["math", "english", "chinese", "physics", "chemistry", "pe", "class-meeting", ""];
  const schedule = {};
  for (let d = 1; d <= 5; d += 1) {
    schedule[String(d)] = week.map((id, i) => (i === 7 ? "" : id));
  }

  return {
    schema: "board-state",
    version: 3,
    class: { name: className },
    theme: {
      bg: "#2f493c",
      panel: "#3a5a49",
      inner: "#436a55",
      accent: "#f1bd4e",
      text: "#f2f6f1",
      muted: "#a9c0b2",
    },
    subjects,
    periods,
    schedule,
    overrides: [],
    layout: { cols: 12, rows: 8, tiles: LAYOUT_PRESETS[0].tiles.map((t) => Object.assign({}, t)) },
    roster: {
      students: SAMPLE_STUDENTS.map((name, i) => ({
        id: "s" + (1000 + i),
        name,
        no: String(i + 1).padStart(2, "0"),
      })),
      updatedAt: todayIso,
    },
    duty: { mode: "weekly", size: 4, anchor: todayIso.slice(0, 4) + "-09-01" },
    countdown: { label: "距离期末考试", date: nextTermEnd(todayIso) },
    today: {
      date: todayIso,
      homework: [
        { subject: "chinese", items: ["背诵《古诗二首》，明天默写", "完成《日月潭》课后小练", "把作文提纲交给语文课代表"], note: "明天带字典" },
        { subject: "math", items: ["练习册 P58—P59", "整理错题本第 3 页到第 5 页"], note: "周五小测第三章" },
        { subject: "english", items: ["背诵 Unit 4 单词表", "跟读课文录音两遍"], note: "" },
      ],
      todo: ["明天队形表演，穿长裤", "下午第三节课后交实验报告"],
      notice: { text: "周五 15:00 开家长会，请提前和家长确认到会时间。", sign: "—— 班主任" },
      quote: { text: "把今天的事做完，明天才有余地", sign: "—— 班主任寄语" },
    },
  };
}

// 期末大约在"今天之后的那个 1 月 15 日"；只为了让示例倒计时有个像样的数字
function nextTermEnd(todayIso) {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  return (month >= 9 ? year + 1 : year) + "-01-15";
}
