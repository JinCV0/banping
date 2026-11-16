# AGENTS.md — 班屏

给接手这个仓库的 AI / 同事看的操作契约。产品说明在 [README.md](README.md)，这里只写：**别人怎么免费部署、作者那台服务器怎么按限时体验用、怎么打包发版、什么不能动**。

## 0. 三十秒速览

| 目录 | 是什么 | 怎么算改对了 |
| --- | --- | --- |
| `board-web/` | 大屏渲染层，纯静态，按 `BoardState v3` 画 12×8 磁贴 | `node --check` 全过；契约不破 |
| `publish-api/` | 零依赖 Node 服务 + 老师端网页（同一进程） | `node publish-api/tools/smoke.js` 退出码 0 |
| `host-m0/` | .NET 8 Windows 宿主（挂桌面壁纸层 WorkerW + 托盘） | `dotnet build` 通过 |
| `installer/` + `scripts/` | WiX 5 打 perUser msi | `scripts/verify-msi.ps1` 退出码 0 |
| `docs/SELF-DEPLOY.md` | 第三方自助部署（含免费方案） | 按里面自检清单跑通 7/7 |

一个实例只能有一份数据库：SQLite 单写者 + SSE 连接表在进程内存里，**不要多副本**。

## 1. 两种用起来的方式（先判断用户要哪种）

### A. 自己部署（默认推荐，有免费方案）

服务端只是一台能常驻 Node ≥22 的机器，和大屏无关。完整步骤、平台对比、环境变量表在 **[docs/SELF-DEPLOY.md](docs/SELF-DEPLOY.md)**，常用三条：

| 方案 | 适合 | 要点 |
| --- | --- | --- |
| 旧电脑 / NAS / 树莓派 + Cloudflare Named Tunnel | 零成本、能长期开机 | 不用公网 IP、不用开端口；域名走 Cloudflare |
| Oracle Always Free（ARM） | 有国际网络 | 免费额度以官网为准，注意区域容量和回收策略 |
| 便宜 VPS（1C1G 起） | 想省心 | 最省事；系统 nginx + systemd 就行 |

两条硬性要求：

1. `CLAIM_KEY_SECRET` 必须自己生成并保存好：`node publish-api/tools/claim-key.mjs --init`（写进 `deploy/claim-secret.txt`）。**这个种子等于印钞机**，拿到它就能无限造开通密钥，别提交、别外发。
2. 部署完把大屏指过去，否则大屏还在连作者的服务器：

> 公开库里**不含任何真实种子、密钥或服务器凭证**：作者的官方实例把种子只放在服务器的环境变量里，仓库里没有，`.gitignore` 也挡住了 `deploy/claim-secret.txt` 与 `deploy/.env`。别人要跑自己的实例，必须自己 `--init` 生成一份。

```powershell
'{"server":"https://你的域名"}' | Set-Content "$env:LOCALAPPDATA\班屏\host.json" -Encoding utf8
# 或启动参数：BoardHost.exe --api https://你的域名
```

`host.json` 放在 exe 旁边（安装目录 `%LOCALAPPDATA%\班屏\`）。查找顺序：`--url` > `--api` > host.json > 本地 `board-web/` > 默认官方实例。

自建实例自己发密钥给自己用：`node publish-api/tools/claim-key.mjs 3` 出 3 把，`--verify` 验旧密钥。
`LICENSE_DAYS` 由你自己定（默认 365）；`INVITE_HINT` 留空就行，留空时老师端不会出现任何提示文案。

### B. 作者的官方实例（限时体验）

`https://board.hibot.ink` 是**作者自己搭的一台服务器**，不是公共免费服务，别人不能拿它部署自己的东西。

- 装 Releases 里的 msi，默认就连它；用这个域名在老师端创建班级账号，并把这块大屏绑定到班上。
- **创建账号要一把开通密钥**：到小红书 **26225307944** 联系作者获取（说明用途、要几个班）。
- 一把密钥只能建一个班（一钥一班）；班的服务期 **90 天**，从建班那一刻写死。
- 到期后只拦「发布到大屏」，班里数据还在；续用找作者换新密钥。
- 官方实例的密钥在自建实例上无效，反之亦然（两边签名种子不同）。
- 别把官方实例当免费档：试用期内也别往里灌多班级、多学校的数据。

## 2. 构建安装包

```powershell
pwsh -File scripts/doctor.ps1                        # 先体检：Node ≥22 / .NET 8 / WiX 5 / Edge
pwsh -File scripts/build-installer.ps1                # 完整：图标 → 单文件 exe → msi → 校验清单
pwsh -File scripts/build-installer.ps1 -SkipIcons     # 图标已入库，CI 用这个（不依赖 Edge）
pwsh -File scripts/verify-msi.ps1 -Msi dist\班屏-<版本>.msi            # 安全模式：不装也能验
pwsh -File scripts/verify-msi.ps1 -Msi dist\班屏-<版本>.msi -Full      # 真装真卸（本机已装班屏会拒绝）
```

| 目的 | 通过判据 |
| --- | --- |
| 出 msi | 退出 0；`dist\班屏-<版本>.msi` + `dist\build-info.json` + `.sha256.txt` |
| 验 msi | 退出 0；msi 内 ProductVersion == `version.json` |
| 服务端冒烟 | `node publish-api/tools/smoke.js` 退出 0 |
| 线上验收 | `node publish-api/tools/verify-remote.mjs <服务地址>` 退出 0，7 项全 ✓ |

- 版本号唯一来源是根目录 **`version.json`**。不要手改 `installer/BoardHost.wxs` 或 `host-m0/BoardHost.csproj` 里的版本：wxs 走 `-d ProductVersion` 注入，csproj 由 `Directory.Build.props` 读取。
- `build-info.json` 里有版本、提交、`gitDirty`、sha256、工具版本。**`gitDirty=true` 的产物不要发。**
- 免费方案里 **serverless 不行**：需要常驻进程 + 可写 SQLite + SSE 长连接，详见 `docs/SELF-DEPLOY.md` 第 6 节。

## 3. 发版

改 `version.json` → 提交 → 打 `vX.Y.Z` tag → GitHub Actions 在 Windows runner 上打包、真装真卸、建 Release 附件。附件名是 ASCII 的 `classboard-<版本>.msi`（GitHub 会裁中文附件名），本地打包出来的名字仍是 `班屏-<版本>.msi`。

CI 里两个 workflow：

- `.github/workflows/build-msi.yml`：`doctor` → 打 msi → `verify-msi -Full` → 上传 artifact；tag 时发 Release（msi + sha256 + build-info.json）。
- `.github/workflows/web.yml`：打服务端冒烟 + Docker 起容器跑端到端 7 项。

推 tag 前先确认 tag 与 `version.json` 一致（CI 会卡这一条）。

发完版记得改作者实例上「大屏端下载」按钮的直链：`publish-api/public/index.html` 里两处 `/download/classboard-X.Y.Z.msi`，改完重新部署；不改的话按钮还发上一个版本的包。

同一个 msi 还要传到服务器自己的目录（`DOWNLOAD_DIR`，默认是数据库文件旁边的 `downloads/`）：`scp classboard-X.Y.Z.msi <user>@<vps>:/var/lib/class-board/downloads/`，再 `chown classboard:classboard`。路由在 `publish-api/downloads.js`：只发 `msi`/`exe`/`zip`、支持 Range（206）、挡目录穿越，文件不存在一律 404——所以别把别的文件扔进这个目录指望能下。

## 4. 部署网页服务端（自己部署时）

细节见 `deploy/README.md`。三条铁律：

1. **先提交再部署**：如果走「打包当前提交 → 上传解包」的方式，没提交的改动不会上服务器。
2. **不要在服务器上 `git pull`**：解包出来的目录没有 `.git`，也没有历史。
3. **重启前必须有备份**：迁移会就地改写数据库，先备份到 `backup-<时间>.db` 再重启；备份失败就中止。备份工具：`node tools/backup.mjs <源库> <输出>`。

回滚：`cp /var/lib/class-board/backup-<时间>.db <数据库路径> && systemctl restart class-board`。

## 5. 禁止

- **WiX 7**：从 7 起要求接受 OMF 付费条款（`error WIX7015`）。锁 5.0.2。
- 改 `installer/BoardHost.wxs` 里的 `UpgradeCode`：改了老版本就装不上、也升不上去。
- 轮换 `CLAIM_KEY_SECRET`：服务器只存种子不存密钥，换了等于所有已发出的开通密钥作废。要改就当停服变更做。
- `docker compose scale board=2` 或多副本部署：SQLite 单写者 + 内存 SSE 表，会出现"大屏有时在线有时离线"。
- 以 SYSTEM / 管理员身份远程装 perUser msi：会装进管理员的 `%LOCALAPPDATA%`，教室里没人看得见。必须在目标用户会话里装。
- 往安装目录写运行数据：安装目录只读，缓存/令牌/日志一律在 `%LOCALAPPDATA%\ClassBoard\`。
- 把官方实例（`board.hibot.ink`）当自己的服务器部署东西，或者把作者的密钥分发给第三方。

## 6. 声称"完成"之前

必须贴出：命令、退出码、以及产物 sha256（msi）或 7/7 自检输出（线上）。没有退出码的"已完成"不算完成。

## 7. 已知缺口（别假装有）

- msi 与 exe **都没有代码签名**，别人电脑首次运行会被 SmartScreen 拦（要买 OV/EV 证书）。
- 没有"安装时写服务地址"的参数，机房批量只能装完再逐台推 `%LOCALAPPDATA%\班屏\host.json`。
- `/api/v1/health` 只回 `{ ok, uptimeSec }`，不带提交号，无法自证线上跑的是哪个提交。
- 官方实例是**单机单实例**，作者自费维护，别当生产服务依赖。

（一路读下来如果真用上了这个仓库，在 GitHub 上点个 Star 就行。）
