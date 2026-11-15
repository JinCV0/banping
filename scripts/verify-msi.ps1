# 校验安装包，不需要人肉点一遍。
#
#   pwsh -File scripts\verify-msi.ps1 -Msi dist\班屏-1.1.3.msi        # 安全模式：只解包 + 读版本
#   pwsh -File scripts\verify-msi.ps1 -Msi ... -Full                  # 真装一遍再卸掉（CI 用；会改本机状态）
#
# 默认模式做两件事，都不落地任何安装记录、不改本机状态：
#   1) 读 msi 的 ProductVersion，必须等于 version.json —— 这就是"版本号 4 处手抄"那个老坑的守卫
#   2) msiexec /a 管理安装解包到临时目录，断言 BoardHost.exe 在里面（失败会在临时目录留日志后删除）
#
# -Full 模式另外断言：装完 %LOCALAPPDATA%\班屏\BoardHost.exe、桌面/开始菜单/启动项三个快捷方式都在，
# 卸载后全部清掉。本机已经装过班屏时会拒绝执行（-AllowReplace 才强来），避免把真实安装卸掉。
param(
    [Parameter(Mandatory = $true)][string]$Msi,
    [switch]$Full,
    [switch]$AllowReplace
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Assert($cond, $msg) {
    if (-not $cond) { throw "断言失败：$msg" }
}

function Wait-Path($path, [bool]$exists, [int]$timeoutSec = 20) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ((Test-Path $path) -eq $exists) { return $true }
        Start-Sleep -Milliseconds 300
    }
    return ((Test-Path $path) -eq $exists)
}

$msiPath = (Resolve-Path $Msi).Path
Assert (Test-Path $msiPath) "找不到安装包：$Msi"
Write-Host "安装包：$msiPath（$([math]::Round((Get-Item $msiPath).Length / 1MB, 1)) MB）"

# ---------- 1. ProductVersion 必须等于 version.json ----------
$want = (Get-Content -Raw (Join-Path $root "version.json") | ConvertFrom-Json).version
$inst = New-Object -ComObject WindowsInstaller.Installer
$db = $inst.OpenDatabase($msiPath, 0)
$sql = 'SELECT `Value` FROM `Property` WHERE `Property` = ''ProductVersion'''
$view = $db.OpenView($sql)
$view.Execute()
$rec = $view.Fetch()
Assert ($null -ne $rec) "msi 里读不到 ProductVersion"
$got = $rec.StringData(1)
Assert ($got -eq $want) "msi 版本是 $got，version.json 是 $want（改版本没同步？）"
Write-Host "✓ ProductVersion = $got"
# 松开对 msi 的文件占用，否则后面重打/移动会失败
foreach ($o in @($rec, $view, $db)) { if ($o) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o) } }
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($inst)

# ---------- 2. 解包后 payload 完整 ----------
$tmp = Join-Path $env:TEMP ("board-msi-check-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $log = Join-Path $tmp "extract.log"
    $p = Start-Process msiexec -Wait -PassThru -ArgumentList @(
        "/a", "`"$msiPath`"", "/qn", "/norestart", "TARGETDIR=`"$tmp\out`"", "/l*v", "`"$log`""
    )
    Assert ($p.ExitCode -in 0, 3010) "管理安装失败（exit $($p.ExitCode)），日志：$log"
    $exe = Get-ChildItem $tmp -Recurse -Filter BoardHost.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    Assert ($null -ne $exe) "解包里没有 BoardHost.exe"
    Assert ($exe.Length -gt 100MB) "BoardHost.exe 只有 $([math]::Round($exe.Length / 1MB, 1)) MB，不像是自包含单文件"
    Write-Host "✓ payload 含 BoardHost.exe（$([math]::Round($exe.Length / 1MB, 1)) MB）"
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------- 3. -Full：真装 / 卸 ----------
if (-not $Full) {
    Write-Host ""
    Write-Host "通过（安全模式）。要连安装/卸载一起验：加 -Full"
    exit 0
}

$installDir = Join-Path $env:LOCALAPPDATA "班屏"
$targets = @(
    (Join-Path $installDir "BoardHost.exe"),
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "班屏.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Startup")) "班屏.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\班屏\班屏.lnk")
)

$already = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "班屏" } | Select-Object -First 1)
if ($already -and -not $AllowReplace) {
    throw "本机已安装班屏（$($already.DisplayVersion)）。-Full 会把它卸掉，确认要替换再加 -AllowReplace。"
}

Write-Host ""
Write-Host "静默安装…"
$p = Start-Process msiexec -Wait -PassThru -ArgumentList @(
    "/i", "`"$msiPath`"", "/qn", "/norestart", "/l*v", "`"$env:TEMP\board-msi-install.log`""
)
Assert ($p.ExitCode -in 0, 3010) "安装失败（exit $($p.ExitCode)），日志：$env:TEMP\board-msi-install.log"
foreach ($t in $targets) { Assert (Wait-Path $t $true) "装完没有 $t" }
Write-Host "✓ 安装后文件与三个快捷方式都在"

Write-Host "静默卸载…"
$p = Start-Process msiexec -Wait -PassThru -ArgumentList @(
    "/x", "`"$msiPath`"", "/qn", "/norestart", "/l*v", "`"$env:TEMP\board-msi-uninstall.log`""
)
Assert ($p.ExitCode -in 0, 3010) "卸载失败（exit $($p.ExitCode)），日志：$env:TEMP\board-msi-uninstall.log"
foreach ($t in $targets) { Assert (Wait-Path $t $false) "卸载后还残留 $t" }
Write-Host "✓ 卸载后清干净"

Write-Host ""
Write-Host "通过（安装 + 卸载）。"
