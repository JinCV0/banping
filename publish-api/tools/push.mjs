/*
  改一处再发布，用来验证"老师一改，大屏立刻变"。

    node tools/push.mjs --class 12345678 --password demo1234 --quote "不负晨光，不负自己" --days 96
    node tools/push.mjs --class 12345678 --login ABC234 --subject 语文 --items "A|B"

  班主任走 --password；任课老师走 --login（班级码 + 6 位登录码）。
  不传 --state 时，在服务端现有数据上原地改（先 GET 再 PUT），
  这样班主任和科任的改动不会互相覆盖。
*/
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const api = arg("--api", "http://127.0.0.1:8787").replace(/\/$/, "");
const classCode = arg("--class");
const password = arg("--password", "demo1234");
const loginCode = arg("--login", null);
const subject = arg("--subject", null);

async function call(method, path, body, token) {
  const res = await fetch(api + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return data;
}

if (!classCode) {
  console.error("用法: node tools/push.mjs --class <8 位班级码> (--password 班主任密码 | --login 任课老师登录码)");
  process.exit(1);
}

const login = loginCode
  ? await call("POST", "/api/v1/auth/teacher-login", { classCode, loginCode })
  : await call("POST", "/api/v1/auth/login", { classCode, password });
const current = await call("GET", "/api/v1/board/state", undefined, login.token);
const state = current.state;

if (!state) {
  console.error("服务端还没有数据，先跑 tools/demo.mjs");
  process.exit(1);
}

function isoDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const pad = (n) => (n < 10 ? "0" + n : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

if (subject) {
  // 科任老师只发自己那科：作业在 today.homework，科目用 subjects[].id 引用。
  // 这里允许 --subject 填中文名或 id（服务端也两种都认），只改自己那一条的 items。
  const homework = Array.isArray(state.today?.homework) ? state.today.homework : [];
  const known = Array.isArray(state.subjects) ? state.subjects : [];
  const subjectId = known.some((s) => s.id === subject)
    ? subject
    : known.find((s) => s.name === subject)?.id ?? subject;
  const mine = homework.find((entry) => entry.subject === subjectId);
  if (!mine) {
    console.error(`这门科不在今天的作业里：${subject}（id: ${subjectId}）`);
    process.exit(1);
  }
  const items = (arg("--items", "") || "").split("|").filter(Boolean);
  mine.items = items;
  const res = await call("PUT", "/api/v1/board/state", { state }, login.token);
  console.log("科任发布成功 revision=" + res.revision + " " + subjectId + ": " + items.join(" / "));
  process.exit(0);
}

const quote = arg("--quote", null);
const days = arg("--days", null);
// 契约只写"哪一天考试"，天数由大屏算；--days 仍然好用：换算成今天 + N 天
if (quote) state.today = { ...(state.today || {}), quote: { ...(state.today?.quote || {}), text: quote } };
if (days !== null) state.countdown = { ...(state.countdown || {}), date: isoDate(Number(days)) };

const res = await call("PUT", "/api/v1/board/state", { state }, login.token);
console.log("发布成功 revision=" + res.revision + " 推送 " + res.pushed + " 块大屏");
