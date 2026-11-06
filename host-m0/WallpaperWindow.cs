using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BoardHost;

/// <summary>
/// 宿主窗口：一件大事——把自己变成壁纸。渲染全交给 WebView2 里的 board.html。
/// 挂不上就降级为置底全屏，绝不黑屏。
/// </summary>
internal sealed class WallpaperWindow : Form
{
    private readonly HostConfig _config;
    private readonly System.Windows.Forms.Timer _watchdog = new();
    private readonly StateCache _cache;
    private WebView2? _web;
    private WebTransport? _transport;
    private BoardSync? _sync;
    private DesktopWallpaper? _wallpaper;
    private TrayIcon? _tray;
    private bool _fallback;
    private int _failStreak;
    private int _guardTicks;

    public WallpaperWindow(HostConfig config, StateCache cache)
    {
        _config = config;
        _cache = cache;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(47, 73, 60);
        Bounds = PrimaryScreenRect();
        Text = "BoardHost";
    }

    private static Rectangle PrimaryScreenRect() =>
        (Screen.PrimaryScreen ?? throw new InvalidOperationException("没有可用屏幕")).Bounds;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
            return cp;
        }
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);

        try
        {
            await StartWebAsync();
        }
        catch (Exception ex)
        {
            HostLog.Write("webview init failed: " + ex.Message);
        }

        EnsureWallpaper("startup");

        // 壁纸层没有任务栏入口，托盘是唯一能"看见它、也能退出它"的地方
        _tray = new TrayIcon(
            _config,
            paired: () => _sync?.IsPaired ?? false,
            repin: () => _sync?.RepinAsync() ?? Task.CompletedTask);

        _watchdog.Interval = Math.Max(1000, _config.WatchdogSeconds * 1000);
        _watchdog.Tick += (_, _) => Guard();
        _watchdog.Start();
    }

    private async Task StartWebAsync()
    {
        _web = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(47, 73, 60),
        };
        Controls.Add(_web);

        var env = await CoreWebView2Environment.CreateAsync(null, _config.UserDataFolder);
        await _web.EnsureCoreWebView2Async(env);

        var settings = _web.CoreWebView2.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.AreDevToolsEnabled = true;
        settings.IsZoomControlEnabled = false;
        settings.IsBuiltInErrorPageEnabled = true;
        settings.IsWebMessageEnabled = true; // 页面要向宿主回传配对结果

        _web.CoreWebView2.NavigationCompleted += async (_, args) =>
        {
            HostLog.Write($"navigation completed ok={args.IsSuccess} url={_web.CoreWebView2.Source}");
            if (args.IsSuccess && _sync is not null) await _sync.AfterNavigationAsync();
        };
        _web.CoreWebView2.ProcessFailed += (_, args) =>
            HostLog.Write($"webview process failed: {args.ProcessFailedKind}");

        // 传输层也走这条 WebView2：服务端通信和页面渲染共用同一套 TLS，
        // 不再另开 HttpClient（Schannel 在某些网络上会被掐断，见 WebTransport 注释）。
        _transport = new WebTransport(_web.CoreWebView2);
        await _transport.InstallAsync();

        _sync = new BoardSync(_web, _config, _cache, _transport);
        await _sync.BeforeNavigateAsync();

        // 页面 → 宿主：配对成功/解除配对。传输桥也挂在同一个事件上，
        // 两边各自只认自己那套报文（这里是 type，那边是 kind/id），互不干扰。
        _web.CoreWebView2.WebMessageReceived += OnPageMessage;

        _web.CoreWebView2.Navigate(_config.StartUrl);
        HostLog.Write("webview ready -> " + _config.StartUrl);
    }

    private void OnPageMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            _sync?.HandlePageMessage(e.WebMessageAsJson);
        }
        catch (Exception ex)
        {
            HostLog.Write("pair: 页面消息转发失败（" + ex.Message + "）");
        }
    }

    private void EnsureWallpaper(string reason)
    {
        _wallpaper ??= new DesktopWallpaper(Handle);
        var screen = PrimaryScreenRect();
        var ok = _wallpaper.TryMount(screen.Width, screen.Height);
        HostLog.Write(
            $"mount[{reason}] outcome={_wallpaper.LastOutcome} " +
            $"mounted={_wallpaper.IsMounted} workerw=0x{_wallpaper.WorkerW.ToInt64():X}");

        if (ok)
        {
            _fallback = false;
            _failStreak = 0;
            Native.MoveWindow(Handle, 0, 0, screen.Width, screen.Height, true);
            return;
        }

        _failStreak++;
        if (_config.Fallback && _failStreak >= _config.FallbackAfterFailures)
            ApplyFallback(screen, reason);
    }

    private void ApplyFallback(Rectangle screen, string reason)
    {
        _fallback = true;
        _wallpaper?.Detach();

        var style = Native.GetWindowLongPtr(Handle, Native.GWL_STYLE).ToInt64();
        style &= ~(Native.WS_CHILD | Native.WS_CAPTION | Native.WS_THICKFRAME);
        style |= Native.WS_POPUP | Native.WS_VISIBLE;
        Native.SetWindowLongPtr(Handle, Native.GWL_STYLE, new IntPtr(style));

        Native.SetWindowPos(
            Handle, Native.HWND_BOTTOM, screen.X, screen.Y, screen.Width, screen.Height,
            Native.SWP_SHOWWINDOW);

        HostLog.Write($"FALLBACK -> 置底全屏（{reason}）");
    }

    private void Guard()
    {
        _guardTicks++;
        var screen = PrimaryScreenRect();

        if (_wallpaper is null)
        {
            EnsureWallpaper("guard-null");
            return;
        }

        if (_fallback)
        {
            // 降级态每 3 轮尝试恢复壁纸层（例如美化软件退出后）
            if (_guardTicks % 3 == 0) EnsureWallpaper("fallback-retry");
            return;
        }

        if (!_wallpaper.IsMounted)
        {
            HostLog.Write("watchdog: 挂载丢失，重新挂载");
            EnsureWallpaper("watchdog");
            return;
        }

        if (Bounds.Width != screen.Width || Bounds.Height != screen.Height)
        {
            HostLog.Write($"watchdog: 尺寸不符 {Bounds.Width}x{Bounds.Height} -> {screen.Width}x{screen.Height}");
            Native.MoveWindow(Handle, 0, 0, screen.Width, screen.Height, true);
        }
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);

        if (m.Msg is (int)Native.WM_DISPLAYCHANGE or (int)Native.WM_DPICHANGED or (int)Native.WM_SETTINGCHANGE)
        {
            HostLog.Write($"wndproc 0x{m.Msg:X}，重新挂载");
            if (IsHandleCreated) BeginInvoke(new Action(() => EnsureWallpaper("display-change")));
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _tray?.Dispose();
        _watchdog.Stop();
        _watchdog.Dispose();
        _wallpaper?.Detach();
        if (_web?.CoreWebView2 is { } core) core.WebMessageReceived -= OnPageMessage;
        _sync?.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(2));
        _transport?.Dispose();
        base.OnFormClosed(e);
    }
}
