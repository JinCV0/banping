# 班屏

> 教室里的那块屏。

把班级大屏做成桌面壁纸一样的存在：老师手机上改一改作业和课表，教室电脑的屏上就变了。不用开机、不用切窗口、不用每天手动更新。

![班屏图标](design/icon.svg)

## 它解决什么

- **课表填一次**：一周七天的课表录进去，之后每天按日期自己取今天该上的课；周末、放假、调休（周六上周三的课）都能表达。
- **作业天天填**：各科老师自己登进来只改自己那一科，班主任只管发布。
- **大屏自己会配对**：教室电脑上右下角出 6 位码和二维码，老师手机扫一下就绑上；一个班只绑一块屏，换屏要先解除。
- **不绑屏用不了**：班主任登录时没有绑定大屏，会直接被"先绑一块教室大屏"挡住，避免内容发出去没人看。
- **版面自己拖**：一块磁贴一个内容（作业、课表、待办、值日、通知、倒计时、点名、寄语），老师在手机/电脑上把磁贴拖到想要的位置、拉大小，大屏跟着变。
- **花名册 + 点名**：粘贴名单或传一份 CSV，值日按周/按天自动轮班；课堂上点「抽一个」，大屏上立刻亮出名字。
- **托盘里退得掉**：壁纸层没有窗口，右下角托盘图标右键就有「打开老师端 / 重新配对 / 退出班屏」。

## 三个部件

| 目录 | 是什么 |
| --- | --- |
| `board-web/` | 大屏渲染层，纯静态网页，按 `BoardState v3` 渲染成 12×8 磁贴 |
| `publish-api/` | 零依赖 Node 服务：接口 + 老师端网页（同一个进程） |
| `host-m0/` | Windows 宿主：把渲染层挂到桌面壁纸层（WorkerW）上，带托盘 |

## 装到教室电脑上

从 [Releases](https://github.com/JinCV0/banping/releases) 下 `班屏-<版本>.msi` 双击装。自己打也行（Windows，要 .NET 8 SDK + WiX 5，`pwsh -File scripts\doctor.ps1` 先体检）：

```powershell
pwsh -File scripts\build-installer.ps1 -SkipIcons   # 产物在 dist\，附 build-info.json 与 sha256
```

装完桌面出现「班屏」，并且**开机自动启动**——教室电脑开机就该看到那块屏，不用人去点。

- 不需要管理员，不需要装 .NET（自包含单文件；WebView2 Runtime 用系统自带的）。
- 第一次装完打开：默认连 `https://board.hibot.ink`（作者的官方实例，**开新班需要开通密钥**，见下节），右下角出 6 位配对码和二维码，老师手机扫码绑定。
- 服务架在内网：在 `%LOCALAPPDATA%\班屏\host.json` 写 `{"server": "http://10.0.0.5:8787"}`，或用 `BoardHost.exe --api http://10.0.0.5:8787`。
- 卸载走「设置 → 应用 → 班屏」。日志在 `%LOCALAPPDATA%\ClassBoard\logs\host.log`。

细节见 [installer/README.md](installer/README.md)。

## 别人用这套东西：两条路

`board.hibot.ink` 是作者自己的一台 VPS，**别人不能拿来用**。接手的人只有两条路：

**A. 自己部署服务端（推荐，免费方案也有）**

一台能常驻 Node ≥22 的机器就够（旧电脑/树莓派/免费云主机都行），跟大屏无关。完整步骤、方案对比、必填环境变量见 **[docs/SELF-DEPLOY.md](docs/SELF-DEPLOY.md)**。部署完把大屏指过去：

```powershell
'{"server":"https://你的域名"}' | Set-Content "$env:LOCALAPPDATA\班屏\host.json" -Encoding utf8
```

（也可以 `BoardHost.exe --api https://你的域名`。`host.json` 放在 exe 旁边，也就是安装目录 `%LOCALAPPDATA%\班屏\`。查找顺序：`--url` > `--api` > exe 旁的 `host.json` > 本地 `board-web/` > 默认的官方实例。）

**B. 用作者的官方实例（有限体验）**

装 Releases 里的 msi，默认就连 `board.hibot.ink`，但建班需要一把**开通密钥**：

- 在 [Issues](https://github.com/JinCV0/banping/issues) 留言（说明用途 + 要几个班），作者回你密钥；
- 一把密钥只能建一个班（一钥一班），班的服务期是 **90 天**（建班时写死，到期只拦"发布到大屏"，数据还在），续用找作者换新密钥；
- 官方实例的密钥在自建实例上无效，反之亦然（签名种子不同）。

想长期/多班用 → 走 A；只想先看看效果 → 走 B。

## 跑起来（开发）

```bash
cd publish-api && node main.js        # 老师端 → http://127.0.0.1:8787/
cd host-m0 && dotnet build            # 宿主 → bin/Debug/net8.0-windows/BoardHost.exe
```

部署、升级、备份见 [deploy/README.md](deploy/README.md)；接口与数据契约见 [publish-api/README.md](publish-api/README.md) 和 [docs/board-v3.md](docs/board-v3.md)；图标与命名见 [design/README.md](design/README.md)。

CI 在 `.github/workflows/`：网页服务端每次 push 跑冒烟 + 容器端到端，安装包在 Windows runner 上打，推 `vX.Y.Z` tag 时自动建 Release（版本号唯一来源是 `version.json`）。

## 域名

线上跑在 `https://board.hibot.ink/`（大屏页 `/board/`）。

## 许可证

**AGPL-3.0**（见 [LICENSE](LICENSE)）。可以自由使用、修改、自建部署；如果你把改过的版本作为网络服务对外提供，需要一并开放对应的源码。

之所以选 AGPL 而不是 MIT：这个项目本身就靠"托管服务"活着，AGPL 能防住"拿走代码闭源做个同款收费"，又不妨碍学校和老师自己部署。
