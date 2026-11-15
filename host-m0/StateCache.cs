using System.Text.Json;

namespace BoardHost;

/// <summary>
/// 宿主的落盘层，三样东西：
/// 1. cache/state.json —— 最后一次成功拿到的看板数据，开机第一帧就画它；
/// 2. cache/device.token —— 大屏页面配对成功后交过来的设备令牌；
/// 3. cache/device.json —— 配对时页面一并给出的屏码/班级，下次注入 BOARD_HOST 要用。
/// </summary>
internal sealed class StateCache
{
    private static readonly JsonSerializerOptions MetaJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly string _path;
    private readonly string _tokenPath;
    private readonly string _metaPath;

    public StateCache(string path, string tokenPath, string metaPath)
    {
        _path = path;
        _tokenPath = tokenPath;
        _metaPath = metaPath;
        AdoptLegacy();
    }

    /// <summary>
    /// 老版本把令牌和缓存写在 exe 旁边的 cache/ 里，1.0 起改到 %LOCALAPPDATA%\ClassBoard。
    /// 升上来的人（尤其已经配对好的教室电脑）不能因为换目录就得重新绑一次，
    /// 所以新目录里没有的东西，从这几个老位置搬一份过来。
    /// </summary>
    private void AdoptLegacy()
    {
        if (File.Exists(_tokenPath)) return;
        var legacyDirs = new[]
        {
            System.IO.Path.Combine(AppContext.BaseDirectory, "cache"),
            System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BoardHost", "cache"),
        };
        foreach (var dir in legacyDirs)
        {
            var token = System.IO.Path.Combine(dir, "device.token");
            if (!File.Exists(token)) continue;
            try
            {
                var parent = System.IO.Path.GetDirectoryName(_tokenPath);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                File.Copy(token, _tokenPath, overwrite: false);
                foreach (var name in new[] { "state.json", "device.json" })
                {
                    var from = System.IO.Path.Combine(dir, name);
                    var to = System.IO.Path.Combine(parent ?? ".", name);
                    if (File.Exists(from) && !File.Exists(to)) File.Copy(from, to, overwrite: false);
                }
                HostLog.Write("cache: 从老目录接管了配对信息 " + dir);
                return;
            }
            catch (Exception ex)
            {
                HostLog.Write("cache: 接管老目录失败 " + dir + " " + ex.Message);
            }
        }
    }

    public string Path => _path;

    /// <summary>返回缓存的 BoardState JSON（对象原文），没有则 null。坏文件当作没有。</summary>
    public string? Read()
    {
        try
        {
            if (!File.Exists(_path)) return null;
            var text = File.ReadAllText(_path);
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            // v1 的缓存画不出 v2 的版面（字段全对不上）：宁可先显示样例，等联网拉新的，
            // 也不要把旧快照塞进新渲染层——那会闪一屏没有倒计时、没有课表的空板子。
            if (doc.RootElement.TryGetProperty("version", out var version) && version.TryGetInt32(out var v) && v != 2)
            {
                HostLog.Write($"cache: 旧版本快照(v{v})，跳过");
                return null;
            }
            return text;
        }
        catch (Exception ex)
        {
            HostLog.Write("cache read failed: " + ex.Message);
            return null;
        }
    }

    /// <summary>
    /// 缓存文件的最后写入时间（本地 HH:mm）。断网时屏上要说"数据到几点"，
    /// 说的是这份缓存什么时候写的——开机领着旧缓存、网又没起来时也有话可说。
    /// </summary>
    public string? LastWriteText()
    {
        try
        {
            return File.Exists(_path) ? File.GetLastWriteTime(_path).ToString("HH:mm") : null;
        }
        catch
        {
            return null;
        }
    }

    public void Write(string json, long revision)
    {
        try
        {
            WriteAtomic(_path, json);
            HostLog.Write($"cache write revision={revision} bytes={json.Length}");
        }
        catch (Exception ex)
        {
            HostLog.Write("cache write failed: " + ex.Message);
        }
    }

    /// <summary>
    /// 设备令牌：只由页面配对成功后的 postMessage 交过来，宿主自己绝不再去换。
    /// </summary>
    public string? ReadToken()
    {
        try
        {
            if (!File.Exists(_tokenPath)) return null;
            var token = File.ReadAllText(_tokenPath).Trim();
            return token.Length == 0 ? null : token;
        }
        catch
        {
            return null;
        }
    }

    public void WriteToken(string token)
    {
        try
        {
            WriteAtomic(_tokenPath, token);
            HostLog.Write($"cache: 设备令牌已落盘 {_tokenPath}");
        }
        catch (Exception ex)
        {
            HostLog.Write("cache: 设备令牌没写成（" + ex.Message + "）");
        }
    }

    /// <summary>令牌失效 / 老师解除配对：立刻删掉，别让下一次开机又拿着废令牌去撞 401。</summary>
    public void ClearToken()
    {
        try
        {
            if (File.Exists(_tokenPath)) File.Delete(_tokenPath);
            HostLog.Write("cache: 已清除 cache/device.token");
        }
        catch (Exception ex)
        {
            HostLog.Write("cache: 令牌删不掉（" + ex.Message + "）");
        }
    }

    /// <summary>配对时页面给的屏码/班级。没有令牌时不算数，注入时会再判一次。</summary>
    public DeviceMeta? ReadMeta()
    {
        try
        {
            if (!File.Exists(_metaPath)) return null;
            return JsonSerializer.Deserialize<DeviceMeta>(File.ReadAllText(_metaPath), MetaJson);
        }
        catch (Exception ex)
        {
            HostLog.Write("cache: 设备信息读不出来（" + ex.Message + "）");
            return null;
        }
    }

    public void WriteMeta(DeviceMeta meta)
    {
        try
        {
            WriteAtomic(_metaPath, JsonSerializer.Serialize(meta, MetaJson));
        }
        catch (Exception ex)
        {
            HostLog.Write("cache: 设备信息没写成（" + ex.Message + "）");
        }
    }

    public void ClearMeta()
    {
        try
        {
            if (File.Exists(_metaPath)) File.Delete(_metaPath);
        }
        catch (Exception ex)
        {
            HostLog.Write("cache: 设备信息删不掉（" + ex.Message + "）");
        }
    }

    /// <summary>先写临时文件再替换：断电时不会留下半截 JSON。</summary>
    private static void WriteAtomic(string path, string text)
    {
        var dir = System.IO.Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        var tmp = path + ".tmp";
        File.WriteAllText(tmp, text);
        File.Move(tmp, path, overwrite: true);
    }
}

/// <summary>配对后大屏常驻的身份：屏码（老师在大屏管理里认屏用）与班级。</summary>
internal sealed record DeviceMeta(string? ScreenCode, string? ClassId, string? ClassName);
