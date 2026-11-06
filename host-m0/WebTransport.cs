using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace BoardHost;

/// <summary>
/// 借 WebView2 里那条链路去访问服务端，而不是自己开 HttpClient。
/// 原因：.NET 走的是 Windows 的 Schannel，有些网络/网关按 TLS 指纹直接把它掐掉
/// （实测：同一台机器 Edge 能开、curl.exe 与 SslStream 一律被 RST），
/// 而 WebView2 里的页面用的是 Chromium 自带的 TLS 栈，和浏览器完全一致。
/// 大屏要和"老师用浏览器打开的那个站"行为一致，就得用同一条链路。
/// </summary>
internal sealed class WebTransport : IDisposable
{
    /// <summary>
    /// 注入到每个文档里的桥。页面只做搬运，不解析业务数据：
    /// request(id, method, path, token, body) → postMessage({kind:"reply", id, status, body})
    /// watch(id, path, token) → postMessage({kind:"open"|"event"|"close", id, event, data, error})
    /// 用 fetch 读流自己切 SSE 帧，是因为 EventSource 没法带 Authorization 头，
    /// 而把 token 塞进 URL 会落到 nginx 的 access.log 里。
    /// </summary>
    public const string BridgeScript = """
    (function () {
      if (window.__BOARD_TRANSPORT__) { return; }
      var post = function (msg) {
        try { window.chrome.webview.postMessage(msg); } catch (e) { }
      };
      var watches = {};

      function abs(path) { return new URL(path, location.href).href; }

      window.__BOARD_TRANSPORT__ = {
        request: function (id, method, path, token, body) {
          var init = { method: method, headers: {}, cache: "no-store" };
          if (token) { init.headers.authorization = "Bearer " + token; }
          if (body) {
            init.headers["content-type"] = "application/json";
            init.body = body;
          }
          fetch(abs(path), init)
            .then(function (res) {
              return res.text().then(function (text) {
                post({ kind: "reply", id: id, status: res.status, body: text });
              });
            })
            .catch(function (err) {
              post({ kind: "reply", id: id, status: 0, body: String((err && err.message) || err) });
            });
        },

        watch: function (id, path, token) {
          this.unwatch(id);
          var ctrl = new AbortController();
          watches[id] = { ctrl: ctrl };
          var headers = token ? { authorization: "Bearer " + token } : {};
          fetch(abs(path), { headers: headers, cache: "no-store", signal: ctrl.signal })
            .then(function (res) {
              if (!res.ok) { throw new Error("push HTTP " + res.status); }
              post({ kind: "open", id: id });
              var reader = res.body.getReader();
              var decoder = new TextDecoder();
              var buffer = "";
              function pump() {
                return reader.read().then(function (chunk) {
                  if (chunk.done) {
                    post({ kind: "close", id: id, error: "" });
                    return;
                  }
                  buffer += decoder.decode(chunk.value, { stream: true });
                  var cut;
                  while ((cut = buffer.indexOf("\n\n")) >= 0) {
                    var frame = buffer.slice(0, cut);
                    buffer = buffer.slice(cut + 2);
                    var name = null;
                    var data = [];
                    frame.split("\n").forEach(function (line) {
                      if (line.indexOf("event:") === 0) { name = line.slice(6).trim(); }
                      else if (line.indexOf("data:") === 0) { data.push(line.slice(5).trim()); }
                    });
                    if (name) {
                      post({ kind: "event", id: id, event: name, data: data.join("\n"), error: "" });
                    }
                  }
                  return pump();
                });
              }
              return pump();
            })
            .catch(function (err) {
              if (err && err.name === "AbortError") { return; }
              post({ kind: "close", id: id, error: String((err && err.message) || err) });
            });
        },

        unwatch: function (id) {
          var live = watches[id];
          if (!live) { return; }
          delete watches[id];
          try { live.ctrl.abort(); } catch (e) { }
        }
      };
    })();
    """;

    private readonly CoreWebView2 _core;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<TransportReply>> _pending = new();
    private readonly ConcurrentDictionary<string, Action<TransportEvent>> _watchers = new();
    private int _seq;

    public WebTransport(CoreWebView2 core) => _core = core;

    public async Task InstallAsync()
    {
        _core.WebMessageReceived += OnMessage;
        await _core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript);
    }

    /// <summary>页面里有没有桥。整页加载完成前是 false，调用方要当作"暂时连不上"。</summary>
    public async Task<bool> IsReadyAsync()
    {
        try
        {
            var probe = await _core.ExecuteScriptAsync("typeof window.__BOARD_TRANSPORT__ === 'object'");
            return string.Equals(probe, "true", StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    public async Task<TransportReply> RequestAsync(
        string method, string path, string? token, string? body, CancellationToken ct, int timeoutMs = 15000)
    {
        if (!await IsReadyAsync())
            throw new InvalidOperationException("页面还没加载出传输桥（要同源页面，且已加载完）");

        var id = "r" + Interlocked.Increment(ref _seq);
        var pending = new TaskCompletionSource<TransportReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = pending;
        try
        {
            var call = "window.__BOARD_TRANSPORT__.request("
                       + Quote(id) + "," + Quote(method) + "," + Quote(path) + ","
                       + Quote(token ?? "") + "," + Quote(body ?? "") + ")";
            await _core.ExecuteScriptAsync(call);
            return await pending.Task.WaitAsync(TimeSpan.FromMilliseconds(timeoutMs), ct);
        }
        finally
        {
            _pending.TryRemove(id, out _);
        }
    }

    /// <summary>开一条推送流，回调从 WebView2 的线程来。Cancel 后要调 StopWatch。</summary>
    public async Task StartWatchAsync(string id, string path, string? token, Action<TransportEvent> onEvent)
    {
        if (!await IsReadyAsync())
            throw new InvalidOperationException("页面还没加载出传输桥（要同源页面，且已加载完）");

        _watchers[id] = onEvent;
        var call = "window.__BOARD_TRANSPORT__.watch("
                   + Quote(id) + "," + Quote(path) + "," + Quote(token ?? "") + ")";
        await _core.ExecuteScriptAsync(call);
    }

    public async Task StopWatchAsync(string id)
    {
        _watchers.TryRemove(id, out _);
        try
        {
            await _core.ExecuteScriptAsync($"window.__BOARD_TRANSPORT__ && window.__BOARD_TRANSPORT__.unwatch({Quote(id)})");
        }
        catch
        {
            // 页面正在导航：流跟着文档一起没了，不用管
        }
    }

    private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string kind;
        string? id = null;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            kind = root.TryGetProperty("kind", out var k) ? k.GetString() ?? "" : "";
            if (!root.TryGetProperty("id", out var idElement)) return;
            id = idElement.GetString();

            switch (kind)
            {
                case "reply":
                {
                    if (id is null || !_pending.TryRemove(id, out var pending)) return;
                    var status = root.TryGetProperty("status", out var st) ? st.GetInt32() : 0;
                    var body = root.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "";
                    pending.TrySetResult(new TransportReply(status, body));
                    return;
                }

                default:
                {
                    if (id is null || !_watchers.TryGetValue(id, out var handler)) return;
                    var name = root.TryGetProperty("event", out var ev) ? ev.GetString() : null;
                    var data = root.TryGetProperty("data", out var dd) ? dd.GetString() : null;
                    var error = root.TryGetProperty("error", out var er) ? er.GetString() : null;
                    handler(new TransportEvent(kind, name, data, error));
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            HostLog.Write("transport: 回传报文解析失败（" + ex.Message + "）");
        }
    }

    private static string Quote(string value) => JsonSerializer.Serialize(value);

    public void Dispose()
    {
        _core.WebMessageReceived -= OnMessage;
        foreach (var pending in _pending.Values)
            pending.TrySetException(new ObjectDisposedException(nameof(WebTransport)));
        _pending.Clear();
        _watchers.Clear();
    }
}

internal readonly record struct TransportReply(int Status, string Body);

internal readonly record struct TransportEvent(string Kind, string? Event, string? Data, string? Error);
