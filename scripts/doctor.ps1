# 打包机体检：缺什么直接给安装命令。
#
#   pwsh -File scripts/doctor.ps1
#
# 退出码 0 = 能打包；1 = 缺必装项。Edge 缺失只警告（图标已入库，可用 -SkipIcons）。
param()

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$fail = 0

function Ok($name, $detail) { Write-Host ("  ✓ {0,-10} {1}" -f $name, $detail) }
function Bad($name, $hint) { Write-Host ("  ✗ {0,-10} {1}" -f $name, $hint) -ForegroundColor Red; $script:fail++ }
function Warn($name, $detail) { Write-Host ("  ! {0,-10} {1}" -f $name, $detail) -ForegroundColor Yellow }

Write-Host "班屏打包机体检（$env:COMPUTERNAME）"

# Node：publish-api 要 22.13+（node:sqlite），图标脚本任意
$node = & node --version 2>$null
if (-not $node) {
    Bad "node" "没装。装 Node 24 LTS：winget install OpenJS.NodeJS.LTS"
} else {
    $major = [int](($node -replace '^v', '') -split '\.')[0]
    if ($major -ge 22) { Ok "node" $node } else { Bad "node" "版本 $node 太老，要 ≥22.13" }
}

# .NET SDK：host-m0 是 net8.0-windows
$sdk = & dotnet --version 2>$null
if (-not $sdk) {
    Bad "dotnet" "没装 .NET 8 SDK：winget install Microsoft.DotNet.SDK.8"
} else {
    $major = [int](($sdk -split '\.')[0])
    if ($major -ge 8) { Ok "dotnet" "SDK $sdk" } else { Bad "dotnet" "SDK $sdk 太老，要 8 起" }
}

# WiX：必须 5.x，7 起要付费条款
$wix = (& wix --version 2>$null) -join ''
if (-not $wix) {
    Bad "wix" "没装。dotnet tool install --global wix --version 5.0.2"
} elseif ($wix -match '^7\.') {
    Bad "wix" "$wix 是 7，会报 WIX7015。降到 5：dotnet tool install --global wix --version 5.0.2"
} elseif ($wix -match '^5\.') {
    Ok "wix" $wix
} else {
    Warn "wix" "$wix 不是 5.x，行为可能不同"
}

# Edge：只在生成图标时用，图标已入库
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (Test-Path $edge) { Ok "edge" "在（仅 -SkipIcons 之外才需要）" }
else { Warn "edge" "不在 $edge；用 -SkipIcons 跳过图标步骤即可" }

# git：build-info.json 要记提交号
$git = & git --version 2>$null
if ($git) { Ok "git" $git } else { Bad "git" "没装 git，build-info.json 记不到提交号" }

# version.json
$vf = Join-Path $root "version.json"
if (Test-Path $vf) {
    try {
        $v = (Get-Content -Raw $vf | ConvertFrom-Json).version
        if ($v -match '^\d+\.\d+\.\d+$') { Ok "version" "$v（唯一来源）" } else { Bad "version" "version.json 里是 '$v'，要 主.次.修" }
    } catch { Bad "version" "version.json 解析失败：$($_.Exception.Message)" }
} else { Bad "version" "缺 version.json" }

Write-Host ""
if ($fail -gt 0) { Write-Host "$fail 项必装项缺失，先补齐。" ; exit 1 }
Write-Host "可以打包：pwsh -File scripts/build-installer.ps1"
exit 0
