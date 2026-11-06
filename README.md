# 班屏（ClassBoard）

> 教室里的那块屏。

一块挂在教室电脑桌面壁纸层上的班级大屏：老师用手机改作业、课表、通知，教室那块屏自己就变了。不用切窗口、不用每天手动更新、不用装额外软件。

这是一个**可自部署的开源框架**：渲染层、老师端、Windows 宿主三部分都在仓库里，代码零外部依赖（没有 npm 包，没有 CDN，没有前端构建），你把它跑在任意一台能跑 Node 20+ 的机器上就行。

![班屏图标](design/icon.svg)

## 它能做什么

- **课表填一次**：一周七天录进去，之后按日期自动取今天该上的课；周末、放假、调休（"这天按周三上"）、临时换课都能单独标。
- **作业天天填**：各科老师自己登进来只改自己那一科，班主任负责发布。
- **大屏自己出码配对**：教室电脑上右下角出 6 位码和二维码，老师手机扫一下就绑上；一个班只绑一块屏，换屏先解除。
- **版面自己拖**：12×8 磁贴网格，作业 / 课表 / 待办 / 值日 / 通知 / 倒计时 / 点名 / 寄语，拖到哪就是哪，还有五套预置一键换。
- **花名册 + 点名**：粘贴名单或传 CSV，值日按周/按天自动轮班；课堂上点「抽一个」，大屏立刻亮出名字。
- **托盘里退得掉**：壁纸层没有窗口，右下角托盘图标右键有「打开老师端 / 重新配对 / 退出班屏」。

## 三个部件

| 目录 | 是什么 | 技术 |
| --- | --- | --- |
| `board-web/` | 大屏渲染层，纯静态页面，按 `BoardState v3` 渲染成 12×8 磁贴 | 原生 HTML/CSS/JS，无构建 |
| `publish-api/` | 服务端接口 + 老师端网页（同一个进程、同一份静态目录） | Node 内置模块：`node:http`、`node:sqlite`、`node:crypto` |
| `host-m0/` | Windows 宿主：把渲染层挂到桌面壁纸层（WorkerW）上，带托盘图标 | .NET 8 WinForms + WebView2 |

三部分之间**只有一个耦合点**：`BoardState` JSON 契约（[`board-web/schema/board-state.v3.schema.json`](board-web/schema/board-state.v3.schema.json)，人话版在 [`docs/board-v3.md`](docs/board-v3.md)）。服务端只负责存储与校验，时间类的东西（今天是周几、第几节课、倒计时多少天）全部由渲染层自己算。

## 跑起来

只跑服务端和老师端（不需要 Windows）：

```bash
cd publish-api
node main.js        # → http://127.0.0.1:8787/
```

第一次要先配一个"开通密钥的种子"，否则建不了班：

```bash
node tools/claim-key.mjs --init                 # 生成种子并打印出来
node tools/claim-key.mjs --init --write seed.txt # 或者同时写到一个文件（记得 gitignore）
```

拿到种子后用环境变量喂给服务：

```bash
CLAIM_KEY_SECRET="<上面打印的那串>" node main.js
```

Windows 宿主（教室那台电脑）：

```bash
cd host-m0
dotnet build -c Release             # → bin/Release/net8.0-windows/BoardHost.exe
BoardHost.exe --api http://127.0.0.1:8787
```

也可以不带参数、把服务地址写在 exe 旁边的 `host.json`：

```json
{ "server": "http://10.0.0.5:8787" }
```

宿主的页面来源优先级：`--url` > `--api` 的同源页 > `host.json` > 仓库里的 `board-web`（本地预览样例）> `http://127.0.0.1:8787`。

## 部署到自己的服务器

仓库不带任何托管配置（nginx、systemd、证书、域名都不在其中），因为每个学校的网络、域名、证书都不一样。要点只有三条：

1. 服务进程只需要三个环境变量：`HOST=127.0.0.1`、`PORT=8787`、`DB_PATH=<持久目录>/publish.db`，外加 `CLAIM_KEY_SECRET`。
2. 前面套一层 nginx 反代，把 `/` 指到 `127.0.0.1:8787`，并让 `X-Forwarded-Proto` 透传（配对链接要靠它拼成 `https://`）。
3. 数据库就是单个 SQLite 文件，备份 = 复制它；老库启动时会自动补列、补索引、把 v1/v2 的看板快照升级到 v3（幂等）。

接口清单、环境变量、错误码见 [`publish-api/README.md`](publish-api/README.md)；渲染层的板块与皮肤见 [`board-web/README.md`](board-web/README.md)。

## 不提供什么

- 不提供在线托管服务，也没有公共 demo 站——请自部署。
- 不提供预编译安装包（`.msi` / `.exe`）：宿主源码在 `host-m0/`，用 `dotnet publish` 自己打即可；给教室批量部署时建议自己做一份带内网地址的 `host.json`。
- 不包括任何真实的班级数据、密钥、域名。

## 授权

[AGPL-3.0](LICENSE)。你可以自由使用、修改、自部署；如果你把修改后的版本作为网络服务提供给别人用，需要同样开源你的修改。
