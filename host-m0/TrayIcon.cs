using System.Diagnostics;

namespace BoardHost;

/// <summary>
/// 托盘图标：壁纸层是 TOOLWINDOW、也没有任务栏按钮，平时"看不见"，托盘是唯一能确认它在跑
/// 并且能正常退出的入口。菜单只放用得上的三件事：打开老师端 / 重新配对 / 退出。
/// </summary>
internal sealed class TrayIcon : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _repin;
    private readonly Func<bool> _paired;

    public TrayIcon(HostConfig config, Func<bool> paired, Func<Task> repin)
    {
        _paired = paired;

        var menu = new ContextMenuStrip();
        var open = new ToolStripMenuItem("打开老师端");
        open.Click += (_, _) => OpenTeacherPage(config);
        menu.Items.Add(open);

        _repin = new ToolStripMenuItem("重新配对…");
        _repin.Click += async (_, _) => await RepinAsync(repin);
        menu.Items.Add(_repin);

        menu.Items.Add(new ToolStripSeparator());

        var quit = new ToolStripMenuItem("退出班屏");
        quit.Click += (_, _) => Application.Exit();
        menu.Items.Add(quit);

        menu.Opening += (_, _) =>
        {
            var isPaired = SafePaired();
            _repin.Enabled = config.CanSync;
            _repin.Text = isPaired ? "重新配对…" : "还没配对";
        };

        _icon = new NotifyIcon
        {
            Icon = LoadIcon(),
            Text = "班屏 · 教室大屏",
            Visible = true,
            ContextMenuStrip = menu,
        };
        _icon.DoubleClick += (_, _) => OpenTeacherPage(config);
        HostLog.Write("tray: 图标已就绪（右键：打开老师端 / 重新配对 / 退出）");
    }

    /// <summary>菜单打开时顺手刷新一次：配对状态是页面推给宿主的，随时会变。</summary>
    private bool SafePaired()
    {
        try
        {
            return _paired();
        }
        catch
        {
            return false;
        }
    }

    private static void OpenTeacherPage(HostConfig config)
    {
        // 老师端和接口同源；没有服务（本地样例模式）时退回当前渲染页，至少能看见屏上是什么。
        var url = config.CanSync && !string.IsNullOrEmpty(config.ApiBase)
            ? config.ApiBase.TrimEnd('/') + "/"
            : config.StartUrl;
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            HostLog.Write("tray: 打开老师端 " + url);
        }
        catch (Exception ex)
        {
            HostLog.Write("tray: 打开老师端失败 " + ex.Message);
        }
    }

    private async Task RepinAsync(Func<Task> repin)
    {
        if (!SafePaired())
        {
            HostLog.Write("tray: 本来就没配对，忽略重新配对");
            return;
        }
        var answer = MessageBox.Show(
            "重新配对会让这块大屏立刻失效，并重新显示配对码。\n之后用手机扫屏上的码，把它绑回班级。",
            "重新配对",
            MessageBoxButtons.OKCancel,
            MessageBoxIcon.Question,
            MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.OK) return;

        try
        {
            await repin();
            HostLog.Write("tray: 已请求重新配对");
        }
        catch (Exception ex)
        {
            HostLog.Write("tray: 重新配对失败 " + ex.Message);
        }
    }

    /// <summary>exe 自带的图标就是产品图标；取不到再退回系统默认。</summary>
    private static Icon LoadIcon()
    {
        try
        {
            var icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (icon is not null) return icon;
        }
        catch
        {
            // 取不到就算了，下面还有兜底
        }
        return SystemIcons.Application;
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.ContextMenuStrip?.Dispose();
        _icon.Dispose();
    }
}
