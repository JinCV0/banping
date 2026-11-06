/*
  预设科目表
  ---------------------------------------------------------------
  用途：老师端"班级科目"里勾选，勾中的科目才会出现在作业发布和课表下拉里。
  颜色要同时在墨绿（深底）和纸白（浅底）两套主题上看得清，所以取中等明度、饱和略低。
  自定义科目的 id 由老师端起（拼音或英文），颜色从调色板里挑。
*/
window.BOARD_SUBJECT_PRESETS = [
  { id: "chinese", name: "语文", color: "#e8624a" },
  { id: "math", name: "数学", color: "#5b8ff9" },
  { id: "english", name: "英语", color: "#f0954a" },
  { id: "physics", name: "物理", color: "#8b6cf2" },
  { id: "chemistry", name: "化学", color: "#3fae6a" },
  { id: "biology", name: "生物", color: "#2f9e8f" },
  { id: "politics", name: "道法", color: "#d8536f" },
  { id: "history", name: "历史", color: "#a97b45" },
  { id: "geography", name: "地理", color: "#3f92b8" },
  { id: "science", name: "科学", color: "#4aa2a8" },
  { id: "it", name: "信息科技", color: "#6c7ee1" },
  { id: "pe", name: "体育", color: "#4fc08d" },
  { id: "music", name: "音乐", color: "#cf6fa6" },
  { id: "art", name: "美术", color: "#b57bee" },
  { id: "labor", name: "劳动", color: "#8a9a5b" },
  { id: "class", name: "班会", color: "#e3b23c" },
  { id: "self", name: "自习", color: "#8e9aa6" },
];

/* 自定义科目调色板：和预设同一个明度区间，避免老师挑出扎眼的荧光色 */
window.BOARD_SUBJECT_COLORS = [
  "#e8624a", "#f0954a", "#e3b23c", "#8a9a5b", "#4fc08d", "#2f9e8f",
  "#3f92b8", "#5b8ff9", "#6c7ee1", "#8b6cf2", "#b57bee", "#cf6fa6",
  "#d8536f", "#a97b45", "#8e9aa6",
];
