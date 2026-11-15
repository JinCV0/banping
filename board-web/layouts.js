/*
  板块配方（layout presets）
  ---------------------------------------------------------------
  一份配方 = 一份 blocks 数组，?layout=xxx 可以本地预览切换；
  正式使用时以 BoardState.blocks 为准（老师端"班级 → 板块"里改）。
  v2 已删掉 weather / hygiene / event 三种块（没有数据源，留着就是假信息）。
*/
window.BOARD_LAYOUTS = {
  // 日常：作业 + 待办 + 课表 + 底部值日·通知
  daily: [
    { type: "homework", column: "main", order: 1 },
    { type: "todo", column: "side", order: 1 },
    { type: "timetable", column: "side", order: 2 },
    { type: "duty", column: "strip", order: 1 },
    { type: "notice", column: "strip", order: 2 },
  ],

  // 板报：把课表前提，作业独占主栏，最适合"当天作业很多"的班
  classic: [
    { type: "homework", column: "main", order: 1 },
    { type: "timetable", column: "side", order: 1 },
    { type: "todo", column: "side", order: 2 },
    { type: "notice", column: "strip", order: 1 },
  ],

  // 备考周：只留作业、课表和一句通知
  exam: [
    { type: "homework", column: "main", order: 1 },
    { type: "timetable", column: "side", order: 1 },
    { type: "notice", column: "strip", order: 1 },
  ],

  // 极简：投影/小屏，只放作业和课表
  minimal: [
    { type: "homework", column: "main", order: 1 },
    { type: "timetable", column: "side", order: 1 },
  ],
};

window.BOARD_LAYOUT_NAMES = {
  daily: "日常（作业 / 待办 / 课表 + 值日·通知）",
  classic: "板报（课表前提，作业独占主栏）",
  exam: "备考周（作业 + 课表 + 通知）",
  minimal: "极简（只留作业与课表）",
};
