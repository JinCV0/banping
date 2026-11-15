/*
  本地联调用的小工具：把"一个班 + 一份 v3 看板数据 + 一块已配对的大屏"一次性准备好，
  省得手动敲一串 curl。跑完打印班级码 / 登录码 / 大屏扫码地址：

    node tools/demo.mjs                       # 默认 http://127.0.0.1:8787
    node tools/demo.mjs --api http://127.0.0.1:8787 --days 97

  配对方向是「大屏出码、老师手机扫」：
    ① 大屏 POST /api/v1/devices/claim          → 拿 code + pollToken + pairUrl（屏上显示）
    ② 老师 POST /api/v1/devices/bind           → 用 code 把这块屏绑进班级
    ③ 大屏 GET  /api/v1/devices/claim?…        → 轮询换到 deviceToken（只交付一次）
  这个脚本把三步都演一遍，最后用拿到的设备令牌拉一次看板，证明整条链通了。

  注意：每次运行都会新建一个班（服务端没有"班级已存在"的幂等约定）。
*/
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const api = arg("--api", "http://127.0.0.1:8787").replace(/\/$/, "");
const password = arg("--password", "demo1234");
const claimKey = arg("--claim-key", process.env.CLAIM_KEY || "");
const screenName = arg("--screen", "教室希沃");
const days = Number(arg("--days", "97"));

async function call(method, path, body, token) {
  const res = await fetch(api + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return data;
}

function isoDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const pad = (n) => (n < 10 ? "0" + n : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 直接用渲染层那份 v3 样例数据，保证联调看到的就是设计好的版式
const sampleSrc = readFileSync(join(here, "..", "..", "board-web", "state.sample.js"), "utf8");
const sampleWindow = {};
new Function("window", sampleSrc)(sampleWindow);
const state = sampleWindow.BOARD_SAMPLE ?? sampleWindow.BOARD_STATE;
if (!state || state.version !== 3) throw new Error("board-web/state.sample.js 不是 BoardState v3，先更新样例数据");
// 样例里 theme: null 意思是"用默认主题"，但契约里 theme 是 object（要么给全，要么不出现这个键），
// 所以发布前把顶层 null 字段去掉，别让服务端当成类型错误。
for (const key of Object.keys(state)) if (state[key] === null) delete state[key];
// 契约里只写"哪一天考试"，倒计时天数由大屏自己算
if (state.countdown) state.countdown = { ...state.countdown, date: isoDate(days) };

// ① 建班（一钥一班：同一把密钥第二次建班会被 403 挡住，这里给人一句能照着做的提示）
let claimed;
try {
  claimed = await call("POST", "/api/v1/class/claim", {
    className: "高二(3)班",
    ownerName: "张老师",
    password,
    claimKey,
  });
} catch (err) {
  const existing = /班级码 (\d{8})/.exec(String(err.message));
  if (!existing) throw err;
  console.error(`这把密钥已经建过班级（班级码 ${existing[1]}），一把密钥只能建一个班。演示要干净的新班，二选一：`);
  console.error("  · 换一把新密钥：node tools/claim-key.mjs 1");
  console.error("  · 或换一个空库：DB_PATH 指向一个还不存在的文件再起服务");
  process.exit(1);
}
const token = claimed.token;

// ② 班主任发布整份 v3 看板
const published = await call("PUT", "/api/v1/board/state", { state }, token);

// ③ 发一个语文登录码
const teacher = await call("POST", "/api/v1/teachers", { name: "李老师", subject: "chinese" }, token);

// ④ 大屏自己领码（不需要登录）
const claim = await call("POST", "/api/v1/devices/claim", { name: screenName });

// ⑤ 老师手机扫码后绑定（这里直接调接口，等价于扫 pairUrl 那一步）
const bind = await call("POST", "/api/v1/devices/bind", { code: claim.code }, token);

// ⑥ 大屏轮询拿设备令牌（token 只交付这一次）
const poll = await call(
  "GET",
  `/api/v1/devices/claim?claimId=${encodeURIComponent(claim.claimId)}&pollToken=${encodeURIComponent(claim.pollToken)}`,
);
if (poll.status !== "bound" || !poll.deviceToken) throw new Error(`轮询没拿到设备令牌：${JSON.stringify(poll)}`);

// ⑦ 拿设备令牌拉一次看板，确认大屏侧能读到刚发布的版本
const seen = await call("GET", "/api/v1/board/state", undefined, poll.deviceToken);

console.log("班级码 classCode: " + claimed.user.class.code + "（8 位数字）");
console.log("班主任登录:       班级码 + " + password);
console.log("任课老师登录:     班级码 + " + teacher.teacher.loginCode + "（李老师 · chinese）");
console.log("已发布 revision: " + published.revision + "（大屏读到的也是 revision " + seen.revision + "）");
console.log("");
console.log("大屏配对（" + screenName + "）：");
console.log("  配对码:  " + claim.code + "（约 " + Math.max(0, Math.round((Date.parse(claim.expiresAt) - Date.now()) / 60000)) + " 分钟内有效）");
console.log("  扫码地址: " + claim.pairUrl + "（手机打开 → 登录 → 确认绑定）");
console.log("  屏幕码:  " + bind.screenCode + "（老师端「大屏管理」里显示这个）");
console.log("  设备令牌已交付（只交付一次），大屏拿到后自己存起来，别写进日志");
console.log("");
console.log("启动壁纸宿主（不需要 --pair，配对在页面右下角完成）：");
console.log(`  BoardHost.exe --api ${api}`);
