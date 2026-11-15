using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;

namespace BoardHost;

/// <summary>
/// 把"服务端的看板数据"接到"WebView2 里渲染的页面"上：
/// 1. 导航前注入 BOARD_HOST（页面据此决定显不显示配对卡）与缓存 → 开机第一帧就是上次的内容；
/// 2. 导航后拉一次最新 → BOARD_APPLY 热替换，不整页刷新；
/// 3. 订阅 revision 推送 → 老师一发布，大屏立刻变；
/// 4. 接收页面 postMessage（配对成功/解除配对）→ 令牌落盘、清盘。
///
/// v2 的配对方向是反的：**大屏页面自己显示配对码/二维码，老师手机扫码**，
/// 页面拿到 deviceToken 后 postMessage 给宿主，宿主只负责落盘和开始同步。
/// 宿主不再用 --pair 换令牌，也绝不自己申请配对码。
/// </summary>
internal sealed class BoardSync : IAsyncDisposable
{
    private readonly WebView2 _web;
    private readonly HostConfig _config;
    private readonly StateCache _cache;
    private readonly WebTransport _transport;
    private readonly CancellationTokenSource _cts = new();
    private RemoteBoard? _remote;
    private long _revision;
    private Task? _watch;
    private CancellationTokenSource? _watchCts; // 每次导航换一条：旧文档里的推送流随文档一起死了
    private string? _staleAt;      // 最后一次同步成功的本地 HH:mm（离线提示要说的"数据到几点"）
    private bool? _linkOnline;     // 上一次告诉页面的链路状态，避免每帧重复执行脚本
    private bool _paired;          // 磁盘上有令牌才算已配对
    private string? _registeredHostScript; // 已注册的 BOARD_HOST 脚本，状态变了才补注册

    public BoardSync(WebView2 web, HostConfig config, StateCache cache, WebTransport transport)
    {
        _web = web;
        _config = config;
        _cache = cache;
        _transport = transport;
        _paired = !string.IsNullOrEmpty(cache.ReadToken());
    }

    public long Revision => _revision;

    // 注意：这里只判断页面与接口同源且配了服务端地址。_remote 是懒创建的，
    // 早先把它也算进条件导致"注入缓存和首次拉取整段被跳过"。
    public bool HasRemote => _config.CanSync;

    /// <summary>磁盘上有令牌才算已配对（托盘菜单据此决定"重新配对"能不能点）。</summary>
    public bool IsPaired => _paired && !string.IsNullOrEmpty(_cache.ReadToken());

    /// <summary>托盘菜单：回到未配对态，让页面重新出配对码。</summary>
    public Task RepinAsync() => UnpairAsync("托盘菜单：重新配对");

    /// <summary>
    /// 必须在 Navigate 之前调用：注入 BOARD_HOST 与缓存，只注入一次
    /// （同一页面刷新时由 BOARD_APPLY 接管；配对状态变化时补注册一条覆盖旧的）。
    /// </summary>
    public async Task BeforeNavigateAsync()
    {
        if (!HasRemote)
        {
            // 本地 file:// 样例：不注入 BOARD_HOST，页面就不会显示那块点不动的配对卡。
            HostLog.Write("sync: 本地样例模式（页面与接口不同源），不注入 BOARD_HOST，页面不显示配对卡");
            return;
        }

        await RegisterHostScriptAsync();

        var cached = _cache.Read();
        if (cached is null)
        {
            HostLog.Write("sync: 无缓存，先渲染样例数据");
            return;
        }

        try
        {
            await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync($"window.BOARD_STATE = {cached};");
            HostLog.Write($"sync: 已注入缓存 {cached.Length} 字节（离线首帧）");
        }
        catch (Exception ex)
        {
            HostLog.Write("sync: 缓存注入失败（" + ex.Message + "）");
        }
    }

    /// <summary>
    /// 导航完成后调用：有令牌就拉最新 + 起推送；没令牌就停在"等扫码配对"，什么都不拉。
    /// 任何异常都不许打断壁纸。
    /// </summary>
    public async Task AfterNavigationAsync()
    {
        if (!HasRemote) return;

        try
        {
            var token = _cache.ReadToken();
            if (string.IsNullOrEmpty(token))
            {
                _paired = false;
                HostLog.Write("sync: 还没配对——页面右下角显示配对码/二维码，等老师手机扫码");
                return;
            }

            _paired = true;
            _remote ??= new RemoteBoard(_transport, token);
            _remote.UpdateToken(token);
            _linkOnline = null; // 新页面还没被告知状态，这一轮必须真的执行一次脚本
            await PullAsync("startup");
            StartWatch();
        }
        catch (Exception ex)
        {
            HostLog.Write("sync: 初始化失败（" + ex.Message + "）");
            try
            {
                await MarkLinkAsync(false);
            }
            catch
            {
                // 页面没起来时画不上，下一次推送重连再标
            }
        }
    }

    /*
      BOARD_HOST：页面的"我是谁、配没配对"上下文，导航前注入（文档创建时执行）。
      paired=false 时页面显示配对卡；true 时显示班级内容 + 常驻屏码。
      file:// 本地预览不注入这个对象——文档约定"没有 BOARD_HOST 就不显示配对卡"。
    */
    private async Task RegisterHostScriptAsync()
    {
        var script = $"window.BOARD_HOST = {HostContextJson()};";
        if (_registeredHostScript == script) return; // 没变过就别往 WebView 里塞重复脚本

        try
        {
            await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(script);
            if (_registeredHostScript is not null)
            {
                // 后注册的脚本后执行，覆盖前一条：之后整页刷新拿到的仍是最新状态
                HostLog.Write("sync: BOARD_HOST 状态变了，补注册注入脚本（整页刷新后依然正确）");
            }

            _registeredHostScript = script;
        }
        catch (Exception ex)
        {
            HostLog.Write("sync: 注入 BOARD_HOST 失败（" + ex.Message + "）");
        }
    }

    private string HostContextJson()
    {
        var meta = _cache.ReadMeta();
        var paired = _paired && !string.IsNullOrEmpty(_cache.ReadToken());
        return JsonSerializer.Serialize(new
        {
            mode = "host",
            paired,
            screenCode = paired ? meta?.ScreenCode : null,
            className = paired ? meta?.ClassName : null,
        });
    }

    /// <summary>
    /// 页面已经跑起来了，文档创建时的注入不会再发生——状态变化只能靠 ExecuteScript 推。
    /// 先就地改对象（页面可能缓存了引用），再调页面的钩子：
    ///   · 回未配对态优先 BOARD_PAIR_RESET()（board-web/pairing.js 已实现：重出配对卡 + 重新申请配对码）
    ///   · 其次 BOARD_HOST_CHANGED(host)
    ///   · 都没有且必须立刻生效时，退化成整页重载。
    /// </summary>
    private async Task ApplyHostContextAsync(bool reloadIfNoHook)
    {
        // 先让"下次整页构建文档"时的初始状态也变成新的：否则配对成功之后
        // 只要页面自己刷新一次（或下面兜底的 Reload），注入的 BOARD_HOST 又会是旧值。
        await RegisterHostScriptAsync();

        var meta = _cache.ReadMeta();
        var screen = _paired ? meta?.ScreenCode : null;
        var klass = _paired ? meta?.ClassName : null;

        var script =
            "(function(){" +
            "var h=window.BOARD_HOST; if(!h){return 'absent';}" +
            $"h.paired={(_paired ? "true" : "false")};" +
            $"h.screenCode={JsonSerializer.Serialize(screen)};" +
            $"h.className={JsonSerializer.Serialize(klass)};" +
            "if(!h.paired && typeof window.BOARD_PAIR_RESET==='function'){" +
            "try{return window.BOARD_PAIR_RESET()===false?'none':'reset';}catch(e){return 'hook-error';}}" +
            "if(typeof window.BOARD_HOST_CHANGED==='function'){" +
            "try{window.BOARD_HOST_CHANGED(h);return 'hook';}catch(e){return 'hook-error';}}" +
            "return 'none';})()";

        string result;
        try
        {
            result = (await _web.CoreWebView2.ExecuteScriptAsync(script)).Trim('"');
        }
        catch (Exception ex)
        {
            HostLog.Write("pair: 页面状态没推上去（" + ex.Message + "）");
            return;
        }

        switch (result)
        {
            case "reset":
                HostLog.Write("pair: 已让页面重新显示配对卡（BOARD_PAIR_RESET，页面会重新申请配对码）");
                return;

            case "hook":
                HostLog.Write("pair: 已通知页面 BOARD_HOST_CHANGED");
                return;

            case "hook-error":
                HostLog.Write("pair: 页面钩子抛错（已忽略）");
                return;

            case "absent":
            case "none":
                break;

            default:
                return;
        }

        if (!reloadIfNoHook) return;

        // 页面没有任何钩子：只能整页重载，让它带着新的 BOARD_HOST 重新跑一遍。
        // 壁纸层重载会闪一下，但"配对卡出不来、屏上一直挂着旧内容"比闪一下糟得多。
        HostLog.Write($"pair: 页面没有 BOARD_PAIR_RESET / BOARD_HOST_CHANGED（{result}），整页重载一次以回到配对态");
        try
        {
            _web.CoreWebView2.Reload();
        }
        catch (Exception ex)
        {
            HostLog.Write("pair: 重载失败（" + ex.Message + "）");
        }
    }

    // ------------------------------------------------------------------
    // 页面 → 宿主：{type:"board:paired", token, screenCode, classId, className}
    //              {type:"board:unpair"}
    // 其余报文（传输桥的 kind/id 那套）不归这里管，直接忽略。
    // ------------------------------------------------------------------

    public void HandlePageMessage(string json) => _ = HandlePageMessageAsync(json);

    private async Task HandlePageMessageAsync(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return; // postMessage("字符串") 之类

            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
            switch (type)
            {
                case "board:paired":
                    await OnPairedAsync(root);
                    break;

                case "board:unpair":
                    await UnpairAsync("页面请求解除配对");
                    break;
            }
        }
        catch (Exception ex)
        {
            HostLog.Write("pair: 页面消息处理失败（" + ex.Message + "）报文=" + Clip(json));
        }
    }

    /// <summary>页面扫码配对成功：令牌/屏码落盘 → 拉一次 → 起推送。</summary>
    private async Task OnPairedAsync(JsonElement root)
    {
        var token = GetString(root, "token");
        if (string.IsNullOrWhiteSpace(token))
        {
            HostLog.Write("pair: 页面说配对成功但没带 token，忽略");
            return;
        }

        var meta = new DeviceMeta(
            GetString(root, "screenCode"),
            GetString(root, "classId"),
            GetString(root, "className"));

        _paired = true;
        _cache.WriteToken(token!);
        _cache.WriteMeta(meta);

        HostLog.Write(
            $"pair: 页面报告配对成功 screen={meta.ScreenCode ?? "?"} " +
            $"class={meta.ClassName ?? meta.ClassId ?? "?"} token 已保存到 {_config.TokenPath}");

        _remote ??= new RemoteBoard(_transport, token!);
        _remote.UpdateToken(token!);
        _linkOnline = null;

        // 页面自己发起的配对：它已经在改 UI 了，这里只同步对象状态，不重载。
        await ApplyHostContextAsync(reloadIfNoHook: false);
        await PullAsync("paired");
        StartWatch();
    }

    /// <summary>
    /// 回未配对态：清令牌与屏码，停推送，让页面重新显示配对卡。
    /// 令牌失效（401/403）也走这里——屏上不能空着，也不能一直撞 401。
    /// </summary>
    private async Task UnpairAsync(string reason)
    {
        if (!_paired && _cache.ReadToken() is null)
        {
            HostLog.Write($"pair: {reason}，但本来就没配对，忽略");
            return;
        }

        _paired = false;
        _cache.ClearToken();
        _cache.ClearMeta();

        _watchCts?.Cancel();
        _watch = null;
        _remote = null;

        HostLog.Write($"pair: {reason} -> 已回未配对态，等页面重新显示配对码/二维码");

        // 屏上不该还挂着"离线 · 数据到 xx"——这不是断网，是没配对。
        _linkOnline = null;
        try
        {
            await MarkLinkAsync(true);
        }
        catch
        {
            // 页面正在重载：下一次导航完会重新标
        }

        // 回未配对态必须让页面真的切回来：没实现钩子就整页重载（见 ApplyHostContextAsync）。
        await ApplyHostContextAsync(reloadIfNoHook: true);
    }

    private void OnTokenRejected(string from)
    {
        HostLog.Write($"sync: {from}被服务端拒绝（401/403），按令牌失效处理");
        _ = UnpairAsync("设备令牌失效（服务端 401/403）");
    }

    /// <summary>推送流绑在文档上：整页重载后旧流自动断，这里换一条新的。</summary>
    private void StartWatch()
    {
        if (_remote is null) return;

        _watchCts?.Cancel();
        _watchCts?.Dispose();
        _watchCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
        _watch = _remote.WatchAsync(
            OnRevisionAsync,
            m => HostLog.Write("sync " + m),
            _watchCts.Token,
            OnLinkChanged,
            () => OnTokenRejected("推送流"));
    }

    private async void OnLinkChanged(bool online)
    {
        try
        {
            // 断线这段时间老师可能发过新版：连回来先补一次拉取，别等下一次推送才对齐。
            // 拉取自己会标链路状态（成功=在线，失败继续标离线），这里不再重复标。
            if (online && _linkOnline == false)
            {
                await PullAsync("reconnect");
                return;
            }

            await MarkLinkAsync(online);
        }
        catch (Exception ex)
        {
            HostLog.Write("sync: 链路提示没画上（" + ex.Message + "）");
        }
    }

    /*
      把"链路现在通不通"告诉页面的那句 window.BOARD_LINK。
      只在状态真的变了才执行一次——否则每次心跳都往 WebView 里塞脚本没必要。
      断网时 staleAt 取最后一次同步成功的时间；这台机器开机就领着旧缓存、
      一次都没同步成功过的话，退回落盘缓存的写入时间。
    */
    private async Task MarkLinkAsync(bool online)
    {
        if (_linkOnline == online) return;
        var was = _linkOnline;
        _linkOnline = online;

        var stale = online ? null : (_staleAt ?? _cache.LastWriteText());
        var staleJson = stale is null ? "null" : "\"" + stale + "\"";
        var script = $"window.BOARD_LINK && window.BOARD_LINK({{online:{(online ? "true" : "false")},staleAt:{staleJson}}})";

        try
        {
            await _web.CoreWebView2.ExecuteScriptAsync(script);
            var note = online
                ? (was == false ? "sync: 链路已恢复" : "sync: 链路在线")
                : $"sync: 链路断开，屏上标离线（数据到 {stale ?? "未知时间"}）";
            HostLog.Write(note);
        }
        catch (Exception)
        {
            _linkOnline = null; // 页面正在导航：下次再来，别把状态记成"已经告诉过页面"
            throw;
        }
    }

    private async Task PullAsync(string reason)
    {
        if (_remote is null) return;

        try
        {
            var snapshot = await _remote.FetchAsync(_cts.Token);
            _staleAt = DateTime.Now.ToString("HH:mm");

            if (snapshot is null)
            {
                HostLog.Write($"sync[{reason}]: 服务端还没有发布过数据，继续显示缓存");
                await MarkLinkAsync(true);
                return;
            }

            _cache.Write(snapshot.Json, snapshot.Revision);
            await ApplyAsync(snapshot.Json, snapshot.Revision, reason);
            await MarkLinkAsync(true);
        }
        catch (OperationCanceledException)
        {
            // 进程退出
        }
        catch (BoardHttpException ex) when (ex.IsAuthFailure)
        {
            // 老师解除了这块屏的配对 / 令牌过期：不能一直撞 401，回配对态重新扫码。
            HostLog.Write($"sync[{reason}]: {ex.Status} 令牌失效，回未配对态");
            await UnpairAsync($"设备令牌失效（HTTP {ex.Status}）");
        }
        catch (Exception ex)
        {
            HostLog.Write($"sync[{reason}]: 拉取失败，继续显示缓存（{ex.Message}）");
            try
            {
                await MarkLinkAsync(false);
            }
            catch
            {
                // 页面没起来时画不上，下一次推送重连再标
            }
        }
    }

    private async Task OnRevisionAsync(long? revision)
    {
        HostLog.Write($"sync: 收到推送 revision={revision?.ToString() ?? "?"}（本地 {_revision}）");
        await PullAsync("push");
    }

    /// <summary>热替换数据。页面还没跑起来就退回整页重载（重载前会重新注入缓存）。</summary>
    private async Task ApplyAsync(string json, long revision, string reason)
    {
        var applied = await _web.CoreWebView2.ExecuteScriptAsync(
            $"window.BOARD_APPLY ? window.BOARD_APPLY({json}) : false");

        if (string.Equals(applied, "true", StringComparison.OrdinalIgnoreCase))
        {
            _revision = revision;
            HostLog.Write($"sync[{reason}]: 已热替换 revision={revision}");
            return;
        }

        HostLog.Write($"sync[{reason}]: 页面未就绪（BOARD_APPLY={applied}），改为整页重载");
        _web.CoreWebView2.Reload();
    }

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string Clip(string text) => text.Length <= 200 ? text : text[..200] + "…";

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();
        _watchCts?.Cancel();

        if (_watch is not null)
        {
            try
            {
                await _watch;
            }
            catch
            {
                // 关闭途中的取消异常忽略
            }
        }

        _watchCts?.Dispose();
        _remote?.Dispose();
        _cts.Dispose();
    }
}
