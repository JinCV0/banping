/*
  板块清单（唯一一处"屏上能放什么"）
  ---------------------------------------------------------------
  原则：一个板块一个文件，文件里自己注册渲染函数（Board.defineBlock），
  这里只登记"有哪些块、默认多大、默认开不开"。老师端也读这份清单建"添加磁贴"菜单，
  所以新增板块 = blocks/<type>.js + 这里加一行 + schema 加字段 + 发布端一个编辑卡。

  v3 起没有 main/side/strip：位置由 state.layout.tiles 决定（12×8 网格，见 core/tiles.js）。
    w/h ：老师端点「+ 添加磁贴」时给的默认尺寸（也是建议最小值附近的值）
    on  ：新班级的默认布局里带不带它（真正的落位仍由 BOARD_DEFAULT_TILES / layout 决定）
    desc：老师端菜单里的一句说明
*/
window.BOARD_BLOCKS = [
  {
    type: "homework",
    title: "今日作业",
    w: 7,
    h: 4,
    on: true,
    desc: "按科目发布的作业，每科可带一句通知",
  },
  {
    type: "todo",
    title: "今日待办",
    w: 5,
    h: 2,
    on: true,
    desc: "全班都要知道的事：带东西、集合、活动",
  },
  {
    type: "timetable",
    title: "今日课表",
    w: 5,
    h: 3,
    on: true,
    desc: "按班级周课表自动取今天，标出正在上的那节",
  },
  {
    type: "notice",
    title: "班级通知",
    w: 4,
    h: 2,
    on: true,
    desc: "一段话的通知，带署名",
  },
  {
    type: "duty",
    title: "今日值日",
    w: 4,
    h: 2,
    on: true,
    desc: "手写一句，或按花名册 + 值日规则自动排本周/今日",
  },
  {
    type: "rollcall",
    title: "今日点名",
    w: 3,
    h: 2,
    on: false,
    desc: "显示今天抽到的同学和抽到的时间，超过 24 小时自动消失",
  },
  {
    type: "countdown",
    title: "倒计时",
    w: 3,
    h: 2,
    on: false,
    desc: "距离某个重要日子还有几天，天数由大屏自己算",
  },
  {
    type: "quote",
    title: "每日寄语",
    w: 4,
    h: 2,
    on: false,
    desc: "一段寄语，可带署名",
  },
];

/*
  默认布局：老数据没带 layout 时大屏的兜底（也就是 v2 那 5 块的位置，docs/board-v3.md 第 5 节）。
  发布端不引 core/tiles.js，所以这里单独写一份；两边要一起改，core/tiles.js 的 DEFAULT_TILES 是同一份。
*/
window.BOARD_DEFAULT_TILES = [
  { id: "hw", block: "homework", x: 1, y: 1, w: 7, h: 4 },
  { id: "todo", block: "todo", x: 8, y: 1, w: 5, h: 2 },
  { id: "tt", block: "timetable", x: 8, y: 3, w: 5, h: 3 },
  { id: "duty", block: "duty", x: 1, y: 5, w: 4, h: 2 },
  { id: "notice", block: "notice", x: 5, y: 5, w: 4, h: 2 },
];
