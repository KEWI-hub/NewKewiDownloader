using MoonSharp.Interpreter;
using NewKewi.Core.Models;
using NewKewi.Sites.Lua;

namespace NewKewi.Sites;

public sealed record ResolveResult(
    bool Handled,
    string? ModuleName,
    string? Title,
    IReadOnlyList<MediaStream> Streams,
    string? Error,
    IReadOnlyList<string> Log)
{
    /// <summary>ไม่มี module ไหนรับ url นี้ — ให้ไปทางทั่วไป (yt-dlp แล้วค่อยอ่านหน้าเว็บเอง)</summary>
    public static ResolveResult NoModule(string url) =>
        new(false, null, null, [], null, []);

    public bool Ok => Handled && Streams.Count > 0 && Error is null;
}

/// <summary>
/// แกะลิงก์ด้วย Lua module
///
/// ลำดับ: หา module ที่รับโดเมนนี้ → ดึงหน้าเว็บหนึ่งครั้ง → รัน Probe/GetInfo/GetStreams
/// module พังหรือไม่คืนสตรีมเลย = ถือว่าแกะไม่ได้ ไม่มี retry
/// </summary>
public sealed class LuaResolver(
    SiteRegistry registry, IWebClient web, Browser.IBrowser? browser = null,
    PageFetcher? fetcher = null) : IStreamResolver
{
    /// <summary>หน้าตาที่ <see cref="NewKewi.Core.Engine.DownloadEngine"/> เรียกใช้</summary>
    ResolveOutcome IStreamResolver.Resolve(string url, CancellationToken ct)
    {
        var r = Resolve(url, ct);
        return new ResolveOutcome(r.Handled, r.ModuleName, r.Title, r.Streams, r.Error);
    }

    public ResolveResult Resolve(string url, CancellationToken ct)
    {
        var candidates = registry.FindCandidates(url);
        if (candidates.Count == 0) return ResolveResult.NoModule(url);

        var host = SiteRegistry.HostOf(url) ?? "";

        // ดึงหน้าเว็บครั้งเดียวแล้วใช้ร่วมกันทุก candidate
        // module ที่คุยกับ API อย่างเดียวก็ยังได้ `page` ไว้อ่านโดเมน API ออกมา
        var page = SafeGet(url, ct);

        string? lastError = null;
        foreach (var candidate in candidates)
        {
            ct.ThrowIfCancellationRequested();
            var attempt = RunModule(candidate, url, host, page, ct);
            if (attempt.Ok) return attempt;
            lastError ??= attempt.Error;
        }

        return new ResolveResult(true, candidates[0].Name, null, [],
            lastError ?? "module แกะลิงก์ไม่ได้ ไม่ได้สตรีมกลับมาเลย", []);
    }

    private ResolveResult RunModule(
        SiteModuleInfo info, string url, string host, string page, CancellationToken ct)
    {
        LuaSandbox box;
        try
        {
            box = new LuaSandbox(web, registry.ModuleSearchPaths, ct, browser);
            box.LoadFile(info.FilePath);
            box.Call("Register");
            box.SetUrl(url);
            box.SetPage(page);
            box.SetMatchedDomain(host);
        }
        catch (Exception ex)
        {
            return Failed(info, $"โหลด module ไม่ได้: {Describe(ex)}", []);
        }

        try
        {
            if (box.HasFunction("Probe"))
            {
                var probe = box.Call("Probe");
                if (!probe.CastToBool())
                    return new ResolveResult(false, info.Name, null, [], null, box.Log);
            }

            if (box.HasFunction("GetInfo")) box.Call("GetInfo");

            if (!box.HasFunction("GetStreams"))
                return Failed(info, "module ไม่มีฟังก์ชัน GetStreams()", box.Log);

            box.Call("GetStreams");
        }
        catch (ScriptRuntimeException ex)
        {
            return Failed(info, $"module ทำงานผิดพลาด: {ex.DecoratedMessage ?? ex.Message}", box.Log);
        }
        catch (Exception ex)
        {
            return Failed(info, $"module ทำงานผิดพลาด: {Describe(ex)}", box.Log);
        }

        var streams = box.Streams
            .Select(t => ToMediaStream(t, url))
            .Where(s => !string.IsNullOrWhiteSpace(s.Url))
            .OrderByDescending(s => s.Height)
            .ToList();

        if (streams.Count == 0)
            return Failed(info, "module รันผ่านแต่ไม่ได้สตรีมกลับมาเลย", box.Log);

        var title = box.Info.Get("Title").CastToString();
        return new ResolveResult(true, info.Name,
            string.IsNullOrWhiteSpace(title) ? null : title.Trim(),
            streams, null, box.Log);
    }

    /// <summary>แปลงตารางที่ Lua ส่งมาให้เป็นสตรีมของแอป · คีย์ที่ไม่รู้จักถูกมองข้าม</summary>
    internal static MediaStream ToMediaStream(Table t, string pageUrl)
    {
        var raw = Str(t, "url");
        var stream = new MediaStream
        {
            Url = LuaSandbox.UrlJoin(pageUrl, raw),   // module คืน path เปล่าๆ มาได้ (taiav ทำแบบนั้น)
            Height = (int)Num(t, "height"),
            Label = Str(t, "label"),
            Referer = Nullable(Str(t, "referer")),
            Container = Nullable(Str(t, "container")),
            Expires = t.Get("expires").CastToBool(),
            Kind = ParseKind(Str(t, "kind"), raw),
        };

        CopyHeaders(t.Get("playlistHeaders"), stream.PlaylistHeaders);
        CopyHeaders(t.Get("segmentHeaders"), stream.SegmentHeaders);

        // ระบุไว้ชุดเดียว = ใช้ชุดนั้นทั้งสองขั้น ไม่ต้องแยกทาง
        if (stream.PlaylistHeaders.Count > 0 && t.Get("segmentHeaders").IsNil())
            foreach (var (k, v) in stream.PlaylistHeaders) stream.SegmentHeaders[k] = v;

        if (string.IsNullOrEmpty(stream.Label) && stream.Height > 0)
            stream.Label = stream.Height + "p";

        return stream;
    }

    private static StreamKind ParseKind(string kind, string url) => kind.ToLowerInvariant() switch
    {
        "hls" or "m3u8" => StreamKind.Hls,
        "dash" or "mpd" => StreamKind.Dash,
        "file" or "direct" or "mp4" => StreamKind.File,
        "page" => StreamKind.Page,
        // module ไม่ได้บอกมา → เดาจากนามสกุลในลิงก์
        _ when url.Contains(".m3u8", StringComparison.OrdinalIgnoreCase) => StreamKind.Hls,
        _ when url.Contains(".mpd", StringComparison.OrdinalIgnoreCase) => StreamKind.Dash,
        _ => StreamKind.File,
    };

    private static void CopyHeaders(DynValue v, Dictionary<string, string> into)
    {
        if (v.Type != DataType.Table) return;
        foreach (var pair in v.Table.Pairs)
        {
            if (pair.Key.Type != DataType.String) continue;
            into[pair.Key.String] = pair.Value.CastToString() ?? "";
        }
    }

    /// <summary>
    /// ดึงหน้าแรกให้ module
    ///
    /// ใช้ชั้นดึงหน้าเว็บเต็มรูปแบบเมื่อมีให้ · เดิมใช้ HttpClient ล้วน ซึ่งแปลว่า
    /// module ไม่มีทางได้หน้าของเว็บที่สร้างเนื้อหาด้วย JS หรือเว็บที่กันบอท
    /// ทั้งที่แอปมีเบราว์เซอร์จริงอยู่แล้ว
    /// </summary>
    private string SafeGet(string url, CancellationToken ct)
    {
        try
        {
            if (fetcher is not null)
                return fetcher.FetchAsync(url, allowVisible: false, ct).GetAwaiter().GetResult().Html;

            return web.Get(url, new Dictionary<string, string>(), ct).Body ?? "";
        }
        catch (OperationCanceledException) { throw; }
        catch { return ""; }   // ดึงหน้าแรกไม่ได้ก็ยังให้ module ลองเอง มันอาจคุยกับ API ตรงๆ
    }

    /// <summary>
    /// ล้มเหลวพร้อมเหตุผลที่ใช้ไล่ปัญหาได้จริง
    ///
    /// ต่อข้อความสุดท้ายที่ module เขียนไว้ด้วย เพราะ module รู้ว่ามันไปตันตรงไหน
    /// เดิมเก็บ log ไว้แต่ไม่เคยเอาออกมาให้ใครเห็น ผู้ใช้เลยได้แค่
    /// "module รันผ่านแต่ไม่ได้สตรีมกลับมาเลย" ซึ่งบอกอะไรไม่ได้เลย
    /// </summary>
    private static ResolveResult Failed(SiteModuleInfo info, string error, IReadOnlyList<string> log)
    {
        var lastWarning = log.LastOrDefault(l => l.StartsWith("WARN", StringComparison.Ordinal));
        var detail = lastWarning is null ? error : $"{error} ({lastWarning[4..].Trim()})";
        return new ResolveResult(true, info.Name, null, [], detail, log);
    }

    private static string Describe(Exception ex) => ex.Message.Split('\n')[0].Trim();

    private static string Str(Table t, string key) => t.Get(key).CastToString() ?? "";
    private static double Num(Table t, string key) => t.Get(key).CastToNumber() ?? 0;
    private static string? Nullable(string s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
