namespace BoardHost;

internal enum MountOutcome
{
    Ok,
    NoProgman,
    NoWorkerW,
    SetParentFailed,
}

/// <summary>
/// 壁纸层挂载器：把宿主窗口挂到桌面壁纸宿主 WorkerW 上（图标之下）。
/// 纯逻辑，不碰 UI 控件。手法参考 weebp(Unlicense) / octos(MIT)。
/// </summary>
internal sealed class DesktopWallpaper
{
    private readonly IntPtr _child;

    public DesktopWallpaper(IntPtr child) => _child = child;

    public IntPtr WorkerW { get; private set; }
    public MountOutcome LastOutcome { get; private set; } = MountOutcome.NoWorkerW;

    /// <summary>是否仍然正确挂在壁纸层上（看门狗每轮自检）。</summary>
    public bool IsMounted =>
        WorkerW != IntPtr.Zero && Native.IsWindow(WorkerW) && Native.GetParent(_child) == WorkerW;

    public bool TryMount(int width, int height)
    {
        LastOutcome = MountOutcome.NoProgman;
        var progman = Native.FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return false;

        var worker = FindWallpaperHost(progman, width, height);
        if (worker == IntPtr.Zero)
        {
            // 老版本 Windows 需要先让桌面把承载壁纸的 WorkerW 生出来
            Native.SendMessageTimeout(
                progman, Native.WM_SPAWN_WORKERW, IntPtr.Zero, IntPtr.Zero,
                Native.SMTO_NORMAL, 1000, out _);
            worker = FindWallpaperHost(progman, width, height);
        }

        if (worker == IntPtr.Zero)
        {
            LastOutcome = MountOutcome.NoWorkerW;
            return false;
        }

        // 子窗口化：去掉弹出/标题/边框，加 WS_CHILD，再挂到 WorkerW
        var style = Native.GetWindowLongPtr(_child, Native.GWL_STYLE).ToInt64();
        style &= ~(Native.WS_POPUP | Native.WS_CAPTION | Native.WS_THICKFRAME);
        style |= Native.WS_CHILD | Native.WS_VISIBLE;
        Native.SetWindowLongPtr(_child, Native.GWL_STYLE, new IntPtr(style));

        if (Native.SetParent(_child, worker) == IntPtr.Zero)
        {
            LastOutcome = MountOutcome.SetParentFailed;
            return false;
        }

        Native.MoveWindow(_child, 0, 0, width, height, true);
        WorkerW = worker;
        LastOutcome = MountOutcome.Ok;
        return true;
    }

    public void Detach()
    {
        if (WorkerW != IntPtr.Zero) Native.SetParent(_child, IntPtr.Zero);
        WorkerW = IntPtr.Zero;
    }

    /// <summary>
    /// 按可靠性从高到低找壁纸宿主：
    /// ① Progman 的直接子 WorkerW（Win11 22H2+ 实测：Progman 下只有 DefView 与这个 WorkerW）；
    /// ② 含 SHELLDLL_DefView 的顶层窗口的兄弟 WorkerW（Win10 常见形态）；
    /// ③ 兜底：满屏、可见、无标题栏的顶层 WorkerW。
    /// 无论哪条路径，候选都必须通过 IsWallpaperHost 校验——各 App 自己也有隐藏的 "WorkerW"。
    /// </summary>
    private static IntPtr FindWallpaperHost(IntPtr progman, int screenWidth, int screenHeight)
    {
        var direct = FindWorkerWChild(progman, screenWidth, screenHeight);
        if (direct != IntPtr.Zero) return direct;

        var sibling = IntPtr.Zero;
        Native.EnumWindows((top, _) =>
        {
            if (Native.FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) == IntPtr.Zero) return true;
            var worker = Native.FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
            if (!IsWallpaperHost(worker, screenWidth, screenHeight)) return true;
            sibling = worker;
            return false;
        }, IntPtr.Zero);
        if (sibling != IntPtr.Zero) return sibling;

        var fallback = IntPtr.Zero;
        Native.EnumWindows((top, _) =>
        {
            if (!IsWallpaperHost(top, screenWidth, screenHeight)) return true;
            fallback = top;
            return false;
        }, IntPtr.Zero);
        return fallback;
    }

    /// <summary>只遍历直接子窗口（EnumChildWindows 是递归的，会把整棵桌面树都扫一遍）。</summary>
    private static IntPtr FindWorkerWChild(IntPtr parent, int screenWidth, int screenHeight)
    {
        var child = Native.GetWindow(parent, Native.GW_CHILD);
        while (child != IntPtr.Zero)
        {
            if (IsWallpaperHost(child, screenWidth, screenHeight)) return child;
            child = Native.GetWindow(child, Native.GW_HWNDNEXT);
        }

        return IntPtr.Zero;
    }

    /// <summary>
    /// 壁纸宿主判定：类名 WorkerW、可见、无标题栏、且覆盖几乎整个屏幕。
    /// 少了尺寸和标题栏这两条，就会挂到别人进程的 136x39 隐藏 WorkerW 上（曾经踩过）。
    /// </summary>
    private static bool IsWallpaperHost(IntPtr hWnd, int screenWidth, int screenHeight)
    {
        if (hWnd == IntPtr.Zero || !Native.IsWindow(hWnd)) return false;
        if (ClassNameOf(hWnd) != "WorkerW") return false;
        if (!Native.IsWindowVisible(hWnd)) return false;

        var style = Native.GetWindowLongPtr(hWnd, Native.GWL_STYLE).ToInt64();
        if ((style & Native.WS_CAPTION) != 0) return false;

        if (!Native.GetWindowRect(hWnd, out var rect)) return false;
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        return width >= screenWidth * 0.8 && height >= screenHeight * 0.8;
    }

    private static string ClassNameOf(IntPtr hWnd)
    {
        var buf = new System.Text.StringBuilder(256);
        Native.GetClassName(hWnd, buf, buf.Capacity);
        return buf.ToString();
    }
}
