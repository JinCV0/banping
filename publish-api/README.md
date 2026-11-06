# publish-api — 看板中转服务

零 npm 依赖（`node:http` + `node:sqlite` + `node:crypto`），一个进程 + 一个 SQLite 文件。可以整体搬到你选的任何免费容器上：只要给 `PORT` 和一个能持久化的目录。

## 跑起来

```powershell
node main.js                                        # http://127.0.0.1:8787
$env:PORT="8080"; node main.js                      # 换端口
$env:DB_PATH="D:\data\publish.db"; node main.js     # 换库位置
$env:CLAIM_KEY_SECRET="种子"; node main.js          # 只配种子；密钥在本机用 tools/claim-key.mjs 生成
```

启动日志：`[publish-api] listening http://127.0.0.1:8787  db=...`

冒烟测试（内存库 + 随机端口，129 项，含配对全流程、v3 契约与升级链、登录码、静态页与目录穿越）：

```powershell
node tools/smoke.js
```

## 两个联调工具

| 命令 | 干什么 |
| --- | --- |
| `node tools/demo.mjs --api <url> --claim-key <key> --days 97` | 一条链跑完：建班（带开通密钥）+ 用 `board-web/state.sample.js` 发第一版 + 发一个语文登录码 + 大屏领码/老师绑定/大屏轮询拿令牌 + 用设备令牌回读一次，最后打印班级码、扫码地址与屏幕码 |
| `node tools/push.mjs --class <班级码> --password <密码> --quote "..." --days 96` | 班主任在现有数据上改一处再发布，验证大屏是否立刻跟着变 |
| `node tools/push.mjs --class <班级码> --login <6 位登录码> --subject 语文 --items "A\|B"` | 任课老师只发自己那科 |

## 角色与权限

| 角色 | 怎么来 | 能做什么 |
| --- | --- | --- |
| owner（班主任） | `POST /api/v1/class/claim` 用开通密钥建班 | 全量发布、改班级名、生成任课老师登录码、绑定/解绑大屏 |
| member（任课老师） | 班主任在发布页填姓名+科目生成 6 位登录码，老师用「班级码 + 登录码」登录 | 只能发自己那科的 `today.homework` 条目 |
| device（大屏） | 自己领码 + 老师手机扫码绑定，轮询换到 token | 只读：拉数据、订阅推送；发布一律 401 |

口令只有班主任有（建班时设，`<6` 位拒绝）；任课老师没有口令，靠登录码。登录码长期有效、可重复登录，丢了或换人由班主任「换码」轮换、「收回」作废。设备 token 也是长期有效，存在宿主 `cache/device.token`；老师会话 7 天过期。

**一班一屏**：一个班同时只能绑一块大屏（`devices.class_id` 上有唯一索引）。班里已经有屏时，再扫码绑定会返回 409 `DEVICE_LIMIT`（message 里带已有屏码，`details` 带 `{deviceId, screenCode}`），那个配对码不会被消费，还能留给大屏下次轮询。换屏必须先「解除」原来那块（`POST /api/v1/devices/revoke`，或旧屏自己 `DELETE /api/v1/devices/self`），解除后旧 token 立即 401、可以再绑新屏。老库升级时启动会自动去重（同班保留 `created_at` 最新的一条，其余连同配对记录删掉）再补唯一索引，重复启动幂等。

## 开通密钥：本机生成，服务端只验规律

服务器只有一串种子（环境变量 `CLAIM_KEY_SECRET`），**不存任何发出去的密钥**；密钥的规律写在 `claim.js` 里：

```
CB-XXXX-XXXX-XXXX-XXXX       10 字节 = 随机(5) + 签名(5)
                             签名 = HMAC-SHA256(种子, "class-board/claim/v3:" + 前 5 字节)[0..5]
```

**密钥本身不带时间**。有效期是"这个班"的属性：建班那一刻，服务器往 `classes.expires_at` 写 `今天 + LICENSE_DAYS`（默认 365 天）。所以同一把密钥今天用还是明年用，建出来的班都是满一年；密钥也不会因为放着没用而过期。

到期之后：登录、看数据、导出都照旧，**只有"发布到大屏"停掉**，返回 403「班级服务已到期（YYYY-MM-DD），续期后才能继续发布」。

### 一钥一班：密钥是票，票根只能换一个班

每把密钥在服务端都能算出唯一一个班级 UID（`claimUidOf`：`HMAC-SHA256(种子, "claim-uid:" + 密钥 10 字节)` 取前 9 字节转 base32，形如 `uid_1VNVDF1X675H4FR`）。建班时把 uid 写进 `classes.claim_uid`，并加一个部分唯一索引（`WHERE claim_uid IS NOT NULL`）。于是：

- **同一把密钥第二次建班 → 403 `CLAIM_TAKEN`**「这把密钥已经建过班级（班级码 12345678），请用班级码登录」，`error.details.classCode` 带已有班级码；和「密钥无效」（`FORBIDDEN`）是两个不同的 code，前端可以分开提示。密钥（票）可以丢，班级（票根）还在，找回走班级码。
- 想开第二个班，得**换一把新密钥**（重新发）。
- 密钥本身不带时间，有效期仍跟着班级走；uid 是独立的域分隔 HMAC，和验签互不干扰（知道 uid 推不出签名，反之亦然）。
- 老库升级：启动时自动补 `classes.claim_uid` 列并 `CREATE UNIQUE INDEX ... WHERE claim_uid IS NOT NULL`，二次启动幂等。升级前建的老班级 `claim_uid` 为 `NULL`，不占位——那把密钥升级后还能再建一次班，之后就被锁住了。想把老班也堵死，部署后跑一次回填（见下）。

给老库回填票根（可选，但建议做）：服务端不存明文密钥，所以要你提供「班级码 ↔ 当初那把密钥」的清单，一行一个，`#` 开头是注释：

```text
# uid-list.txt
12345678,CB-A1B2-C3D4-E5F6-G7H8
87654321,CB-1234-5678-9ABC-DEFG
```

```powershell
# 在 publish-api 目录下；种子用 --secret 或 CLAIM_KEY_SECRET
node tools/backfill-claim-uid.mjs --db data/publish.db --list uid-list.txt --dry-run   # 先看一眼
node tools/backfill-claim-uid.mjs --db data/publish.db --list uid-list.txt
```

输出 `成功 N 条 / 跳过 M 条 / 失败 K 条`；已经回填过的记为「跳过」，所以重复跑是安全的。找不到班级码、密钥格式不对、uid 已经占给别的班都算失败（不覆盖），有失败时退出码 1 并在 stderr 列出明细。

改班名：`POST /api/v1/class/rename {name}`（只有班主任，1–20 字）。班名只存在 `classes` 里，发布数据里的 `class.name` 由服务端在 PUT/GET 时覆盖，所以**改完不用重新发布**，大屏下一次拉取就是新名字。

两种发法，算法完全一样（都引 `claim.js`）：

```powershell
# 命令行（唯一入口）
node tools/claim-key.mjs --init                     # 生成种子（服务器只存这一串）
node tools/claim-key.mjs --key --secret <种子>       # 发一把密钥
node tools/claim-key.mjs --key                      # 用 CLAIM_KEY_SECRET 环境变量发
```

生成器在本机 `tools/` 下（部署脚本只推 `board-web` 与 `publish-api`，不把它带到服务器）。没配种子时建班返回 403「服务端没有配置开通密钥的种子（CLAIM_KEY_SECRET）」。

## 接口

| 方法 | 路径 | 谁 | 作用 |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | 公开 | 探活 |
| POST | `/api/v1/class/claim` | 公开 | 建班（要 `claimKey`）+ 班主任会话，返回 8 位数字班级码；同一把密钥只能建一个班（二次 403） |
| POST | `/api/v1/class/rename` | owner | 改班级名：body `{name}`（1–20 字）→ `{user}`；改完不用重新发布 |
| POST | `/api/v1/auth/login` | 公开 | 班主任登录：8 位班级码 + 口令 |
| POST | `/api/v1/auth/teacher-login` | 公开 | 任课老师登录：8 位班级码 + 6 位登录码 |
| POST | `/api/v1/teachers` | owner | 建/取任课老师，返回他的 6 位登录码（同名复用并轮换） |
| POST | `/api/v1/teachers/code` | owner | 轮换某位老师的登录码（旧的立刻作废） |
| DELETE | `/api/v1/teachers/code` | owner | 只收回登录码，人留着 |
| GET | `/api/v1/me` | 用户 | 自己 + 同班老师（含登录码，仅 owner 可见；每人带 `createdAt`，按建号先后升序）+ 已绑大屏（含 `screenCode`） |
| GET | `/api/v1/board/state` | 用户/设备 | 拉当前数据（没发布过时 revision=0、state=null） |
| PUT | `/api/v1/board/state` | 用户 | 发布（owner 全量 / member 本科目合并） |
| GET | `/api/v1/board/schema` | 公开 | 返回 BoardState v3 JSON Schema，给前端即时校验 |
| GET | `/api/v1/board/events` | 用户/设备 | SSE，`event: revision` |
| POST | `/api/v1/devices/claim` | 公开 | 大屏领 6 位配对码，返回 `{code,claimId,pollToken,expiresAt,pairUrl}`（按 IP 限流） |
| GET | `/api/v1/devices/claim?claimId=&pollToken=` | 公开 | 大屏轮询：`pending` / `bound`（交付设备 token）/ `used`；过期或凭据不对 410 |
| POST | `/api/v1/devices/bind` | owner | 老师手机扫码后绑定：body `{code}` → `{deviceId,screenCode,className}`；班里已有屏时 409 `DEVICE_LIMIT`（一班一屏，换屏先解除） |
| POST | `/api/v1/devices/revoke` | owner | 解绑某块大屏：body `{deviceId}`；大屏下次请求 401，之后才能绑新屏 |
| DELETE | `/api/v1/devices/self` | 设备 | 大屏自解绑 |

`user.class` 是 `{ id, name, code }`，`code` 就是班主任要发给任课老师的 8 位班级码。

错误统一 `{ "error": { "code", "message", "details" } }`：`BAD_REQUEST` / `UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND` / `CONFLICT`（含 `STALE`、`NAME_TAKEN`）/ `BODY_TOO_LARGE` / `BAD_JSON`。

`PUT /api/v1/board/state` 的 body：`{ state, ifRevision? }`。`revision` 与 `updatedAt` 一律由服务端覆盖，客户端传什么都不算；`state.class` 也由服务端按班级名覆盖。`ifRevision` 不匹配返回 409 并带上当前 revision。

## 大屏配对（大屏出码，老师手机扫）

方向是「大屏显示、老师扫」，老师端不再生成也不分发配对码：

1. 大屏调 `POST /api/v1/devices/claim`（无需登录，body 可带 `{name}`），拿到

   ```json
   { "code": "R86C8W", "claimId": "pcl_...", "pollToken": "...", "expiresAt": "2026-11-03T12:12:27.942Z", "pairUrl": "https://<host>/pair.html?code=R86C8W" }
   ```

   屏幕右下角只显示 `code`（`pairUrl` 二维码）；`pollToken` 留在本机内存/存储里，绝不显示。

2. 老师手机打开 `pairUrl`（`/pair.html?code=R86C8W`），登录后 `POST /api/v1/devices/bind`：

   ```json
   { "code": "R86C8W" }   →   200 { "deviceId": "dev_...", "screenCode": "S83H4Z", "className": "高二(3)班" }
   ```

   只有班主任（owner）能绑。设备 token 不发给手机。**一班一屏**：班里已经绑过屏时这里是 409 `DEVICE_LIMIT`，`message` 带已有屏码、`details` 带 `{deviceId, screenCode}`，配对码不会被消费；要换屏先去「班级」页解除原来那块。

3. 大屏每 2 秒 `GET /api/v1/devices/claim?claimId=...&pollToken=...`：
   - `200 {"status":"pending"}` 还没人扫；
   - `200 {"status":"bound","deviceToken":"...","screenCode":"S83H4Z","classId":"...","className":"..."}` 绑定成功，**token 只交付这一次**，之后 `200 {"status":"used"}`；
   - `410 {"error":{"code":"CLAIM_GONE"}}` 过期（默认 10 分钟，`CLAIM_TTL_MINUTES`）、凭据不对或已被解绑 —— 重新领码。

4. 解绑：老师端 `POST /api/v1/devices/revoke {deviceId}`（或旧屏自己 `DELETE /api/v1/devices/self`），大屏的 token 立刻失效（下次请求 401），回到第 1 步重新显示配对码。一班一屏，所以"换大屏"就是先解除旧屏、再扫新屏的码。

`pollToken` 是用来防「别人猜中 6 位码」的：光有码只能等老师扫，拿不到 token。领码按 IP 限流（默认 5 次 / 10 分钟，`CLAIM_RATE_LIMIT` / `CLAIM_RATE_WINDOW_MINUTES`），同时待配对的大屏上限 2000（`CLAIM_PENDING_MAX`），过期未绑定的记录在下次领码时顺手清掉。

## 校验

Schema 只有一份：`../board-web/schema/board-state.v3.schema.json`（BoardState v3）。发布前服务端按它校验，**校验规则不在这里另抄一遍**（渲染层的 `LIMITS` 与 schema 的 `maxLength` 已对齐，改一处要同时改另一处）。

v3 相对 v2 的变化：版面从"三栏 blocks"改成 **12×8 磁贴布局** `layout.tiles[]`（`block` 是板块类型、`x/y/w/h` 是左上角与宽高，越界由渲染端裁，校验器只查单字段范围）；新增 `roster.students[]`（花名册，`id` 稳定用于点名）、`duty`（值日规则：`weekly`/`daily`/`off` + 每轮人数 + 起算日）、`today.call`（点名结果）。`today.duty.text` 还在，是"今天谁值日"的展示值；值日规则用来算出它。

## 升级注意（v1 → v2 → v3）

- **旧接口已删除**：`POST /api/v1/devices/pair-code`、`POST /api/v1/devices/pair` 现在返回 404，老师端不再生成/分发配对码；配对看上面「大屏配对」。
- **老表 `pair_codes` 只留结构**：代码不再读写它，服务启动也不会迁移或清空。回滚窗口过后可以手工清掉：`sqlite3 data/publish.db "DROP TABLE pair_codes;"`。`pair_claims` 是新表，解绑即删、过期在下次领码时顺手清理。
- **老设备补屏幕码**：v1 配对建立的设备没有 `screen_code`，启动时自动补一个（班内唯一、幂等，重启不会变），老师端「大屏管理」不会出现空屏码。
- **`theme` 要么给全、要么别出现这个键**：v2 schema 里 `theme` 是 object，发 `theme: null` 会被 400 拒绝（渲染层样例里的 `theme: null` 表示"用默认主题"，发布前请把该键删掉）。
- **宿主不再需要 `--pair`**：配对改由页面右下角显示码/二维码完成，宿主只负责接收页面 postMessage 给的设备令牌。
- **老快照自动升级（`migrate.js`，2026-11-05 加）**：启动时按版本逐级升到 v3 —— `v1 → v2 → v3` 一次跑完。v1 那半段：科目从 `homework.subjects` + `timetable.items` 合并去重（未知科目给 `s1..`，颜色保留）、`periods` 按 v1 最大节次配常规作息、v1 那一天课表落到 `date.text` 写的星期（没有就用 `updatedAt` 那天）、倒计时 `days` 按 `updatedAt` 还原成日期、问候剥掉时段只留称呼、`weather/hygiene/event` 直接丢掉、底部"值日 + 通知"补回 `blocks`（strip 栏）。v2 那半段见下一条。升级算一次内容变更 → **总共 `revision + 1`**（不是每级各加 1），在线大屏会收到推送重拉。**幂等**：已经是 v3 的直接跳过，第二次启动不会动它；升级后过不了校验的快照保持原样并打日志，不会把数据改坏。
- **v2 的 `blocks` 换成 v3 的 `layout.tiles`（`upgradeV2ToV3`）**：按"老样子"的落位换成 12×8 磁贴 —— 作业 `1,1 7×4`、待办 `8,1 5×2`、课表 `8,3 5×3`、值日 `1,5 4×2`、通知 `5,5 4×2`（坐标由 lead 在 `docs/board-v3.md` 定的；课表和值日/通知在第 5 行有 1 格重叠，照这个模板不动）。v2 里写了哪些 `blocks` 就只给哪几块；**一块都没写过的老班补成五块全给**（内容空着时渲染端不画那个磁贴，不会留白框）。升级后 `blocks` 字段被移掉，`today.duty.text` 原样保留。倒计时/寄语在 v2 里不在 `blocks` 的枚举里，所以不给磁贴 —— 想要就在老师端「班级」屏自己加。
- **PUT 只收 v3**：`version` 不是 3 的报文一律 400（提示 `看板数据不符合 BoardState v3 契约`），客户端旧版缓存需要刷新页面重新取 schema。
- **v1 只有"那一天"的课**：升级后只有那个星期有课表，其余日子渲染成"没有排课"（课表块不显示）。上线后请老师在「课表」页把一周填满。
- **值日/花名册/点名是可选字段**：老快照升上来没有 `roster`、`duty`、`today.call`，仍然合法；老师端第一次打开花名册再保存就会有。

## 老师端 h5（同源静态页，无构建）

同一个进程既发接口也发页面，打开 `http://<host>:<port>/` 就是老师端：

| 路径 | 内容 |
| --- | --- |
| `/` | 老师端 h5（`public/`） |
| `/board/` | 看板渲染层（`../board-web/`，预览 iframe 直接用） |
| `/api/v1/*` | 接口 |

三屏：**登录**（首屏只有「创建班级」「进入班级」；进入再分班主任 / 任课老师）→ **今日 / 课表 / 班级 / 分享**四段导航。桌面端右栏常驻 16:9 真实预览，改一个字 350ms 内同步到大屏预览；≤1100px 预览收成弹层。另有扫码绑定页 `/pair.html?code=XXXXXX`，手机扫码后登录确认即可绑屏；任课老师免登入口 `/join.html?c=<班级码>&k=<登录码>`（分享页给的链接就是这个，点开直接进他自己那一科）。

建班成功后弹一次「凭证卡」：大字班级码 + 一键复制 + 「班级码和密码都存好，丢了只能凭开通密钥重建」。班级名之后在「班级」屏随时改，改完大屏自动跟着变（服务端 GET state 时用 `classes.name` 覆盖）。

| 文件 | 职责 |
| --- | --- |
| `public/index.html` | 骨架：顶栏、分段导航、四段屏、右侧预览栏 |
| `public/app.js` | 装配：会话恢复、切 tab（`?tab=`）、保存条、toast |
| `public/api.js` | 接口唯一入口（带令牌、剥错误体） |
| `public/login.js` | 首屏两个入口 + 三条登录表单（建班 / 班主任 / 任课老师）+ 建班后的凭证弹窗 |
| `public/modal.js` | 页面内模态（凭证卡、确认框），Esc / 遮罩 / 按钮都能关 |
| `public/clipboard.js` | 复制封装（Clipboard API 失败回退 `execCommand`） |
| `public/share.js` | 分享屏：新增任课老师、每人的免登链接 + 二维码 + 邀请文案、换码 / 收回 |
| `public/join.html` + `public/join.js` | 任课老师免登入口：`?c=&k=` 自动登录进今日屏；身份冲突时给一键切换 |
| `public/state.js` | 客户端草稿：拉取、规范化、脏标记、`clean()` 供预览 |
| `public/today.js` | 今日屏：看板日期、倒计时、每科作业 + 科目通知、待办、通知、值日、寄语 |
| `public/schedule.js` | 课表屏：节次时间、周一~周日 × 节次网格、校历与调休、临时换课 |
| `public/settings.js` | 班级屏：班级信息、科目表、主题、板块落位 |
| `public/team.js` | 任课老师登录码（发 / 换 / 收）与教室大屏管理（解绑） |
| `public/form.js` | 表单零件（卡片 / 字段 / 字数提示 / 行编辑器 / 分节） |
| `public/preview.js` | 右栏预览：调 iframe 里的 `window.BOARD_APPLY` |
| `public/pair.html` + `public/pair.js` | 扫码绑定页：登录 → 确认绑定 → 显示屏码 |

共用脚本不另抄：页面引 `/board/limits.js`、`/board/subjects.js`、`/board/themes.js`、`/board/layouts.js`、`/board/blocks/manifest.js`，字数上限、科目预设、主题、配方、板块清单都只有一份。

权限差异：班主任看到全部字段；任课老师只看到自己那一科，保存时服务端 `mergeSubjectEdit` 也只落 `today.homework` 里自己那一条（`items` + `note`，没带 `note` 就保留原样），别的科目、课表、通知、寄语一律沿用上一版。科目按 `state.subjects[].id` 匹配（老师账号里存名字也认）。保存带 `ifRevision`，别人先改了会 409，界面自动刷新到最新版再让改。

## 部署

本仓库不带托管配置：自己准备一台能跑 Node 20+ 的机器、一层反向代理（nginx / Caddy 都行，注意 SSE 别缓冲），再按下面的环境变量起进程。

用 systemd 直接跑（机器上已有 nginx 时）也一样，只要给进程三个环境变量：`HOST=127.0.0.1`、`PORT=8787`、`DB_PATH=<持久目录>`，再加 `CLAIM_KEY_SECRET`（开通密钥的种子，见上面「开通密钥」一节）。

跑起来的资源占用（本机 Node 24 实测，可直接当容量依据）：

| 场景 | 常驻内存 | 句柄 |
| --- | --- | --- |
| 空转 | ~67 MB | 241 |
| 100 块大屏 SSE 全挂着 | ~77 MB | 341 |
| 连接断开后 | ~70 MB（不积累） | 241 |

不停服备份（`VACUUM INTO`，不要直接 cp 有 WAL 的库）：

```bash
node tools/backup.mjs data/publish.db backups/publish-$(date +%F).db
```

### 备选：Railway

仓库根已有 `Dockerfile`、`railway.json`、`.dockerignore`，Railway 认这些文件，不需要在面板里填构建命令。

镜像钉在 `node:24-slim`：`node:sqlite` 在 Node 22.5 起要 `--experimental-sqlite`，22.13 起才不需要 flag，钉一个确定版本比赌平台默认版本稳。

必须设的两个变量：

| 变量 | 值 | 为什么 |
| --- | --- | --- |
| `DB_PATH` | `/data/publish.db` | 指向挂载卷，否则每次重新部署全班配置蒸发 |
| `HOST` | `0.0.0.0` | 容器里监听回环地址，平台健康检查连不上（`config.js` 检测到 `RAILWAY_ENVIRONMENT` 会自动兜底，但显式写更稳） |
| `CLAIM_KEY_SECRET` | 本机 `tools/claim-key.mjs --init` 打印的那串 | 开通密钥的种子；不配就没人能新建班级 |
| `LICENSE_DAYS` | 可选，默认 `365` | 建班时写进班级的服务期（天） |

`PORT` 由平台注入，不要手填。卷挂到 `/data`（服务 → Volumes → New Volume → Mount path `/data`）。

部署后自检（只读，不改数据）：

```powershell
node tools/verify-remote.mjs https://<域名>
```

七项检查：健康检查、老师端首页、渲染层页面、`limits.js`、`layouts.js`、公开契约、无令牌拉看板应 401。

其它平台的共同要求：

1. 启动命令就是 `node main.js`，无构建步骤、无 npm 依赖、无原生编译。
2. 必须能设 `HOST=0.0.0.0`、`PORT`、`DB_PATH`，并挂持久卷。
3. 反代关闭对 SSE 的缓冲（已发 `x-accel-buffering: no`；Caddy 要 `flush_interval -1`，Nginx 要 `proxy_buffering off`）。心跳 25 秒一次，空闲连接不会被反代掐断。
4. 只能跑一个实例：SQLite 单写者 + 卷不可能同时挂到两个容器；老师端与大屏共享同一个域名，SSE 连接表都在进程内存里，多实例会看到"有时在线有时离线"。
