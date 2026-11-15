# 班屏 安装包

双击 `班屏-<版本>.msi`（Releases 里下，或见下文「重新打包」）就能装，不需要管理员，也不需要装 .NET（exe 是自包含单文件，只需系统自带 WebView2 Runtime，Win10 1803 之后都带）。

## 装了什么

| 位置 | 内容 |
| --- | --- |
| `%LOCALAPPDATA%\班屏\` | `BoardHost.exe`（140 MB 单文件，含 .NET 运行时） |
| 桌面 | 「班屏」快捷方式 |
| 开始菜单 | 「班屏」 |
| 启动文件夹 | 「班屏」——开机自动挂到壁纸层，教室电脑开机就该出现，不用人去点 |

卸载走「设置 → 应用 → 班屏」，或者再点一次安装包选卸载；桌面、开始菜单、启动项会一起清掉。

## 怎么退出、怎么重新配对

壁纸宿主本身不占任务栏，所有入口都在**系统托盘**：任务栏右下角的 `^` 里能找到「班屏」图标（深绿小方块），右键是

| 菜单项 | 作用 |
| --- | --- |
| 打开老师端 | 浏览器打开 `https://board.hibot.ink/`（装在内网就用 `host.json` 里那个地址） |
| 重新配对… | 让这块屏立刻失效、重新显示配对码，再用手机重新绑。班级换了、屏挪到别的教室时用 |
| 退出班屏 | 退出并还原桌面壁纸（双击图标也是打开老师端） |


**运行时数据不放在安装目录**：缓存、令牌、日志、WebView2 用户数据都在 `%LOCALAPPDATA%\ClassBoard\`（`logs\host.log` 是排障第一站）。安装目录是只读的，往那里写会直接起不来。

## 装完第一次打开

exe 没参数时默认连 **https://board.hibot.ink**，打开 `/board/index.html`：

- 没绑定过 → 右下角出现 6 位配对码 + 二维码，老师手机扫码即可绑定；
- 绑定过 → 直接用缓存的设备令牌拉状态。

## 服务架在自己内网时

在 `%LOCALAPPDATA%\班屏\` 放一个 `host.json`：

```json
{ "server": "http://10.0.0.5:8787" }
```

也可以直接用命令行覆盖（快捷方式属性里加参数即可）：

```
BoardHost.exe --api http://10.0.0.5:8787
BoardHost.exe --url https://board.example.com/board/index.html
```

优先级：`--url` > `--api` > `host.json` > exe 旁边向上 5 层内的 `board-web/`（便携/开发用）> 默认线上服务。

## 重新打包

版本号**唯一来源**是仓库根目录的 `version.json`，脚本、安装包、exe 的版本都从它推出来，不用手改任何文件。

```powershell
pwsh -File scripts\doctor.ps1                     # 先体检：node≥22 / .NET 8 SDK / WiX 5
pwsh -File scripts\build-installer.ps1            # 出 dist\班屏-<版本>.msi
pwsh -File scripts\build-installer.ps1 -SkipIcons # 图标已入库时用这个（不依赖 Edge）
pwsh -File scripts\verify-msi.ps1 -Msi dist\班屏-<版本>.msi   # 不用真装就能验
```

它做四件事：`node design/make-icons.mjs` 生成图标（`-SkipIcons` 可跳）→ `dotnet publish` 出单文件 exe 到 `dist\app` → `wix build -d ProductVersion=…` 打 msi → 写 `dist\build-info.json`（版本、git 提交、是否脏、sha256、工具版本）和 `.sha256.txt`。

打包机需要 WiX 5：`dotnet tool install --global wix --version 5.0.2`。**别装 WiX 7**——从 7 开始 `wix build` 要求先接受 OSMF 付费条款（`error WIX7015`）。

不想在本机打：打 `vX.Y.Z` tag 后由 GitHub Actions（`.github/workflows/build-msi.yml`）在 windows-latest 上打包、真装真卸验收、挂 Release。要发版就改 `version.json` 再打 tag，tag 对不上版本号 CI 会直接失败。

`dist\build-info.json` 里 `gitDirty: true` 说明构建时工作区有未提交改动，这种产物别发。

## 还没做的

- **代码签名**：现在 msi 和 exe 都没签名，别人电脑上第一次运行会被 SmartScreen 拦一下（"更多信息 → 仍要运行"）。要消掉得买 OV/EV 证书，`signtool sign /fd sha256 /a`，msi 和 exe 各签一次。
- 静默安装参数（`/qn`）能用于机房批量部署，但还没有"装的时候就把服务地址写进 host.json"的选项；批量场景可以装完后统一往 `%LOCALAPPDATA%\班屏\host.json` 推一份。

## 从旧版升上来

1.0 起运行数据搬到 `%LOCALAPPDATA%\ClassBoard\`。已经在教室电脑上配好对的机器，升上来**不会丢配对**：宿主启动时如果新目录里没有 `device.token`，会去 exe 旁边的 `cache\`（旧版的位置）和 `%LOCALAPPDATA%\BoardHost\cache\` 找一份搬过来，日志里会有一行 `cache: 从老目录接管了配对信息 …`。

旧缓存里如果还是 v1 快照（`"version": 1`），会被跳过不画——v1 字段对不上 v2 版面，画出来就是一屏空板子；联网后 0.4 秒内会用服务端的新数据替换。
