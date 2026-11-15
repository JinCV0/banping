/*
  配色主题预设（M1.1）
  ---------------------------------------------------------------
  设计取向：不做参考产品的像素克隆，走"一套结构 + 多套配色主题"的差别化路线。
  主题只由 BoardState v1 的 6 个 token 组成（bg/panel/panelInner/accent/text/muted），
  渲染层不认主题名，只认 token —— 以后加主题只改数据，不改 CSS、不改 JS。

  预览：index.html?theme=ink | indigo | paper
  正式使用：发布服务把选中的主题写进 BoardState.theme，优先级高于 URL 参数。
*/
window.BOARD_THEMES = {
  // 墨绿（默认）：深绿底 + 琥珀强调，教室后排也能看清；在 M1 首版基础上压深了底色、
  // 收了一档卡片亮度，和参考产品拉开距离。
  ink: {
    name: "墨绿",
    bg: "#2b4539",
    panel: "#35553f",
    panelInner: "#40634c",
    accent: "#f1bd4e",
    text: "#f5f8f4",
    muted: "#b7c9bd",
  },

  // 黛蓝：夜间/自习室场景，偏冷色，长时间看不刺眼。
  indigo: {
    name: "黛蓝",
    bg: "#1b2a38",
    panel: "#233748",
    panelInner: "#2c455b",
    accent: "#f6c26b",
    text: "#eef4fb",
    muted: "#9db2c6",
  },

  // 纸白：板报质感，适合已经贴了彩纸/绒布的教室；浅底深字，靠强调色撑住层级。
  paper: {
    name: "纸白",
    bg: "#f1ebe0",
    panel: "#ffffff",
    panelInner: "#f7f1e7",
    accent: "#c9803f",
    text: "#2d3a33",
    muted: "#7b8a80",
  },
};
