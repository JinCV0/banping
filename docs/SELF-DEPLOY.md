# 班屏自部署指南：不用作者的服务器

`https://board.hibot.ink` 是**作者自己的单台 VPS**，不是公共托管服务。它只跑一个实例（SQLite 单写者 + SSE 连接表在进程内存里），容量、备份、续费、密钥都由作者管；你往里注册班级，数据就在作者的机器上，作者停服或换域名你就一起下线。仓库契约也写明：别人不要往这台机器部署自己的东西。所以长期使用只有一条正路：**自己部署一份服务端，再让教室大屏连到你的地址**。

装完官方 msi 后不改地址会默认连 `https://board.hibot.ink`，这是给“找作者要一把开通密钥、先试用”的人准备的；一钥一班，服务期 90 天（建班时写死，到期只拦发布到大屏，数据还在）。要长期用，必须做第 5 节的地址切换。

三条路，先选一条：

| 路线 | 花钱 | 难度 | 稳定性 | 适合谁 |
| --- | --- | --- | --- | --- |
| A. 旧电脑/NAS/树莓派 + Cloudflare Tunnel | 0 月租 + 一枚域名 | 中 | 取决于你家电脑和宽带 | 有常开机器、想数据留在自己手里 |
| B. 免费云主机（能长期跑的主要是 Oracle Always Free） | 0 | 中高 | 有容量/回收风险 | 能注册 Oracle、愿意折腾 |
| C. 小钱 VPS（国内轻量云/海外小鸡） | 每月几元到几十元 | 低 | 最稳 | 班级要长期稳定，愿意付一点钱 |

只要有常开电脑就选 A；抢得到 Oracle 免费 ARM 就选 B；希望“部署完就不管”就选 C。下面完整写 A 和 B；B 的步骤对 C（小钱 VPS）完全一样，只是机器来源不同。

## 1. 平台选择矩阵（2026-11 官方页面核实）
| 方案 | 免费额度现状 | 持久磁盘 | 常驻 Node + SSE | 备案 | 适合谁 |
| --- | --- | --- | --- | --- | --- |
| 自己电脑/NAS/树莓派 + [Cloudflare Named Tunnel](https://developers.cloudflare.com/tunnel/) | 隧道对所有 Cloudflare 计划开放，域名自备 | 有（本机磁盘） | 支持（HTTP 代理；官方仅对 Quick Tunnel 明确不支持 SSE） | 一般不需要（入口在 Cloudflare 海外边缘；origin 在境内时合规自行确认） | 有常开机器、想零月租 |
| [Oracle Cloud Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) ARM | A1 按月度免费小时额度给（常驻约 2 OCPU / 12 GB 量级，以官网额度页为准），加块存储；热门区容量紧张，长期闲置可能被回收 | 有（块存储） | 支持 | 不需要（海外区） | 能注册、能接受"可能被回收" |
| [Fly.io](https://fly.io/docs/about/free-trial/) | 新号只有一次性试用（额度/期限见官网 Free Trial 页），到期机器会被停 | 有（试用期内） | **不适合常驻** | 不需要 | 只适合演示 |
| [Railway](https://railway.com/pricing) | 30 天 $5 试用，之后 $1/月；每服务 1 vCPU/0.5 GB、0.5 GB 卷、1 副本 | 有（0.5 GB） | 技术上能跑，但 $1/月不够 24/7 | 不需要 | 短期演示 |
| [Render](https://render.com/docs/free) | 750 实例小时/月；15 分钟无入站流量休眠；免费不能挂持久盘 | **没有** | **不支持**（休眠 + 文件系统丢失） | 不需要 | 别用 |
| [Koyeb](https://www.koyeb.com/pricing) | 只有 Free 5h（0.25 vCPU/1 GB/1 GB，额度很小），之后 $29.76/月起 | 1 GB（Free） | **不支持常驻** | 不需要 | 别用免费档 |
| [腾讯云云+校园](https://cloud.tencent.com/act/campus) / [阿里云高校计划](https://university.aliyun.com/) | 腾讯学生机 2C2G/2C4G（40–60 GB SSD，限购 1 台）；阿里发 300 元券，机型以活动页为准 | 有 | 支持 | **需要**（域名指向大陆主机走 80/443） | 国内教室、能备案 |
| Serverless：Vercel / Netlify / Cloudflare Workers / Deno Deploy | 各家有免费额度 | **没有本地持久盘** | 进程按请求起停，SSE 连接表无法常驻 | 视地区 | 别用 |

## 2. 路线 A：自己电脑/NAS/树莓派 + Cloudflare Tunnel
原理：`cloudflared` 从你的机器**向外**建隧道到 Cloudflare，Cloudflare 给你 HTTPS 域名并转发到本机 `127.0.0.1:8787`。不需要公网 IP、不用开路由器端口，动态 IP 也能用。前提：一枚域名，NS 托管在 Cloudflare（免费计划即可）。

**A1 域名**：Cloudflare 添加站点，按提示把注册商处的 NS 改成 Cloudflare 给的两个。**验**：Dashboard 站点状态为 Active。

**A2 Node**：从 [nodejs.org](https://nodejs.org/en/download) 装 22 LTS 或更新版本。**验**：`node -v` 输出 `v22.13.0` 或更高。

**A3 代码**：`git clone https://github.com/JinCV0/banping.git`；`cd banping\publish-api`；`New-Item -ItemType Directory -Force data`。**验**：当前目录下有 `main.js` 和 `data\`。

**A4 种子（只做一次）**：在 `publish-api` 目录运行 `node tools\claim-key.mjs --init`（脚本按自身位置写仓库根的 `deploy\claim-secret.txt`，并打印服务器要配的那一行；已有种子会拒绝覆盖）。把种子单独存进密码管理器，**不要**提交、不要发人。**验**：`Test-Path ..\deploy\claim-secret.txt` 为 True。

**A5 起服务**：当前 PowerShell 窗口执行：

```powershell
$env:CLAIM_KEY_SECRET = "<粘贴种子>"
$env:DB_PATH = "$PWD\data\publish.db"
node main.js
```
看到 `[publish-api] listening http://127.0.0.1:8787  db=...` 即成功。**验**：另开窗口 `curl.exe -fsS http://127.0.0.1:8787/api/v1/health` 返回 `{"ok":true,"uptimeSec":...}`。

**A6 命名隧道**：Cloudflare Dashboard → Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared → 起名。按页面给的 Windows 命令，在**管理员** PowerShell 里安装并注册服务（例如 `cloudflared.exe service install <TOKEN>`；也可从官方文档 Downloads 页取 exe）。**验**：`Get-Service cloudflared` 为 Running。然后在该隧道加 Public Hostname：子域 `board`、你的域名、类型 HTTP、URL 填 `127.0.0.1:8787`（**不要填 `localhost`**，避免解析到 `::1`）。**验**：`curl.exe -fsS https://board.example.com/api/v1/health`。

**A7 七项验收**：仍在 `publish-api` 目录，运行 `node tools\verify-remote.mjs https://board.example.com`。输出 7 项全 ✓、末尾“全部通过”、退出码 0 才算过。

**A8 开机自启与备份**：在 `publish-api` 目录把两个变量写成当前用户环境变量（`setx CLAIM_KEY_SECRET "<种子>"`、`setx DB_PATH "$PWD\data\publish.db"`），任务计划程序建任务：触发器“登录时”，操作启动 `C:\Program Files\nodejs\node.exe`，参数 `main.js`，起始于 `...\banping\publish-api`；电源计划把睡眠设为“从不”。**验**：重启后 health 仍 ok、域名仍可开。备份用 `node tools\backup.mjs data\publish.db backup\publish-20261116.db`（输出文件不能已存在，所以文件名带日期）。

**A9 树莓派/Linux 变体**：服务端用第 3 节的 systemd 单元，但**跳过 nginx 和 certbot**；env 里写 `HOST=127.0.0.1`、`DB_PATH=/var/lib/class-board/publish.db`；再 `sudo cloudflared service install <TOKEN>`，Public Hostname 仍指向 `127.0.0.1:8787`。

**A 的注意事项**：不要用 `cloudflared tunnel --url http://127.0.0.1:8787` 的 Quick Tunnel——它给随机 `trycloudflare.com` 地址、重启就变，且[官方明确不支持 SSE](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)，大屏收不到实时推送；电脑睡眠/休眠 = 服务下线，笔记本合盖也会；Cloudflare 免费计划支持 Tunnel（官方写 “Available on all plans”），不需要买 Argo。

## 3. 路线 B：Linux 云主机 + nginx + systemd（Node 直跑；Oracle 免费机与小钱 VPS 通用）
一台 Ubuntu 24.04（1 核 1G 就够，实测空转约 67 MB；2C2G 属于过剩）。安全组放行 22/80/443；域名 A 记录指向公网 IP。代码用 `git archive` + scp 上传，别在 VPS 上 `git pull`（`/srv/board` 没有 `.git`）。

**B1 基础软件**：`sudo apt update && sudo apt install -y git curl nginx`。

**B2 Node 22**：
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # ≥ v22.13.0
```
**B3 服务账号与代码**：
```bash
sudo git clone https://github.com/JinCV0/banping.git /srv/board
sudo useradd --system --home /srv/board --shell /usr/sbin/nologin classboard
sudo mkdir -p /var/lib/class-board
sudo chown -R classboard:classboard /srv/board /var/lib/class-board
```
**B4 生成种子**：`cd /srv/board` 后运行 `sudo -u classboard node publish-api/tools/claim-key.mjs --init`。若写 `deploy/claim-secret.txt` 报权限错，就先 `sudo node publish-api/tools/claim-key.mjs --init` 再 `sudo chown classboard:classboard deploy/claim-secret.txt`。**验**：文件存在且非空。

**B5 环境文件**：
```bash
sudo tee /etc/class-board.env >/dev/null <<'EOF'
HOST=127.0.0.1
PORT=8787
DB_PATH=/var/lib/class-board/publish.db
CLAIM_KEY_SECRET=粘贴种子
LICENSE_DAYS=365
EOF
sudo chmod 600 /etc/class-board.env
```
**B6 systemd 单元**（仓库没有现成 unit，直接建）：
```bash
sudo tee /etc/systemd/system/class-board.service >/dev/null <<'EOF'
[Unit]
Description=Class Board
After=network.target
[Service]
Type=simple
User=classboard
WorkingDirectory=/srv/board/publish-api
EnvironmentFile=/etc/class-board.env
ExecStart=/usr/bin/node main.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now class-board
sudo systemctl status --no-pager
curl -fsS http://127.0.0.1:8787/api/v1/health
```
**验**：状态为 active (running)，health 返回 `{"ok":true,...}`；再 `sudo systemctl restart class-board`，health 仍 ok。

**B7 nginx 反代（SSE 必须关缓冲）**：
```bash
sudo tee /etc/nginx/sites-available/class-board >/dev/null <<'EOF'
server {
    listen 80;
    server_name board.example.com;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/class-board /etc/nginx/sites-enabled/class-board
sudo nginx -t && sudo systemctl reload nginx
```
若默认站点抢域名，`sudo unlink /etc/nginx/sites-enabled/default` 后再 reload。**验**：`curl -fsS -H 'Host: board.example.com' http://127.0.0.1/api/v1/health`。

**B8 HTTPS 证书**：`sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d board.example.com`。**验**：`curl -fsS https://board.example.com/api/v1/health`，再 `node /srv/board/publish-api/tools/verify-remote.mjs https://board.example.com` 七项全 ✓。若云厂商封了 80 端口，按 `deploy/README.md` 的 TLS-ALPN-01 办法先签证书再 reload nginx。

**B9 每日备份与更新**：`sudo crontab -e` 加一行（`%` 要转义）：
```cron
17 3 * * * cd /srv/board/publish-api && /usr/bin/node tools/backup.mjs /var/lib/class-board/publish.db /var/lib/class-board/backup-$(date +\%Y\%m\%d-\%H\%M).db && find /var/lib/class-board -name 'backup-*.db' -mtime +14 -delete
```
更新顺序固定：先备份，再拉代码，再重启：
```bash
cd /srv/board/publish-api && sudo -u classboard node tools/backup.mjs /var/lib/class-board/publish.db /var/lib/class-board/backup-$(date +%F-%H%M).db
sudo -u classboard git -C /srv/board pull
sudo systemctl restart class-board
```
**B10 Docker 变体（可选）**：仓库 `deploy/` 用 Caddy 自动签证书。先装 Docker Engine 与 compose 插件；`cd /srv/board/deploy && cp .env.example .env`，填 `BOARD_DOMAIN`、`ACME_EMAIL`，**并在 `.env` 追加 `CLAIM_KEY_SECRET=<种子>`**——compose 已把该变量标成必填（`${CLAIM_KEY_SECRET:?...}`），漏填会直接报错；`LICENSE_DAYS`、`INVITE_HINT` 也已在 compose 里透传，按需加。然后 `mkdir -p data && sudo docker compose up -d --build`，`sudo docker compose ps`，`sudo docker compose logs -f caddy` 看到 certificate obtained；数据库就在 `deploy/data/publish.db`，备份它。**验**：`curl -fsS https://board.example.com/api/v1/health` 与 7/7。永远不要 `docker compose up --scale board=2`。

## 4. 必须配置的环境变量（唯一来源：`publish-api/config.js`）
| 变量 | 默认 | 作用 / 不配的后果 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口；平台注入时以平台为准 |
| `HOST` | `127.0.0.1` | 监听地址；容器/PaaS 不设会只听本地，反代 502。config 对 `RAILWAY_ENVIRONMENT`/`FLY_APP_NAME`/`RENDER`/`K_SERVICE` 自动切 `0.0.0.0` |
| `DB_PATH` | `publish-api/data/publish.db` | SQLite 文件路径；服务会自动建父目录。**必须落在持久磁盘**，备份文件另放 |
| `CLAIM_KEY_SECRET` | 空 | **必填**。为空时服务照常启动、health 也 ok，但“创建班级”返回 403“服务端没有配置开通密钥的种子”，没人能建班 |
| `LICENSE_DAYS` | `365` | 建班时写死到期日；只影响之后新建的班；到期只拦“发布到大屏”，登录/看数据/导出照旧 |
| `SESSION_TTL_HOURS` | `168` | 老师端登录会话时长 |
| `CLAIM_TTL_MINUTES`（旧名 `PAIR_TTL_MINUTES`） | `10` | 配对/开通码有效期 |
| `CLAIM_RATE_LIMIT` / `CLAIM_RATE_WINDOW_MINUTES` | `5` / `10` | 每 10 分钟最多 5 次密钥尝试 |
| `CLAIM_PENDING_MAX` | `2000` | 待处理开通请求上限 |
| `MAX_BODY_KB` | `64` | 请求体上限 |
| `INVITE_HINT` | 空 | 只影响“创建班级”页提示文案；自建实例留空，别照抄作者的邀请语 |

`CLAIM_KEY_SECRET` 是签名种子：**换它 = 已发出的所有开通密钥作废，老班也开不了新班**。生成一次，和数据库分开备份；只发密钥（仓库根目录 `node publish-api/tools/claim-key.mjs 5`，种子从 `deploy/claim-secret.txt` 或环境变量读取），不发种子。

## 5. 让教室大屏连到你的服务
大屏宿主 `BoardHost.exe` 找服务地址的优先级：`--url` > `--api` > `host.json` > 安装目录向上找 `board-web/index.html` > 编译进去的默认值。

**改 host.json（推荐，双击启动也生效）**。官方 msi 是 perUser 安装，装在 `%LOCALAPPDATA%\班屏\`，所以文件就是 `%LOCALAPPDATA%\班屏\host.json`，内容只有一行：

```json
{"server":"https://board.example.com"}
```
写入时用下面这种方式（UTF-8 无 BOM，避免不同工具读写时多出隐藏字符）：
```powershell
[System.IO.File]::WriteAllText("$env:LOCALAPPDATA\班屏\host.json", '{"server":"https://board.example.com"}')
```
**或命令行覆盖**：`& "$env:LOCALAPPDATA\班屏\BoardHost.exe" --api https://board.example.com`。`--api` 会拼成 `https://board.example.com/board/index.html`，所以这个地址必须同时提供网页和 API（你自己的部署就是）；指向纯静态镜像时页面能开，但 API/配对会失败。

**为什么装完 msi 会连作者**：编译时 `host-m0/HostConfig.cs` 写死了 `DefaultServer = "https://board.hibot.ink"`，安装包没有“安装时填服务地址”的参数。没放 `host.json`、也没加 `--api` 时，它当然连作者。长期用必须逐台改；机房批量就装完后统一推这个 `host.json`，再重启班屏。升级/重装后复查一次，确认文件还在。

**验**：老师端能登录、创建班级不再 403、大屏出现配对码；`%LOCALAPPDATA%\ClassBoard\logs\host.log` 里请求地址是你的域名。

## 6. 这些方案别用（以及为什么）
- **Serverless：Vercel / Netlify / Cloudflare Workers / Deno Deploy。** 没有本地持久盘，SQLite 文件活不过一次冷启动；SSE 需要长命进程，函数按请求起停，连接表也不在内存里。直接不可能。
- **免费 PaaS 的“会休眠/会丢盘”档。** [Render 免费](https://render.com/docs/free)：15 分钟无入站流量就 spin down，且免费服务不能挂持久盘，重启/重新部署本地改动全丢；[Fly.io 试用](https://fly.io/docs/about/free-trial/)：只有一次性试用，到期机器停掉，不是免费常驻；[Railway](https://railway.com/pricing)：试用额度用完后按量计费，撑不起 24/7；[Koyeb](https://www.koyeb.com/pricing)：免费档只有 5 小时（0.25 vCPU / 1 GB），之后 Small 起 $29.76/月。
- **多副本 / 自动扩缩容。** SQLite 单写者，SSE 连接表在进程内存；两个副本会出现“大屏有时在线有时离线”。不要开 autoscaling，不要 `--scale board=2`。
- **大陆服务器 + 域名但没 ICP 备案。** 官方口径：未经备案不得在境内提供非经营性互联网信息服务，未备案网站会被罚款和关闭（[阿里云备案说明](https://help.aliyun.com/zh/icp-filing/)）。大陆机房通常会对未备案域名封 80/443；要么先备案，要么把服务放香港/海外（不走大陆备案，但延迟和合规需自行评估）。
- **只开 HTTP 不挂 TLS。** 手机扫码绑定要调摄像头，浏览器只在安全上下文（HTTPS 或 localhost）给摄像头/剪贴板权限；纯 HTTP 的域名在手机上直接掉能力。Cloudflare Tunnel 和 Caddy/certbot 都自带证书。
- **Cloudflare Quick Tunnel。** 随机 `trycloudflare.com`、重启即变，且官方明确不支持 SSE；只能临时演示。

## 7. 部署完的自检清单
按顺序跑，任何一条不过就别宣布完成：
```bash
curl -fsS http://127.0.0.1:8787/api/v1/health          # 期望 {"ok":true,"uptimeSec":...}
node publish-api/tools/verify-remote.mjs https://board.example.com   # 期望 7 项全 ✓、退出码 0
ls -l /var/lib/class-board/publish.db                  # 期望文件存在（Linux 路线）
```
再手工确认四件事：① 在仓库根目录用 `node publish-api/tools/claim-key.mjs 1` 发一把密钥，能成功创建班级（不是 403）；② 重启服务后班级码/数据还在（说明 `DB_PATH` 没指到临时层）；③ 大屏连上后老师改一块磁贴，大屏 1–2 秒内更新（说明 SSE 没被反代缓冲）；④ 备份命令能产出非空 `.db`，拷到另一台机器也能打开。

## 参考链接
- Cloudflare Tunnel（所有计划可用、无需公网 IP）：https://developers.cloudflare.com/tunnel/
- Cloudflare Quick Tunnel（临时地址、200 in-flight、不支持 SSE）：https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
- Oracle Always Free 资源额度与回收条款：https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Fly.io 免费试用（新号一次性试用，额度/期限/卷大小以官网页为准）：https://fly.io/docs/about/free-trial/
- Railway 价格与 Free 档限制：https://railway.com/pricing
- Render 免费档（15 分钟休眠、无持久盘、750 小时）：https://render.com/docs/free
- Koyeb 价格（Free 5h、Small $29.76/月起）：https://www.koyeb.com/pricing
- 腾讯云云+校园（学生机规格与限购）：https://cloud.tencent.com/act/campus
- 阿里云高校计划（学生 300 元优惠券）：https://university.aliyun.com/
- ICP 备案规定与未备案后果：https://help.aliyun.com/zh/icp-filing/
- 安全上下文（HTTPS 才能用摄像头/剪贴板）：https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
- Node.js 下载（≥22.13）：https://nodejs.org/en/download
- 项目仓库：https://github.com/JinCV0/banping
- 许可证：AGPL-3.0（仓库根目录 `LICENSE`）。自己部署、自己改造都允许；把改过的版本作为网络服务提供给他人时，要按 AGPL 提供源码。
