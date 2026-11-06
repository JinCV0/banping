# board-web：看板渲染层（v3 · 12×8 磁贴）

纯静态页，只做一件事：把一份 `BoardState v3` 画成教室大屏。**不联网、不判断业务、不存数据**——所有内容（课表、作业、倒计时天数、科目颜色、谁值日）都由数据传入，换数据只需要换一份 JSON，不重发页面。唯一的例外是屏幕时钟：它自己走（见「时钟」）。

契约与派生规则见 [`docs/board-v3.md`](../docs/board-v3.md)；这份 README 只讲渲染层怎么组织。

## 一条硬规则

**磁贴没有数据就不渲染。** 没有待办 → 待办磁贴整个不出现，不摆"暂无待办"的占位卡（它原来的格子就空着，老师端可以再摆别的块）。屏幕上出现的每一块，都能回答"数据从哪来、谁什么时候维护一次"。

## 版面：12×8 网格

`state.layout` 是唯一的落位来源：

```json
"layout": {
  "cols": 12, "rows": 8,
  "tiles": [
    { "id": "hw", "block": "homework", "x": 1, "y": 1, "w": 7, "h": 4 },
    { "id": "call", "block": "rollcall", "x": 11, "y": 5, "w": 2, "h": 2, "flip": "off" }
  ]
}
```

- `x/y` 从 1 开始，左上角是 `1,1`；渲染成 `grid-area: y / x / span h / span w`。
- **越界或非法磁贴直接不画**：schema 只查单值范围（x 1..12、w 1..12），`x=8,w=7` 能过校验但会顶出网格，渲染端负责裁掉。不认识的 block、非整数的 x/y/w/h 也跳过。
- 磁贴可重叠，`tiles` 里靠后的压在上面（老师端保存前会拦重叠，这里只负责按数组顺序叠）。
- `title` 覆盖块默认标题（≤8 字）；`flip: "off"` 关掉这块的 9s 翻页（老师端明确不想轮播的块，比如倒计时）。
- 没有 `layout`（老数据 / 发布端还没迁移）→ 用 `BOARD_DEFAULT_TILES` 的老样子模板兜底，不白屏；有 `layout` 但一块都摆不下 → 屏幕中间显示"布局里没有能画的磁贴"，不假装有内容。

头部（问候 / 日期 + 调休小标 / 时钟）固定，不占网格；左侧 32.4% 仍然让给桌面图标列。

## 磁贴的几种"说法"（skin）

版面不是"八个一样的卡片"。每块磁贴由板块在 `defineBlock` 里声明一种 `skin`，`board.js` 写到 `data-skin` 上，样式全在 `board.css`——**同一套卡片、不同的说话方式**：

| skin | 谁用 | 长什么样 |
| --- | --- | --- |
| `list` | 作业 | 科目色块 + 一条条编号的清单，不折行吃字 |
| `timeline` | 课表 | 左边的节次时间 + 科目圆点 + 科目，正在上的那节整行点亮 |
| `checklist` | 待办 | 描边圆圈编号 + 竖连线，读作"要一条条勾掉的清单" |
| `roster` | 值日 | 名字胶囊（色点 + 姓名），右下角「第 N 组 · 共 M 组」 |
| `announce` | 通知 | 左边一条金竖线 + 正文 + 右下角落款，像贴出来的通知单 |
| `spotlight` | 倒计时、点名 | **不要标题栏**，整块只放一个大数字 / 一个大名字 |
| `quote` | 寄语 | **不要卡片底**，一个大引号 + 一句话 + 落款，像写在墙上 |

规则：`spotlight` 和 `quote` 的标题栏由 CSS 隐藏（`[data-skin="spotlight"] .tile-head { display:none }`），所以这两类板块的 `render()` 里 `title` 只用于"老师端认得出这是哪块"，屏上不出现。新增板块时先想"它该怎么说话"，再写 `render()`。

## 磁贴尺寸档位

字号是"磁贴内基准"：`.tile` 的 `font-size` 由 `data-size` 给，磁贴内部所有尺寸一律用 `em`。同一套板块样式，放进 2×2 和 7×4 都按比例缩，不用给每种尺寸写一份 CSS。

| 档位 | 判定（`core/tiles.js` 的 `sizeOf`） | 1920 下基准字号 |
| --- | --- | --- |
| `xl` | 面积 ≥ 28 且 w ≥ 7、h ≥ 4（如 7×4） | `clamp(20px, 1.55vw, 36px)` |
| `lg` | w ≥ 6 或 h ≥ 5 或面积 ≥ 15 | `clamp(18px, 1.35vw, 30px)` |
| `md` | w ≥ 5 或 h ≥ 4 或面积 ≥ 9 | `clamp(16px, 1.18vw, 26px)` |
| `sm` | w ≥ 3 或 h ≥ 3 或面积 ≥ 4 | `clamp(14px, 1.02vw, 22px)` |
| `xs` | 其余 | `clamp(12px, 0.88vw, 18px)` |

两条额外压档：`h = 1` 的通条最多 `sm`；`h = 2` 的块不给 `xl`。`xs` 会省掉标题前的色条，把宽度让给文字。

### 每块磁贴的最小可用尺寸

`core/tiles.js` 的 `MIN`（老师端加磁贴/拉大小时应该按它拦；渲染端不拦，只降级）：

| block | 最小尺寸 | 理由 |
| --- | --- | --- |
| `homework` | 4×2 | 一页至少放下 1 科；再窄色块会把正文挤没 |
| `timetable` | 3×3 | 两列格子，8 节要 4 行 |
| `todo` | 3×2 | 三行文字 |
| `notice` | 3×2 | 两行正文 |
| `duty` | 3×2 | 4 个名字换行 |
| `rollcall` | 2×2 | 名字大字 + 时间 |
| `countdown` | 3×2 | 大数字 + 标签 + 日期 |
| `quote` | 3×2 | 两行寄语 |

**"小磁贴装不下"的结论**：小于最小尺寸不是画不出来，是"一页只能看到一条，全靠 9s 翻页"——3×2 的作业磁贴一页一科还能读，2×1 就只剩标题和半行了。所以渲染端的策略是**降级但不拒绝**（降字号 → 分页 → 裁掉），老师端应该按上表拦；`BoardTiles.MIN` / `BoardTiles.minOf(type)` 已经暴露给发布端用。值日磁贴在 `w ≤ 3` 时会把名字从色块换成一句"张三 · 李四"，也是同一套降级思路。

## 文件

| 路径 | 作用 |
| --- | --- |
| `index.html` | 骨架：header（问候/日期/时钟）+ `<main class="tiles" id="tiles">` + 离线条 + 配对卡 |
| `board.css` | 全部尺寸用 `vw/vh` + 磁贴内 `em`，1920×1080 为设计基线；`.board-inner` 左侧留 32.4% 给桌面图标列 |
| `board.js` | 装配层：取数据 → 按 `layout.tiles` 逐个调板块渲染 → 建磁贴 → 溢出收紧 → 起跑马灯/分页 → 每秒走钟。**不含任何具体板块的排版** |
| `core/tiles.js` | 纯函数：tile 校验（越界/非法/不认识的块）、`grid-area`、字号档位、最小尺寸表、无 layout 兜底 |
| `core/registry.js` | 板块注册表 `Board.defineBlock({type,title,render})` + 小工具（`el/clamp/scrollLine/wrapLine/limits`） |
| `core/resolve.js` | 派生：星期几、今天该上哪几节、当前第几节、倒计时天数、时段问候。**渲染层所有"算"都在这里** |
| `core/scroll.js` | 单行放不下才横向跑马灯（55px/s、两端各停 1.4s） |
| `core/pager.js` | 磁贴装不下就分页轮播（9s 一页，每块磁贴各跑各的；`flip:"off"` 跳过） |
| `blocks/manifest.js` | 板块清单：`{type,title,w,h,on,desc}` + 默认布局 `BOARD_DEFAULT_TILES`；发布端读它建"添加磁贴"菜单 |
| `blocks/*.js` | 一个板块一个文件：`homework / todo / timetable / notice / duty / rollcall / countdown / quote` |
| `limits.js` | 字数上限的唯一口径（老师端与 schema 的 `maxLength` 都对齐它） |
| `subjects.js` | 17 个科目预设（id + 中文名 + 颜色）+ 15 色调色板 |
| `themes.js` | 配色主题：墨绿 / 黛蓝 / 纸白（各 6 个 token） |
| `layouts.js` | **v3 起退役**：v2 的"版面配方"由老师端 layout 取代。文件留着给老书签，`index.html` 不再加载，`?layout=` 不再生效 |
| `pairing.js` | 未绑定的屏在右下角显示配对码 + 二维码，轮询配对结果并交给宿主 |
| `state.sample.js` | 本地样例（v3：8 块磁贴 + 6 人花名册 + 值日规则 + 一次点名） |
| `vendor/qrcode.js` | `qrcode-generator@1.4.4`（MIT），只用于配对二维码 |
| `schema/board-state.v3.schema.json` | BoardState v3 契约 |

脚本顺序固定：`limits` → `subjects` → `themes` → `core/*`（registry → resolve → scroll → pager → tiles）→ `blocks/manifest` → `blocks/*` → `state.sample` → `vendor/qrcode` → `pairing` → `board.js`（`board.js` 最后装配，前面任何一个缺失都会先在控制台报出来）。

## 数据怎么进来

```js
window.BOARD_STATE = { /* 符合 schema/board-state.v3.schema.json */ };
```

- 壁纸宿主在导航前把缓存/刚拉到的数据注入成 `window.BOARD_STATE`；没注入时退回 `window.BOARD_SAMPLE`（本地预览）。
- 运行时热替换走 `window.BOARD_APPLY(next)`：清空网格 → 重画 → 返回 `true`。**不重载页面**（壁纸刷新会闪白）。
- 离线标记走 `window.BOARD_LINK({online, staleAt})`：`online:false` 时左上角显示「离线 · 数据到 HH:MM」。
- 令牌失效时宿主调 `window.BOARD_PAIR_RESET()`：配对卡重新出现、重新领码。

样例文件必须是 `window.BOARD_STATE = ...` / `window.BOARD_SAMPLE = ...`，不能写 `const`——后者不挂到 `window` 上，`board.js` 取不到（v1 时踩过）。

板块的 `render(ctx)` 拿到 `{ state, now, d, tile }`：`d` 是派生数据，`tile` 是这块的格子（`w/h/size/flip`），块可以按尺寸决定要不要换紧凑写法（值日就是这么做的）。

## 值日怎么算

优先 `today.duty.text`（老师手写一句，v2 老字段继续有效）。没写才按花名册 + 规则算：

- `roster.students` 按数组顺序、每 `duty.size` 人一组（最后一组可以不满）；`mode: "off"` 或没有花名册 → 不出现。
- `weekly`：组号 = `floor(从 anchor 起经过的天数 / 7) % 组数`；`daily`：组号 = `经过的天数 % 组数`。负数取模会补正（anchor 在未来也不会算出负组号）。
- `anchor` 缺省用**当年 9 月 1 日**（开学）。
- 磁贴上显示「本周值日 / 今日值日」+ 名字（宽磁贴用色块，`w ≤ 3` 用一句）+「第 N 组 · 共 M 组」。

## 点名 / 倒计时 / 寄语

- **点名** `today.call {name, at?}`：`at` 到当前时间超过 24 小时 → 整块不出现（早读抽的人，晚自习不该还挂着）；`at` 缺失或写坏 → 只显示名字，不算过期。显示名字大字 +「今天 HH:MM 抽到」。
- **倒计时** `state.countdown {label, date}`：天数由 `core/resolve.js` 的 `countdownOf()` 算日历日差，过期不显示；磁贴里是「大数字 + 天 + 标签 + 日期」。数据为空 → 不出现。
- **寄语** `today.quote {text, sign}`：从 v2 的页脚搬进磁贴，最多折 3 行。

## 时间是怎么"自动"的

全部在 `core/resolve.js` 的 `derive(state, now)` 里，`board.js` 只负责画：

| 派生量 | 规则 |
| --- | --- |
| `dateKey` / `dateCn` | 系统日期；`11月3日 周二` |
| `weekday` | 1 周一 … 7 周日（周末照 `schedule["6"]/["7"]` 取课；没排课就是"今天休息"，不拿周一顶） |
| `plan` | 先看 `overrides[date]`：`off:true` → 放假；`useWeekday:N` → 照周 N 上（调休）；`periods:[…]` → 当天临时换课。都没有才取 `schedule[weekday]`；末尾空节自动去掉 |
| `plan.badge` | 头部日期后的小标：`放假` / `调休 · 上周二的课` / `临时换课`；正常日子为空（不占版面） |
| `currentPeriod` | 用 `periods[].start/end` 与当前 `HH:MM` 比较，标 `.is-now` |
| `countdown.days` | 由 `countdown.date` 与今天算**日历日差**；过期不渲染；`sub` 自动写考试当天日期（同年前不加年份） |
| `greeting` | 时段问候（<5 夜深了 / <11 早上好 / <13 中午好 / <18 下午好 / 其余 晚上好） |

`board.js` 每秒只刷时钟文本；只有 **日期变了或换节了**（`dateKey|currentPeriod` 变化）才整屏重算——避免每分钟重排、把跑马灯和分页打回第一页。

调休/放假的写法（`overrides`，按日期命中，最多 60 条）：

```json
"overrides": [
  { "date": "2026-11-14", "useWeekday": 2 },   // 周六补周二的课
  { "date": "2026-11-16", "off": true },       // 周一放假
  { "date": "2026-11-20", "periods": ["math", "chinese", "", "pe"] }
]
```

三种字段可叠加，`periods` 优先。老师端只写入，不解释——渲染端负责把它变成"周六上周二的课"和小标。

## 装不下怎么办（三道闸）

1. **先降字号**：`fitTiles()` 逐块量 `.tile-body` 的 `scrollHeight`，超了给磁贴加 `.is-tight`（0.88 倍基准字号），再超加 `.is-tighter`（0.78 倍）。
2. **还不够就分页**：`core/pager.js` 把磁贴 body 的子节点（一科作业 / 一条待办）按高度切成若干页，每 9s 换一页，只用 `.is-page-hidden` 切显示，不重建 DOM。每块磁贴独立计时；`data-flip="off"` 的块不参与。
3. **长文本折行，不横跑**：作业条目、通知、待办、值日、寄语这类"要读"的文字一律用 `Board.wrapLine(text, cls, n)`（`.clamp` + `-webkit-line-clamp`）。教室里隔五米追横向滚动的字，等于没写。`core/scroll.js` 只留给真正"一行一条"的地方。

前提是磁贴里的行**一律不压缩**：`.tile-body > * { flex: 0 0 auto }`。少了这条，内容一多 flex 会把行压到比内容还矮，文字就会互相穿透（v2 压测踩过）。

分页之后一页可能只装得下 2 科，所以 `.tile.is-paged .tile-body > * { flex: 1 1 0 }` 让页内的行撑满磁贴高度；一页只装得下一科时再用 `.tile.is-paged .hw-row { align-items: flex-start }` 让色块贴住第一条作业。

课表用 `grid-template-rows: repeat(var(--tt-rows), minmax(0,1fr))`，节次数写进 `--tt-rows`，格子自己等高——8 节就是 4 行，不会往下溢出被裁掉。

## 配对卡（方向：大屏显示，手机操作）

壁纸层没有焦点、没有键盘，所以配对码只能由大屏显示：

1. 没有 `window.BOARD_HOST.mode === "host"`（本地文件、老师端预览 iframe）→ 配对卡根本不出现；
2. 宿主注入 `mode:"host", paired:false` → `pairing.js` 领码，右下角显示 6 位码 + 二维码 + 完整网址；
3. 手机扫码确认 → 大屏轮询拿到设备令牌 → `chrome.webview.postMessage({type:"board:paired", ...})` → 卡片收起、右下角只留小号屏码；
4. 令牌失效（宿主收到 401）→ 宿主调 `BOARD_PAIR_RESET()` → 重新领码。

`pairing.js` 只碰配对卡和 `body.is-unpaired`，不动磁贴内容。

## 本地预览

```powershell
start "H:\Project\软件复刻\board-web\index.html"                      # 样例数据
start "H:\Project\软件复刻\board-web\index.html?theme=indigo"         # 换主题
start "H:\Project\软件复刻\board-web\index.html?blocks=homework,timetable"
```

优先级：`?theme=` / `?blocks=`（仅预览，过滤本次要画的块）> 数据里的 `theme` / `layout` > 默认。`?layout=` 已随 v2 版面配方退役。

截图（不开宿主）：

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$tmp  = Join-Path $env:TEMP ("edge-" + [guid]::NewGuid().ToString("N"))
$args = @("--headless=new", "--disable-gpu", "--hide-scrollbars", "--user-data-dir=$tmp",
          "--window-size=1920,1080", "--virtual-time-budget=3000",
          "--screenshot=H:\Project\软件复刻\reference\board-web-1920.png",
          "file:///H:/Project/软件复刻/board-web/index.html")
Start-Process -FilePath $edge -ArgumentList $args -Wait
```

三个坑：①不带 `--user-data-dir` 时本机 Edge 开着会静默失败不出图；②路径直接写中文更稳，别整段百分号编码；③必须 `Start-Process -Wait`，`& $edge` 会立刻返回、图还没写完。

## 加一个新板块

1. 契约里加字段：`board-web/schema/board-state.v3.schema.json` 的 `today` 下加一条，`layout.tiles[].block` 的 enum 加类型（**schema 由契约 owner 改，渲染层不动**）；
2. `blocks/<type>.js` 里 `Board.defineBlock({type, title, render})`，返回 `{title?, nodes}`，没数据返回 `null`；
3. `blocks/manifest.js` 加一行 `{type, title, w, h, on, desc}`；
4. `index.html` 加一个 `<script>`，发布端（`publish-api/public/`）会自动读到 manifest 生成「+ 添加磁贴」和尺寸建议。

`board.js`、`board.css` 通常不用动——动了就说明这个板块的排版漏进了装配层。

## 与参考图的差异（刻意保留）

- 参考图里"今日待办"的橙色框是作者截图时的编辑态，静态看板不保留。
- 左侧 32.4% 的空白是**给桌面图标列让位**，不是排版失误；这是"壁纸层"和"全屏看板"最直观的区别。
- 科目配色按截图取近似值，其余 14 科按色轮分配，需要真机校色时改 `subjects.js` 一处即可。
