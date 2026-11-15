/*
  文字量上限（字符数，中文按 1 个算）
  ---------------------------------------------------------------
  两道闸：
    ① 渲染层硬截断（board.js 的 clamp），防止老师把整段通知贴进来把大屏顶爆；
    ② 没超上限但一行放不下的，交给 initScrollers() 横向滚动。
  这份表是唯一来源：渲染层与老师端 h5（/board/limits.js）读的是同一个文件，
  服务端 schema 的同名 maxLength 与它一一对齐。改数字只改这里 + schema。
*/
window.BOARD_LIMITS = {
  className: 20,
  greetingName: 8,
  countdownLabel: 12,
  subjectName: 6,
  homeworkItem: 42,
  homeworkNote: 24,
  todoItem: 24,
  noticeText: 60,
  noticeSign: 16,
  dutyText: 40,
  quoteText: 60,
  quoteSign: 16,
};
