/*
  v3 样例数据（本地直接打开 index.html 时的演示内容）
  ---------------------------------------------------------------
  和 v2 的区别：
    ① 版面是 layout.tiles（12×8 网格），不再是 blocks[] 的 main/side/strip 三栏；
    ② 新增 roster（花名册）+ duty（值日规则）→ 值日磁贴自己算本周谁值日；
    ③ 新增 today.call（点名）→ 点名磁贴显示名字 + 抽到时间；
    ④ 寄语/倒计时从页头页脚搬进磁贴，位置由 layout 决定。
  服务端的真实数据会通过 window.BOARD_STATE / BOARD_APPLY 覆盖这份样例。

  想试手写值日/过期的点名，改下面的 today.duty.text / today.call.at 即可。
*/
(function () {
  var now = new Date();
  var pad = function (n) {
    return n < 10 ? "0" + n : String(n);
  };
  var todayKey = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());

  window.BOARD_SAMPLE = {
    schema: "board-state",
    version: 3,
    revision: 1,
    updatedAt: now.toISOString(),
    class: { name: "高二(3)班" },
    greeting: { name: "同学们" },
    countdown: { label: "期末考试", date: "2027-01-15" },

    /* 花名册：值日分组、抽人点名都按这个顺序来（老师端导入后顺序即分组顺序） */
    roster: {
      students: [
        { id: "s001", name: "陈一鸣", no: "01" },
        { id: "s002", name: "林小雨", no: "02" },
        { id: "s003", name: "周子航", no: "03" },
        { id: "s004", name: "苏悦", no: "04" },
        { id: "s005", name: "赵梓涵", no: "05" },
        { id: "s006", name: "王浩然", no: "06" },
      ],
      updatedAt: now.toISOString(),
    },

    /* 值日规则：6 人、每组 4 人 → 2 组，按周轮换；anchor 是开学日（缺省就是当年 9 月 1 日） */
    duty: { mode: "weekly", size: 4, anchor: "2026-09-01" },

    subjects: [
      { id: "chinese", name: "语文", color: "#e8624a" },
      { id: "math", name: "数学", color: "#5b8ff9" },
      { id: "english", name: "英语", color: "#f0954a" },
      { id: "physics", name: "物理", color: "#8b6cf2" },
      { id: "chemistry", name: "化学", color: "#3fae6a" },
      { id: "biology", name: "生物", color: "#2f9e8f" },
      { id: "pe", name: "体育", color: "#4fc08d" },
      { id: "class", name: "班会", color: "#e3b23c" },
      { id: "self", name: "自习", color: "#8e9aa6" },
    ],

    periods: [
      { index: 1, start: "08:00", end: "08:45" },
      { index: 2, start: "08:55", end: "09:40" },
      { index: 3, start: "10:00", end: "10:45" },
      { index: 4, start: "10:55", end: "11:40" },
      { index: 5, start: "14:00", end: "14:45" },
      { index: 6, start: "14:55", end: "15:40" },
      { index: 7, start: "15:55", end: "16:40" },
      { index: 8, start: "16:50", end: "17:35" },
    ],

    schedule: {
      1: ["chinese", "math", "english", "physics", "chemistry", "biology", "pe", "self"],
      2: ["math", "chinese", "english", "chemistry", "physics", "class", "biology", "self"],
      3: ["english", "math", "chinese", "biology", "physics", "chemistry", "pe", "self"],
      4: ["math", "english", "chinese", "physics", "chemistry", "biology", "pe", "class"],
      5: ["chinese", "math", "english", "biology", "chemistry", "physics", "self", "class"],
    },

    overrides: [],

    today: {
      date: todayKey,
      homework: [
        {
          subject: "chinese",
          items: ["背《古诗二首》，明天默写", "完成《日月潭》课后小练", "把作文提纲交给语文课代表"],
          note: "明天带字典",
        },
        {
          subject: "math",
          items: ["练习册 P58—P59", "整理错题本第 3 页到第 5 页"],
          note: "周五小测第三章",
        },
        {
          subject: "english",
          items: ["背诵 Unit 4 单词表", "跟读课文录音两遍"],
        },
        {
          subject: "physics",
          items: ["实验报告：测小灯泡的电阻"],
          note: "实验课在第三节，别迟到",
        },
      ],
      todo: ["明天队形表演，穿长裤", "下午第三节课后交实验报告"],
      notice: { text: "周五 15:00 开家长会，请提前和家长确认", sign: "—— 班主任" },
      /* 值日不写 text：让磁贴按上面的 roster + duty 自己算；写了 text 就以 text 为准 */
      quote: { text: "把今天的事做完，明天才有余地", sign: "—— 班主任寄语" },
      /* 点名：at 是抽到的时间，超过 24 小时这块磁贴就自己消失 */
      call: { name: "周子航", at: new Date(now.getTime() - 10 * 60 * 1000).toISOString() },
    },

    /*
      12×8 磁贴布局。这里刻意放了一块 3×2（值日）和一块 2×2（点名），
      用来压测小磁贴的降级字号/翻页是不是正常。
    */
    layout: {
      cols: 12,
      rows: 8,
      tiles: [
        { id: "hw", block: "homework", x: 1, y: 1, w: 7, h: 4 },
        { id: "tt", block: "timetable", x: 8, y: 1, w: 5, h: 4 },
        { id: "todo", block: "todo", x: 1, y: 5, w: 4, h: 2 },
        { id: "duty", block: "duty", x: 5, y: 5, w: 3, h: 2 },
        { id: "cd", block: "countdown", x: 8, y: 5, w: 3, h: 2 },
        { id: "call", block: "rollcall", x: 11, y: 5, w: 2, h: 2 },
        { id: "quote", block: "quote", x: 1, y: 7, w: 7, h: 2 },
        { id: "notice", block: "notice", x: 8, y: 7, w: 5, h: 2 },
      ],
    },

    // 主题给全 6 个 token（v3 契约里 theme 只能是这 6 个键，不能带 name、更不能是 null——
    // 带 null 或多余键会被服务端 validateBoardState 直接打回 BAD_REQUEST）
    theme: {
      bg: "#2b4539",
      panel: "#35553f",
      panelInner: "#40634c",
      accent: "#f1bd4e",
      text: "#f5f8f4",
      muted: "#b7c9bd",
    },
  };
})();
