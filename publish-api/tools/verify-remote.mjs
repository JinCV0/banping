// 部署后自检：只读，不改任何数据。指向线上地址或本地地址都行。
// 用法：node tools/verify-remote.mjs https://xxx.up.railway.app
const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/+$/, "");

const CHECKS = [
  { name: "健康检查", path: "/api/v1/health", want: 200 },
  { name: "老师端首页", path: "/", want: 200, contains: "班级看板" },
  { name: "渲染层页面", path: "/board/index.html", want: 200, contains: "board-inner" },
  { name: "渲染层上限脚本", path: "/board/limits.js", want: 200, contains: "window.BOARD_LIMITS" },
  { name: "渲染层配方脚本", path: "/board/layouts.js", want: 200, contains: "window.BOARD_LAYOUTS" },
  { name: "数据契约（公开）", path: "/api/v1/board/schema", want: 200, contains: "board-state" },
  { name: "看板数据无令牌应 401", path: "/api/v1/board/state", want: 401 },
];

let failed = 0;
for (const check of CHECKS) {
  const url = base + check.path;
  let line = "";
  try {
    const res = await fetch(url, { redirect: "manual" });
    const body = await res.text();
    const statusOk = res.status === check.want;
    const bodyOk = check.contains ? body.includes(check.contains) : true;
    const ok = statusOk && bodyOk;
    if (!ok) failed += 1;
    line = `${ok ? "✓" : "✗"} ${check.name}  ${res.status}  ${check.path}`;
    if (!statusOk) line += `  （期望 ${check.want}）`;
    else if (!bodyOk) line += `  （正文里没有 "${check.contains}"）`;
  } catch (error) {
    failed += 1;
    line = `✗ ${check.name}  连不上  ${check.path}  ${error.message}`;
  }
  console.log(line);
}

console.log(failed === 0 ? `\n全部通过：${base}` : `\n${failed} 项失败：${base}`);
process.exit(failed === 0 ? 0 : 1);
