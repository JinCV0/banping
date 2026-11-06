namespace BoardHost;

/// <summary>宿主配置。M0 阶段用命令行/默认值，M4 再改成设置页。</summary>
internal sealed class HostConfig
{
    /// <summary>
    /// 没给参数时的默认服务地址：本机开发时跑的 publish-api。
    /// 正式部署请用 --api / --url 指定，或在 exe 旁边放 host.json 写 {"server": "https://你的域名"}。
    /// </summary>
    public const string DefaultServer = "http://127.0.0.1:8787";

    /// <summary>页面地址：--url > --api 的同源页 > host.json 里的服务 > 仓库里的 board-web > 默认服务。</summary>
    public string StartUrl { get; init; } = string.Empty;

    public string? RemoteUrl { get; init; }

    public int WatchdogSeconds { get; init; } = 5;

    public bool Fallback { get; init; } = true;

    public int FallbackAfterFailures { get; init; } = 2;

    /// <summary>
    /// 可写目录都放 %LOCALAPPDATA%\ClassBoard：装进 Program Files 之后，
    /// exe 同目录是只读的，缓存/日志/WebView2 用户数据写不进去会直接起不来。
    /// </summary>
    public string UserDataFolder { get; init; } =
        Path.Combine(HostPaths.Data, "webview-data");

    /// <summary>发布服务地址。为空表示纯本地渲染（file:// 看样例，不显示配对卡）。</summary>
    public string? ApiBase { get; init; }

    public string DeviceName { get; init; } = Environment.MachineName;

    public string CachePath { get; init; } = Path.Combine(HostPaths.Data, "cache", "state.json");

    public string TokenPath { get; init; } = Path.Combine(HostPaths.Data, "cache", "device.token");

    /// <summary>屏码/班级：配对时页面给的，下次注入 BOARD_HOST 用。</summary>
    public string DeviceMetaPath { get; init; } = Path.Combine(HostPaths.Data, "cache", "device.json");

    /// <summary>
    /// 能不能同步/配对：传输层是页面里的 fetch，必须页面与接口同源，否则被 CORS 挡掉。
    /// 非同源时宿主退化成"只渲染本地样例"，绝不显示一块点了没反应的配对卡。
    /// </summary>
    public bool CanSync { get; init; }

    public static HostConfig FromArgs(string[] args)
    {
        var remote = GetArg(args, "--url");
        var api = GetArg(args, "--api");

        // --pair 已废弃：配对方向反过来，改为大屏页面自己显示配对码、老师手机扫码。
        if (GetArg(args, "--pair") is not null)
            HostLog.Write("config: --pair 已废弃并忽略（配对码现在由大屏页面显示，老师扫码绑定）");

        var startUrl = ResolveStartUrl(remote, api);
        if (string.IsNullOrEmpty(startUrl))
        {
            HostLog.Write("config: 找不到渲染页，请用 --url <页面地址> 或 --api <服务地址> 指定");
            startUrl = WriteMissingPageHint();
        }

        // 没给 --api，但页面本身就是 http(s)：按页面源推断接口地址（同源，天然可配对）。
        var apiBase = api;
        if (string.IsNullOrWhiteSpace(apiBase) && OriginOf(startUrl) is { } inferred)
        {
            apiBase = inferred;
            HostLog.Write("config: 没给 --api，按页面同源推断接口地址 " + apiBase);
        }

        // 只比源（scheme://host:port）：接口挂在 /school 这类子路径下也算同源。
        var sameOrigin = OriginOf(apiBase) is { } apiOrigin
                         && OriginOf(startUrl) is { } pageOrigin
                         && string.Equals(apiOrigin, pageOrigin, StringComparison.OrdinalIgnoreCase);

        if (!string.IsNullOrEmpty(apiBase) && !sameOrigin)
            HostLog.Write($"config: 页面 {startUrl} 与接口 {apiBase} 不同源，本次只渲染本地样例（不配对、不同步）");

        return new HostConfig
        {
            RemoteUrl = remote,
            ApiBase = apiBase,
            StartUrl = startUrl,
            CanSync = sameOrigin,
        };
    }

    private static string ResolveStartUrl(string? remote, string? api)
    {
        if (!string.IsNullOrWhiteSpace(remote)) return remote.Trim();

        // 有服务端地址：用服务端自己发的渲染层（/board/ 前缀挂在 board-web 上），
        // 同源才能让页面里的 fetch 和配对请求都通。
        if (!string.IsNullOrWhiteSpace(api))
            return api.TrimEnd('/') + "/board/index.html";

        // 机房把服务架在自己内网时，在 exe 旁边放一个 host.json：{ "server": "http://10.0.0.5:8787" }
        if (ReadServerFromConfig() is { } configured)
        {
            HostLog.Write("config: 用 host.json 里的服务地址 " + configured);
            return configured.TrimEnd('/') + "/board/index.html";
        }

        // 什么都没给：仓库里的 board-web 样例，file:// 直接打开看渲染效果。
        if (FindLocalBoardPage() is { } local) return local;

        // 装好之后双击就得能用：默认连线上服务，页面自己会显示配对码。
        HostLog.Write("config: 没给参数也没找到本地 board-web，连默认服务 " + DefaultServer);
        return DefaultServer + "/board/index.html";
    }

    /// <summary>读 exe 旁边的 host.json（只认 server 一项，坏文件当没有）。</summary>
    private static string? ReadServerFromConfig()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "host.json");
            if (!File.Exists(path)) return null;
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
            if (!doc.RootElement.TryGetProperty("server", out var server)) return null;
            var value = server.GetString();
            if (string.IsNullOrWhiteSpace(value)) return null;
            if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)) return null;
            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;
            return value.Trim();
        }
        catch (Exception ex)
        {
            HostLog.Write("config: host.json 读不了，忽略：" + ex.Message);
            return null;
        }
    }

    /// <summary>
    /// 既没给 --api 也没找到 board-web 时的兜底：写一张说明页并导航过去。
    /// 桌面壁纸上白屏什么都不说，等于没法远程排障。
    /// </summary>
    private static string WriteMissingPageHint()
    {
        // 正常情况走不到这里（没参数也会连默认服务）；留着是为了"连默认服务也没配上"时别白屏。
        const string html =
            "<!doctype html><meta charset=\"utf-8\">" +
            "<style>html,body{margin:0;height:100%}body{display:flex;align-items:center;" +
            "justify-content:center;background:#0b1220;color:#e8eefc;" +
            "font:600 28px/1.7 'Microsoft YaHei',sans-serif;text-align:center}</style>" +
            "<div>找不到看板页面<br>" +
            "<span style=\"font-size:18px;font-weight:400;color:#8ea2c6\">" +
            "在 exe 旁边放 host.json 写上服务地址，或用 --api / --url 指定</span></div>";

        try
        {
            var dir = Path.Combine(HostPaths.Data, "cache");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "missing-page.html");
            File.WriteAllText(path, html);
            return new Uri(path).AbsoluteUri;
        }
        catch
        {
            return "about:blank";
        }
    }

    /// <summary>
    /// 只在 exe 所在目录向上找 board-web/index.html（最多 5 层，够仓库里的 bin/…/调试路径）。
    /// 不搜当前工作目录：否则从任何"顺手打开"的目录启动，都会捡到别处的 board-web，
    /// 变成"本地样例模式"——页面不显示配对码，装完看着像坏了。
    /// </summary>
    private static string? FindLocalBoardPage()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var depth = 0; depth < 5 && dir is not null; depth++)
        {
            var candidate = Path.Combine(dir.FullName, "board-web", "index.html");
            if (File.Exists(candidate)) return new Uri(candidate).AbsoluteUri;
            dir = dir.Parent;
        }

        return null;
    }

    /// <summary>http(s) 的源（scheme://host:port）；file:// 或非法地址返回 null。</summary>
    private static string? OriginOf(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;
        return uri.GetLeftPart(UriPartial.Authority);
    }

    private static string? GetArg(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        }

        return null;
    }
}

/// <summary>可写路径统一在这里：安装版不能往 Program Files 里写东西。</summary>
internal static class HostPaths
{
    public static string Data { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClassBoard");
}

/// <summary>文件日志。一体机上没有控制台，必须落盘才能远程排障。</summary>
internal static class HostLog
{
    private static readonly object Gate = new();
    private static string LogPath => Path.Combine(HostPaths.Data, "logs", "host.log");

    public static void Write(string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}";
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                File.AppendAllText(LogPath, line);
            }
        }
        catch
        {
            // 日志自身不能成为故障源
        }
    }
}
