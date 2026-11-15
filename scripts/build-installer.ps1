# 一条命令出安装包：版本号 → 图标（可跳过）→ 单文件 exe → msi → 校验清单
#
#   pwsh -File scripts\build-installer.ps1
#   pwsh -File scripts\build-installer.ps1 -SkipIcons        # 图标已入库，CI 里用这个（不依赖 Edge）
#   pwsh -File scripts\build-installer.ps1 -Version 1.1.4    # 临时覆盖版本号（发版请改 version.json）
#
# 版本号唯一来源是根目录 version.json；改版本只改那一个文件。
# 需要：.NET 8 SDK、wix 5（dotnet tool install --global wix --version 5.0.2）。
# 别装 WiX 7：从 7 开始 wix build 要求先接受 OMF 付费条款（error WIX7015）。
#
# 产物：
#   dist\班屏-<版本>.msi
#   dist\班屏-<版本>.msi.sha256.txt   一行，给 Release 附件和装机方核对
#   dist\build-info.json              版本 / git 提交 / sha256 / 工具版本 / 大小
param(
    [string]$Version,
    [string]$EdgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    [switch]$SkipIcons
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    # ---- 版本号：version.json 是唯一来源 ----
    $versionFile = Join-Path $root "version.json"
    if (-not (Test-Path $versionFile)) { throw "找不到 version.json（版本号的唯一来源）" }
    $ver = if ($Version) { $Version } else { (Get-Content -Raw $versionFile | ConvertFrom-Json).version }
    if ($ver -notmatch '^\d+\.\d+\.\d+$') { throw "版本号格式不对：'$ver'（要 主.次.修，如 1.1.4）" }

    Write-Host "[1/4] 生成图标$(if ($SkipIcons) { '（跳过：-SkipIcons）' } else { '' })"
    if (-not $SkipIcons) {
        if (-not (Test-Path $EdgePath)) { throw "找不到 Edge：$EdgePath。图标已入库，可用 -SkipIcons 跳过。" }
        $env:EDGE_PATH = $EdgePath
        node design/make-icons.mjs
        if ($LASTEXITCODE -ne 0) { throw "生成图标失败" }
    }

    Write-Host "[2/4] 发布单文件 exe（版本 $ver）"
    if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
        throw "找不到 wix。装 WiX 5：dotnet tool install --global wix --version 5.0.2"
    }
    # 四个版本属性一起传，避免 exe 文件属性、程序集版本、msi 版本各说各话
    dotnet publish host-m0 -c Release -r win-x64 --self-contained true `
        -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
        "-p:Version=$ver" "-p:FileVersion=$ver.0" "-p:AssemblyVersion=$ver.0" "-p:InformationalVersion=$ver" `
        -o dist\app
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish 失败" }

    Write-Host "[3/4] 打 msi"
    $msi = Join-Path $root "dist\班屏-$ver.msi"
    wix build installer\BoardHost.wxs -arch x64 -d "ProductVersion=$ver" -o $msi
    if ($LASTEXITCODE -ne 0) { throw "wix build 失败（检查 -d ProductVersion 是否传进去了）" }

    Write-Host "[4/4] 记校验清单"
    $msiItem = Get-Item $msi
    $sha = (Get-FileHash -Algorithm SHA256 -Path $msi).Hash.ToLower()
    "$sha  班屏-$ver.msi" | Set-Content -Encoding utf8 "$msi.sha256.txt"
    $commit = (git rev-parse HEAD 2>$null | Out-String).Trim()
    $dirty = ((git status --porcelain 2>$null | Out-String).Trim()).Length -gt 0
    $info = [ordered]@{
        product     = "班屏"
        version     = $ver
        builtAt     = (Get-Date).ToString("o")
        gitCommit   = $commit
        gitDirty    = $dirty
        installFile = $msiItem.Name
        msiBytes    = $msiItem.Length
        msiSha256   = $sha
        exeBytes    = (Get-Item "dist\app\BoardHost.exe").Length
        tools       = [ordered]@{
            node   = (& node --version)
            dotnet = (& dotnet --version)
            wix    = ((& wix --version) -join "").Trim()
        }
    }
    $info | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $root "dist\build-info.json")

    $mb = [math]::Round($msiItem.Length / 1MB, 1)
    Write-Host ""
    Write-Host "完成：$msi（$mb MB）"
    Write-Host "BUILD OK version=$ver sha256=$sha"
}
finally {
    Pop-Location
}
