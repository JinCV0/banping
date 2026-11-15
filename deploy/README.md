# 部署到自己的 VPS（Ubuntu / Debian + Docker + 域名）

> 两种形态，先看你的机器属于哪种：
>
> - **机器上已经跑着 nginx（占着 80/443）** → 看下面的「附：已有 nginx 的机器」，不要用本目录的 compose，会抢端口。`board.hibot.ink` 就是这么上的。
> - **干净的机器** → 按下面正文走 compose + Caddy 全自动。

一台 2C2G 的机器对这个服务严重过剩：空转内存约 70 MB，上百块大屏的 SSE 长连接也涨不到 100 MB，断开后回落、不积累。真正要留意的只有磁盘（镜像约 200 MB）和 80/443 端口能不能通。

## 附：已有 nginx 的机器（board.hibot.ink 的实际形态）

不装 Caddy、不用 Docker（镜像在部分机房里拉不动），只跑 Node + 复用 nginx：

```bash
# 1. 代码：git archive 打包 + scp 上传到 /srv/board（备份 → 重启 → 健康检查）
#    重启前先备份 /var/lib/class-board/publish.db 到 backup-<时间>.db（留最近 10 份）——
#    启动时会把老库的 v1 看板快照就地升级成 v3，没有备份就只能靠每日备份回滚。
#    或手工：git archive --format=tar -o b.tar HEAD && scp b.tar root@<vps>:/tmp/ && ssh ... 'tar -xf /tmp/b.tar -C /srv/board'

# 2. 服务账号与数据目录
useradd --system --home /srv/board --shell /sbin/nologin classboard
mkdir -p /var/lib/class-board && chown -R classboard:classboard /srv/board /var/lib/class-board

# 3. systemd（完整单元见 /etc/systemd/system/class-board.service）
#    HOST=127.0.0.1 PORT=8787 DB_PATH=/var/lib/class-board/publish.db
#    CLAIM_KEY_SECRET=<本机 node publish-api/tools/claim-key.mjs --init 打印的那串>   ← 开通密钥的种子，没配就谁也不能新建班级
#    LICENSE_DAYS=365                                                     ← 可选，建班时写进班级的服务期（天）
#    INVITE_HINT=没有开通密钥？到小红书 26225307944 联系作者获取                    ← 可选，老师端"创建班级"页的提示，留空不显示
#    建议写成 EnvironmentFile=/etc/class-board.env，改密钥不用动 unit 文件
systemctl enable --now class-board

# 4. nginx 443 反代（/etc/nginx/conf.d/board.conf）
#    upstream class_board { server 127.0.0.1:8787; keepalive 8; }
#    proxy_buffering off; proxy_request_buffering off; proxy_read_timeout 3600s;  # SSE
```

**证书**：如果 80 端口被云厂商拦（连 `/.well-known/acme-challenge/` 都 403），HTTP-01 走不通，用 TLS-ALPN-01，签发时让 nginx 让位十几秒：

```bash
systemctl stop nginx
/root/.acme.sh/acme.sh --issue --alpn -d board.example.com --keylength ec-256
systemctl start nginx
/root/.acme.sh/acme.sh --install-cert -d board.example.com --ecc \
  --key-file /etc/nginx/tls/board.crt.key --fullchain-file /etc/nginx/tls/board.crt \
  --reloadcmd "systemctl reload nginx"
# 续期也要让位，把钩子写进 acme.sh 的域名配置，cron 到点会自动执行：
#   Le_PreHook='systemctl stop nginx'   Le_PostHook='systemctl start nginx'
```

**每日备份**（`/etc/cron.daily/class-board-backup`，保留 14 天）：

```sh
cd /srv/board/publish-api || exit 0
runuser -u classboard -- node tools/backup.mjs /var/lib/class-board/publish.db \
  /var/lib/class-board/backups/publish-$(date +%F).db >/dev/null 2>&1
find /var/lib/class-board/backups -name 'publish-*.db' -mtime +14 -delete
```

目录结构：

```
/srv/board
├── Dockerfile              # 已存在，compose 复用它
├── board-web/              # 渲染层（会被打进镜像）
├── publish-api/            # 服务端 + 老师端 h5
└── deploy/
    ├── docker-compose.yml  # app + caddy（干净机器用）
    ├── Caddyfile           # 自动 HTTPS + SSE 关缓冲
    ├── systemd + nginx 示例  # 已有 nginx 的机器：见「附：已有 nginx 的机器」
    ├── .env                # 你填：BOARD_DOMAIN / ACME_EMAIL
    └── data/               # 卷：publish.db（唯一需要备份的东西）
```

## 1. 域名解析

```
# 在你买域名的地方加一条 A 记录
board.example.com  →  <VPS 公网 IP>

# 生效后确认（在任意机器）
nslookup board.example.com
```

## 2. 装 Docker（Ubuntu / Debian）

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 之后重新登录一次，不然 docker 要 sudo
docker --version && docker compose version
```

## 3. 放行端口

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## 4. 把代码放到 `/srv/board`

仓库是公开的，直接 clone 即可（不需要 token）：

```bash
# A. 在 VPS 上直接拉
sudo mkdir -p /srv/board && sudo chown $USER /srv/board
git clone --depth 1 https://github.com/JinCV0/banping.git /srv/board

# B. 从自己电脑推（没有外网 git 权限时）
#   本机在仓库根目录执行：scp -r . <user>@<vps>:/srv/board
```

注意：代码是用 `git archive` 打包 + scp 上传的，而不是在 VPS 上 `git pull`——服务器上的 `/srv/board` 没有 `.git` 是正常的，别再对它 `git pull`。

## 5. 填域名

```bash
cd /srv/board/deploy
cp .env.example .env
nano .env      # BOARD_DOMAIN=board.example.com / ACME_EMAIL=你的邮箱
mkdir -p data
```

## 6. 起服务

```bash
cd /srv/board/deploy
docker compose up -d --build
docker compose ps                 # 两个容器都 healthy / running
docker compose logs -f caddy      # 看证书签发：certificate obtained successfully
```

Caddy 拿到证书后会一直续期，不用管。

## 7. 自检（在你自己电脑上跑）

```powershell
cd publish-api
node tools/verify-remote.mjs https://board.example.com
```

七项全过说明：接口、老师端页面、渲染层、静态脚本、公开契约都对；最后一项"无令牌拉看板应 401"也顺带验证了权限没漏。

## 8. 建第一个班 + 接线大屏

```powershell
node tools/demo.mjs --api https://board.example.com --days 97
```

打印出来的班级码给班主任在 `https://board.example.com/` 登录用；配对码喂给教室里的宿主：

```powershell
BoardHost.exe --url <看板页面路径> --api https://board.example.com --pair <配对码>
```

配对成功后 token 落在宿主的 `cache/device.token`，之后重启不再需要配对码。

## 日常维护

```bash
# 更新代码
cd /srv/board && git pull && cd deploy && docker compose up -d --build

# 不停服备份（VACUUM INTO 生成自洽单文件，落在 ./data/backups/）
docker compose exec board node tools/backup.mjs /data/publish.db /data/backups/publish-$(date +%F).db

# 看日志
docker compose logs -f board
```

## 出问题先看这三处

| 症状 | 先查 |
| --- | --- |
| 浏览器打不开、证书报错 | `docker compose logs caddy`：域名解析没生效、或 80 端口被占用（Let's Encrypt 要验证 80/443） |
| 页面能开，大屏不更新 | 老师端保存后看 `docker compose logs board` 有没有 `推送 N 块大屏`；SSE 被缓冲通常是 `flush_interval -1` 丢了 |
| 重新部署后班级码变了 | `deploy/data` 没挂上或被清空——`DB_PATH=/data/publish.db` 与 `./data:/data` 必须同时成立 |
| 想换机器 | `data/publish.db` 拷过去即可，全是普通 SQLite 文件 |

## 只能跑一个实例

SQLite 单写者，且 SSE 连接表在进程内存里。别用 `docker compose scale board=2`，会出现"大屏有时在线有时离线"。
