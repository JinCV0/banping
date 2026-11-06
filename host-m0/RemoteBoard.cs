using System.Text.Json;

namespace BoardHost;

/// <summary>
/// 与发布服务通信：拉当前版本、订阅 revision 推送。
/// 走 <see cref="WebTransport"/>（页面里的 Chromium 链路），不用 HttpClient——
/// 理由见 WebTransport 的注释：Schannel 的握手在某些网络上会被掐掉。
/// 路径一律写相对路径：页面本来就从发布服务这个源加载，天然同源。
/// 配对不再走这里：令牌由大屏页面扫码配对后经 postMessage 交给宿主。
/// </summary>
internal sealed class RemoteBoard : IDisposable
{
    private const string StatePath = "/api/v1/board/state";
    private const string EventsPath = "/api/v1/board/events";

    private readonly WebTransport _transport;
    private string _token;
    private int _watchSeq;

    public RemoteBoard(WebTransport transport, string deviceToken)
    {
        _transport = transport;
        _token = deviceToken;
    }

    /// <summary>拉当前版本。没有发布过时 state 为 null，返回 null。</summary>
    public async Task<BoardSnapshot?> FetchAsync(CancellationToken ct)
    {
        var reply = await _transport.RequestAsync("GET", StatePath, _token, null, ct);
        if (reply.Status is < 200 or >= 300)
            throw new BoardHttpException(reply.Status, reply.Body, "拉取看板");

        using var doc = JsonDocument.Parse(reply.Body);
        var root = doc.RootElement;
        if (!root.TryGetProperty("state", out var state) || state.ValueKind != JsonValueKind.Object)
            return null;

        var revision = root.TryGetProperty("revision", out var rev) ? rev.GetInt64() : 0;
        return new BoardSnapshot(revision, state.GetRawText());
    }

    /// <summary>
    /// 订阅推送直到取消。断线自动重连（2s 起、翻倍、封顶 30s）；连不上只记日志，
    /// 不打断壁纸渲染（大屏宁可显示旧内容和离线标记，也不能因为网断了变黑）。
    /// onLink 报链路状态：连上 true、断了 false——屏上那条"离线"提示由它驱动。
    /// onTokenRejected：推送流被 401/403 拒了（老师解除配对/令牌作废），调用方要回未配对态。
    /// </summary>
    public async Task WatchAsync(
        Func<long?, Task> onRevision,
        Action<string> log,
        CancellationToken ct,
        Action<bool>? onLink = null,
        Action? onTokenRejected = null)
    {
        var backoff = TimeSpan.FromSeconds(2);

        while (!ct.IsCancellationRequested)
        {
            var id = "w" + Interlocked.Increment(ref _watchSeq);
            var closed = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            var opened = false;
            var rejected = false;

            try
            {
                await _transport.StartWatchAsync(id, EventsPath, _token, evt =>
                {
                    switch (evt.Kind)
                    {
                        case "open":
                            opened = true;
                            log("push connected");
                            onLink?.Invoke(true);
                            break;

                        case "event" when evt.Event == "revision":
                            _ = onRevision(ParseRevision(evt.Data));
                            break;

                        case "close":
                            closed.TrySetResult(evt.Error ?? "");
                            break;
                    }
                });

                var reason = await closed.Task.WaitAsync(ct);
                rejected = IsAuthFailure(reason);
                log("push error: " + (string.IsNullOrEmpty(reason) ? "推送流被关闭" : reason));
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log("push error: " + ex.Message);
            }
            finally
            {
                await _transport.StopWatchAsync(id);
            }

            // 令牌作废了：再退避重试一万次也还是 401，交给宿主回未配对态重新扫码。
            if (rejected)
            {
                log("push rejected 401/403：设备令牌已失效");
                onTokenRejected?.Invoke();
                return;
            }

            if (opened) backoff = TimeSpan.FromSeconds(2);
            onLink?.Invoke(false); // 流断开或连接失败都算离线（服务器重启、网线拔掉）

            try
            {
                await Task.Delay(backoff, ct);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            backoff = TimeSpan.FromSeconds(Math.Min(30, backoff.TotalSeconds * 2));
        }
    }

    /// <summary>推送桥把 HTTP 状态塞在错误文本里（"push HTTP 401"），认一下是不是令牌问题。</summary>
    private static bool IsAuthFailure(string? error)
    {
        if (string.IsNullOrEmpty(error)) return false;
        foreach (var code in new[] { "401", "403" })
        {
            if (error.Contains("HTTP " + code, StringComparison.Ordinal)) return true;
        }

        return false;
    }

    private static long? ParseRevision(string? data)
    {
        if (string.IsNullOrWhiteSpace(data)) return null;

        try
        {
            using var doc = JsonDocument.Parse(data);
            return doc.RootElement.TryGetProperty("revision", out var rev) ? rev.GetInt64() : null;
        }
        catch
        {
            return null; // 解析失败的帧直接跳过，等下一次
        }
    }

    public void UpdateToken(string token) => _token = token;

    public void Dispose()
    {
        // 传输层属于 WebView2，生命周期由窗口管；这里没什么可释放的。
    }
}

internal sealed record BoardSnapshot(long Revision, string Json);

/// <summary>接口回了一个非 2xx。带状态码，因为 401/403 要当"令牌失效"处理而不是普通网络故障。</summary>
internal sealed class BoardHttpException : Exception
{
    public BoardHttpException(int status, string body, string what)
        : base($"{what}失败 HTTP {status}: {body}")
    {
        Status = status;
    }

    public int Status { get; }

    public bool IsAuthFailure => Status is 401 or 403;
}
