# 大屏看板 v2 设计（契约 / 派生规则 / 配对协议 / 文件职责）

> 本文是 v2 的唯一结构说明。改字段先改这里，再改 schema，再改两端代码。
> 背景：v1 的毛病是"按截图抄卡片"——倒计时手填、课表只有今天 6 节、配对方向反了、
> 发布页七张卡堆一列。v2 的原则只有一句：**每个板块必须有唯一数据来源，没有数据就不渲染。**

## 1 契约：BoardState v2

一份 JSON，渲染端只认它，发布端只写它。`schema/board-state.v2.schema.json` 是机器可校验的版本，
`validate.js` 直接读它（不许两端各抄一份规则）。

| 字段 | 说明 |
| --- | --- |
| `schema` / `version` | 固定 `"board-state"` / `2` |
| `revision` / `updatedAt` | 服务端盖章，客户端传什么都不作数 |
| `class.name` | 班级名，配对卡与离线提示用 |
| `greeting.name` | 称呼（默认"同学们"），时段问候由渲染端按系统时间拼 |
| `subjects[]` | 班级科目表 `{id,name,color}`，作业与课表都引用 id |
| `periods[]` | 节次时间 `{index,start,end}`，用于"当前第几节" |
| `schedule` | 周课表：`{"1":["chinese","math",""], …, "5":[…]}`（1=周一 … 7=周日；`""`=空节） |
| `overrides[]` | 按日期覆盖，三种写法可叠加、`periods` 最优先：`off:true` = 放假不上课；`useWeekday:1..7` = 调休照那一周上；`periods:[科目id…]` = 当天临时换课 |
| `countdown` | `{label,date}`，天数由渲染端按日期算；不填就没有倒计时 |
| `today` | 今日发布：`date` + `homework[]` + `todo[]` + `notice` + `duty` + `quote` |
| `today.homework[].note` | **科目通知**（"明天带字典"），由该科老师自己发 |
| `blocks[]` | 板块开关与落位 `{type,column,order}`，不写则走 manifest 默认 |
| `theme` | 6 个颜色 token，见 themes.js |

示例（节选）：

```json
{
  "schema": "board-state", "version": 2, "revision": 7, "updatedAt": "2026-11-03T09:00:00.000Z",
  "class": { "name": "高二(3)班" },
  "greeting": { "name": "同学们" },
  "subjects": [{ "id": "chinese", "name": "语文", "color": "#e8624a" }],
  "periods": [{ "index": 1, "start": "08:00", "end": "08:45" }],
  "schedule": { "1": ["chinese", "math", ""], "2": ["math", "", ""], "6": ["chinese", "math", "english"] },
  "overrides": [
    { "date": "2026-11-05", "periods": ["math", "chinese"] },
    { "date": "2026-11-14", "useWeekday": 2 },
    { "date": "2026-11-16", "off": true }
  ],
  "countdown": { "label": "期末考试", "date": "2027-01-15" },
  "today": {
    "date": "2026-11-03",
    "homework": [{ "subject": "chinese", "items": ["背《古诗二首》"], "note": "明天带字典" }],
    "todo": ["明天队形表演，穿长裤"],
    "notice": { "text": "周五 15:00 家长会", "sign": "—— 班主任" },
    "duty": { "text": "第三组" },
    "quote": { "text": "不负晨光", "sign": "—— 班主任寄语" }
  }
}
```

## 2 派生规则（全部在渲染端算，服务端不猜时间）

| 派生项 | 规则 |
| --- | --- |
| 今天星期 | `Date.getDay()`，0 → 7（周日） |
| 今日课表 | 先看 `overrides[今天]`：`off` → 放假（"今天放假 · 周X，不上课"）；`useWeekday:N` → 取 `schedule[N]` 并注明"周六上周二的课"；`periods` → 当天替换。都没有才取 `schedule[今天星期]`。**周末没排课就是没课，不拿周一顶** |
| 当前节次 | 用 `periods` 的 start/end 与系统时间比，落在区间内即"进行中"，只做一档强调 |
| 倒计时天数 | 按日历日差（`date - today`，忽略时分秒）；日期已过 → 不渲染 |
| 时段问候 | <6 夜深了 / <12 早上好 / <14 中午好 / <18 下午好 / 其余 晚上好 |
| 作业是不是今天的 | `today.date !== 今天` 时标题写成"11月3日 作业"，不谎称"今日" |

## 3 板块（一个板块 = 一个文件 + manifest 一行）

| type | 落位 | 数据来源 | 空数据时 |
| --- | --- | --- | --- |
| homework | main | `today.homework` | 不渲染 |
| todo | side | `today.todo` | 不渲染 |
| timetable | side | `schedule`/`overrides`（自动） | 不渲染（放假那天渲染"今天放假"） |
| notice | strip | `today.notice` | 不渲染 |
| duty | strip | `today.duty` | 不渲染 |

已删除：`weather`（没有可靠数据源，留着就是假信息）、`hygiene`（并进值日）、`event`（并入按日期的倒计时）。
新增板块的做法：`blocks/<type>.js` 里 `Board.defineBlock(...)` + `blocks/manifest.js` 加一行
+ schema 加字段 + 发布端加编辑卡。**不需要动 board.js。**

## 4 配对协议（方向反过来：大屏显示，老师手机扫码）

```
① POST /api/v1/devices/claim        (无令牌，按 IP 限流)
   body {name?} → 201 {code, claimId, pollToken, expiresAt, pairUrl}
② 大屏右下角渲染：6 位 code + 二维码(pairUrl)，每 2s 轮询
   GET /api/v1/devices/claim?claimId=&pollToken= → {status:"pending"}
                                                 → {status:"bound", deviceToken, screenCode, classId, className}
③ 老师手机扫码 → /pair.html?code=XXXXXX（已是登录态就直接确认）
   POST /api/v1/devices/bind {code}   (auth: user, 仅班主任) → 200 {deviceId, screenCode, className}
④ 大屏拿到 deviceToken 后 postMessage 给宿主，宿主写 cache/device.token 并开始拉取 + 订阅
⑤ 老师端"解除"：POST /api/v1/devices/revoke {deviceId} → 大屏下次请求 401 → 重新显示配对码
```

`pollToken` 只有申请配对码的那块屏知道——别人猜中 6 位码也拿不到 token。
`screenCode` 是设备绑定后常驻右下角的小号屏码，老师在"大屏管理"里靠它认屏。

**一班一屏**：`devices.class_id` 上有唯一索引，`POST /devices/bind` 在班级已有大屏时直接 **409 `DEVICE_LIMIT`**（消息里带旧屏码，`details` 带 `deviceId/screenCode`），**不建记录、也不消费这次 claim**：
老师去「班级」页解除旧屏（`POST /devices/revoke`）→ 旧屏下次请求 401、宿主清 token、重新显示配对码 → 回到配对页再点一次「确认绑定」即可，不用重新扫码（10 分钟窗口内）。
换屏没有"自动顶替"这种捷径：必须由老师显式解除，避免两块屏抢同一个班。

页面 ↔ 宿主消息（WebView2 `chrome.webview.postMessage`）：

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| 宿主 → 页面 | `window.BOARD_HOST = {mode:"host", paired:false, screenCode, className}` | 导航前注入，页面据此决定是否显示配对卡 |
| 页面 → 宿主 | `{type:"board:paired", token, screenCode, classId, className}` | 配对成功，宿主落盘并开始同步 |
| 页面 → 宿主 | `{type:"board:unpair"}` | 设备令牌失效，宿主清 token |

本地预览（h5 里的 iframe）没有 `window.BOARD_HOST`，所以不会显示配对卡。

## 5 班级身份与改名

- **一钥一班**：开通密钥里的班级 UID 由密钥派生（`HMAC(secret, "claim-uid:"+head)` 取前若干字节），存在 `classes.claim_uid`（唯一索引）。
  同一把密钥再次 `POST /api/v1/class/claim` → **403**「这把密钥已经建过班级（班级码 11112222），请用班级码登录」。
  密钥是"卖出去的那张票"，票根只能换一个班；换班要新密钥。
- **改名**：`POST /api/v1/class/rename {name}`（auth: user，仅班主任，≤20 字）→ 返回 `publicUser`。
  服务端在 `GET /api/v1/board/state` 与 `PUT` 时都用 `klass.name` 覆盖 `state.class.name`，
  所以改完名下一次拉取（大屏最迟一个 SSE 周期）就生效，不用重新发布、不用改渲染端。
- 大屏头部日期行与配对卡都读同一个 `class.name`；配对页 `pair.html` 显示 `className` 也用服务端盖过名的值。
- 班级名合法性：1–20 字，去掉首尾空白，不接受换行；前端与 `limits.js` 的 `className` 同源。

## 6 文件职责（避免多人改同一文件）

| 区域 | 文件 | 负责人 |
| --- | --- | --- |
| 契约 | `board-web/schema/board-state.v2.schema.json`、`board-web/limits.js`、`board-web/subjects.js`、`board-web/blocks/manifest.js` | lead |
| 渲染 | `board-web/index.html`、`board.js`、`board.css`、`core/*`、`blocks/*.js`、`pairing.js`、`state.sample.js` | lead |
| 老师端 | `publish-api/public/**` | h5-ui |
| 服务端 | `publish-api/*.js`（不含 public/）、`publish-api/tools/smoke.js` | api-pair |
| 宿主 | `host-m0/*.cs`（`wwwroot/board.html` 已 retire，宿主默认打开 `board-web/index.html`） | host-bridge |

## 7 验收

- `npm start`（publish-api）起得来；建班 → 填课表 → 发布 → 大屏渲染出今天该有的课。
- 同一把开通密钥建第二个班 → 403，提示里带已有班级码；用班级码能正常登录那个班。
- 班主任改名 → 老师端顶栏、大屏日期行、配对页三处同步（不重新发布）。
- 周末：`schedule` 只有周一~周五时，周六打开大屏显示"今天放假 / 周六，不上课"，不是周一的课。
- 调休：把某个周六设成"照周二上"，那天大屏课表 = 周二的课，标题"周六上周二的课"，头部有"调休"小标。
- 大屏未绑定：右下角有码 + 二维码；手机扫码 → 确认 → 屏上卡片消失、开始显示班级内容。
- 一班一屏：班里已有一块大屏时，再扫另一块 → 409 并显示旧屏码；解除旧屏后旧屏立刻回到配对码界面，新屏再点一次确认即可绑定。
- 断开网络：屏上"离线 · 数据到 HH:mm"，恢复后自动补拉。
- 删掉天气/卫生后，底部通栏只剩老师真填的模块；不填就整行塌掉。
- 压力数据（9 科 × 6 条作业）下：面板行不压缩、不叠字；装不下时 `core/pager.js` 每 9s 轮换一页（壁纸层拿不到焦点，不能给滚动条）。
- headless 截图 1920×1080 与 1280×720 各一张，内容不溢出（LESSONS 的量高方法）。
