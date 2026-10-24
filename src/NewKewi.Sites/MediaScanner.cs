using System.Text.RegularExpressions;
using NewKewi.Core.Models;

namespace NewKewi.Sites;

/// <summary>ลิงก์สื่อที่สแกนเจอในหน้าเว็บ</summary>
public sealed record FoundMedia(string Url, StreamKind Kind);

/// <summary>
/// กวาดหาลิงก์วิดีโอกับ iframe จาก HTML ดิบ
/// ใช้กับเว็บที่ยังไม่มี Lua module — ไม่รู้จักโครงหน้า จึงหาจากรูปแบบของลิงก์เอา
/// </summary>
public static partial class MediaScanner
{
    public static IReadOnlyList<FoundMedia> FindMedia(string html, string baseUrl)
    {
        if (string.IsNullOrEmpty(html)) return [];

        var text = Unescape(html);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var found = new List<FoundMedia>();

        void Take(string raw, StreamKind kind)
        {
            var url = Lua.LuaSandbox.UrlJoin(baseUrl, raw.Trim());
            if (url.Length == 0 || !seen.Add(url)) return;
            found.Add(new FoundMedia(url, kind));
        }

        foreach (Match m in PlaylistRegex().Matches(text))
        {
            var u = m.Value;
            Take(u, u.Contains(".mpd", StringComparison.OrdinalIgnoreCase)
                ? StreamKind.Dash : StreamKind.Hls);
        }

        // ช่อง src/file ต้องมีหน้าตาเป็นไฟล์สื่อจริงๆ ถึงจะนับ
        // ไม่งั้น src ของ iframe / script / img จะถูกนับเป็นวิดีโอ แล้วเราจะไม่เคยตามเข้า iframe เลย
        foreach (Match m in FileFieldRegex().Matches(text))
        {
            var value = m.Groups[1].Value;
            if (LooksLikeMedia(value)) Take(value, Guess(value));
        }

        foreach (Match m in DirectVideoRegex().Matches(text)) Take(m.Value, StreamKind.File);

        // playlist มาก่อนไฟล์เดี่ยวเสมอ — คลิปยาวๆ เว็บมักให้ mp4 ตัวอย่างสั้นๆ ปนมาด้วย
        return found.OrderBy(f => f.Kind == StreamKind.File ? 1 : 0).ToList();
    }

    /// <summary>iframe ที่อาจมี player ซ้อนอยู่ข้างใน</summary>
    public static IReadOnlyList<string> FindFrames(string html, string baseUrl)
    {
        if (string.IsNullOrEmpty(html)) return [];

        var text = Unescape(html);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var frames = new List<string>();

        foreach (Match m in FrameRegex().Matches(text))
        {
            var raw = m.Groups[1].Value.Trim();
            if (raw.Length == 0 || raw.StartsWith("about:", StringComparison.OrdinalIgnoreCase)) continue;

            var url = Lua.LuaSandbox.UrlJoin(baseUrl, raw);
            if (!url.StartsWith("http", StringComparison.OrdinalIgnoreCase)) continue;
            if (IsAdFrame(url)) continue;
            if (seen.Add(url)) frames.Add(url);
        }
        return frames;
    }

    /// <summary>iframe โฆษณามีเยอะมากในเว็บพวกนี้ ตามเข้าไปก็เสียเวลาเปล่า</summary>
    private static bool IsAdFrame(string url)
    {
        string[] marks =
        [
            "doubleclick", "googlesyndication", "googletagmanager", "google-analytics",
            "adsystem", "/ads/", "popads", "exoclick", "juicyads", "trafficjunky",
            "disqus", "facebook.com/plugins", "platform.twitter",
        ];
        return marks.Any(m => url.Contains(m, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>นามสกุลสื่อ โดยดูเฉพาะส่วน path ไม่รวม query</summary>
    public static bool LooksLikeMedia(string url)
    {
        var path = url.Split('?', '#')[0];
        string[] exts = [".m3u8", ".mpd", ".mp4", ".webm", ".mkv", ".mov", ".m4v", ".ts"];
        return exts.Any(e => path.EndsWith(e, StringComparison.OrdinalIgnoreCase));
    }

    private static StreamKind Guess(string url) =>
        url.Contains(".m3u8", StringComparison.OrdinalIgnoreCase) ? StreamKind.Hls
        : url.Contains(".mpd", StringComparison.OrdinalIgnoreCase) ? StreamKind.Dash
        : StreamKind.File;

    /// <summary>ลิงก์ใน JSON ที่ฝังในหน้าเว็บมักเขียน <c>\/</c> แทน <c>/</c></summary>
    private static string Unescape(string s)
        => s.Replace("\\/", "/", StringComparison.Ordinal)
            .Replace("\\u0026", "&", StringComparison.Ordinal)
            .Replace("&amp;", "&", StringComparison.Ordinal);

    [GeneratedRegex(@"https?://[^\s""'<>\\)]+\.(?:m3u8|mpd)(?:\?[^\s""'<>\\)]*)?",
        RegexOptions.IgnoreCase)]
    private static partial Regex PlaylistRegex();

    /// <summary>รูปแบบ <c>file: "..."</c> / <c>"src":"..."</c> ที่ player อย่าง jwplayer ใช้</summary>
    [GeneratedRegex(@"(?:""|')?(?:file|src|source|hls|videoSource|play_url)(?:""|')?\s*[:=]\s*[""']([^""']{8,})[""']",
        RegexOptions.IgnoreCase)]
    private static partial Regex FileFieldRegex();

    [GeneratedRegex(@"https?://[^\s""'<>\\)]+\.(?:mp4|webm|mkv|mov)(?:\?[^\s""'<>\\)]*)?",
        RegexOptions.IgnoreCase)]
    private static partial Regex DirectVideoRegex();

    [GeneratedRegex(@"<iframe[^>]+src\s*=\s*[""']([^""']+)[""']", RegexOptions.IgnoreCase)]
    private static partial Regex FrameRegex();
}
