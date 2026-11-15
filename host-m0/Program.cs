namespace BoardHost;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var config = HostConfig.FromArgs(args);

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // 一体机常年不关机：抑制息屏与睡眠
        Native.SetThreadExecutionState(
            Native.ES_CONTINUOUS | Native.ES_DISPLAY_REQUIRED | Native.ES_SYSTEM_REQUIRED);

        HostLog.Write($"=== BoardHost M0 start pid={Environment.ProcessId} url={config.StartUrl} ===");
        HostLog.Write($"config: api={config.ApiBase ?? "(无，本地样例)"} 可同步={config.CanSync} 设备={config.DeviceName}");

        var cache = new StateCache(config.CachePath, config.TokenPath, config.DeviceMetaPath);

        try
        {
            Application.Run(new WallpaperWindow(config, cache));
        }
        catch (Exception ex)
        {
            HostLog.Write("fatal: " + ex);
            throw;
        }
        finally
        {
            Native.SetThreadExecutionState(Native.ES_CONTINUOUS);
            HostLog.Write("=== BoardHost M0 exit ===");
        }
    }
}
