using NewKewi.Core.Models;
using NewKewi.Sites.Browser;

namespace NewKewi.Sites;

/// <summary>
/// ทางสำรองสำหรับเว็บที่**ยังไม่มี Lua module**
///
/// ลำดับที่เดิน (ตามเอกสาร §4):
///   1. ดึงหน้าเว็บ (ชั้น 1–2 · ขยับเองเมื่อเจอด่านกันบอท)
///   2. สแกนหา m3u8 / mpd / mp4 ในหน้า
///   3. ไม่เจอ → ตาม iframe ลงไปไม่เกิน 3 ชั้น (จำ player ที่ตายแล้ว ไม่ลองซ้ำในรอบเดียว)
///   4. ยังไม่เจอ → เปิดเบราว์เซอร์จริงแล้วดัก request ที่ JS ยิงออกมา
///   5. ยังไม่เจอ → ยอมแพ้พร้อมบันทึกว่าเดินไปถึงไหนแล้ว (เอาไปทำ config ต่อ)
/// </summary>
public sealed class GenericResolver(PageFetcher fetcher, IWebClient web, IBrowser browser)
{
    private const int MaxFrameDepth = 3;

    public ResolveOutcome Resolve(string url, CancellationToken ct)
        => ResolveAsync(url, ct).GetAwaiter().GetResult();

    public async Task<ResolveOutcome> ResolveAsync(string url, CancellationToken ct)
    {
        var trail = new List<string>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var page = await fetcher.FetchAsync(url, allowVisible: false, ct).ConfigureAwait(false);
        trail.Add($"fetch:{page.Layer} status={page.Status} bytes={page.Html.Length}");

        if (PageFetcher.LooksLikeBotWall(page.Html, page.Status))
            return Failed("เว็บกันบอทอยู่ ต้องเปิดผ่านเบราว์เซอร์แล้วกดยืนยันก่อน", trail);

        var title = ExtractTitle(page.Html);

        var media = await HuntAsync(page.Html, page.FinalUrl, 0, visited, trail, ct).ConfigureAwait(false);

        // ยังไม่เจอ → ให้เบราว์เซอร์จริงรัน JS แล้วดูว่ามันยิงอะไรออกไปบ้าง
        if (media.Count == 0 && browser.IsReady && page.Layer == FetchLayer.Simple)
        {
            var live = await fetcher.BrowserAsync(url, BrowseMode.Silent, 25, ct).ConfigureAwait(false);
            trail.Add($"browser:silent bytes={live.Html.Length} requests={live.Requests.Count}");

            if (string.IsNullOrEmpty(title)) title = ExtractTitle(live.Html);
            media = await HuntAsync(live.Html, live.FinalUrl, 0, visited, trail, ct).ConfigureAwait(false);

            if (media.Count == 0) media = FromCapturedRequests(live.Requests, trail);
        }
        else if (media.Count == 0 && page.Requests.Count > 0)
        {
            media = FromCapturedRequests(page.Requests, trail);
        }

        if (media.Count == 0)
            return Failed("หาลิงก์วิดีโอในหน้านี้ไม่เจอ — ต้องเขียน config ของเว็บนี้", trail);

        var streams = await ExpandAsync(media, ct).ConfigureAwait(false);
        return new ResolveOutcome(true, "Generic", title, streams, null);
    }

    /// <summary>สแกนหน้านี้ ไม่เจอก็ตามเข้า iframe ต่อ</summary>
    private async Task<List<FoundMedia>> HuntAsync(
        string html, string baseUrl, int depth,
        HashSet<string> visited, List<string> trail, CancellationToken ct)
    {
        var found = MediaScanner.FindMedia(html, baseUrl).ToList();
        if (found.Count > 0)
        {
            trail.Add($"scan depth={depth} found={found.Count}");
            return found;
        }
        if (depth >= MaxFrameDepth) return found;

        foreach (var frame in MediaScanner.FindFrames(html, baseUrl))
        {
            ct.ThrowIfCancellationRequested();

            // player ที่ลองแล้วไม่ได้อะไร ไม่ลองซ้ำในรอบเดียวกัน
            if (!visited.Add(frame)) continue;

            var inner = fetcher.Simple(frame, ct);
            trail.Add($"frame depth={depth + 1} status={inner.Status} {Host(frame)}");
            if (!inner.HasHtml) continue;

            var deeper = await HuntAsync(inner.Html, inner.FinalUrl, depth + 1, visited, trail, ct)
                .ConfigureAwait(false);
            if (deeper.Count > 0) return deeper;
        }

        return found;
    }

    private static List<FoundMedia> FromCapturedRequests(
        IReadOnlyList<CapturedRequest> requests, List<string> trail)
    {
        var hits = requests
            .Where(r => r.Url.Contains(".m3u8", StringComparison.OrdinalIgnoreCase) ||
                        r.Url.Contains(".mpd", StringComparison.OrdinalIgnoreCase) ||
                        (r.ResourceType.Equals("Media", StringComparison.OrdinalIgnoreCase) &&
                         r.Url.StartsWith("http", StringComparison.OrdinalIgnoreCase)))
            .Select(r => new FoundMedia(r.Url,
                r.Url.Contains(".m3u8", StringComparison.OrdinalIgnoreCase) ? StreamKind.Hls
                : r.Url.Contains(".mpd", StringComparison.OrdinalIgnoreCase) ? StreamKind.Dash
                : StreamKind.File))
            .GroupBy(m => m.Url, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        trail.Add($"captured matches={hits.Count}");
        return hits;
    }

    /// <summary>master playlist หนึ่งตัวแตกออกเป็นหลายความชัดให้ผู้ใช้เลือก</summary>
    private async Task<IReadOnlyList<MediaStream>> ExpandAsync(
        List<FoundMedia> media, CancellationToken ct)
    {
        var streams = new List<MediaStream>();

        foreach (var m in media.Take(5))
        {
            ct.ThrowIfCancellationRequested();

            if (m.Kind == StreamKind.Hls)
            {
                var body = web.Get(m.Url, new Dictionary<string, string>(), ct).Body ?? "";
                if (MasterPlaylist.LooksLikeMaster(body))
                {
                    streams.AddRange(MasterPlaylist.ParseVariants(body, m.Url));
                    continue;
                }
            }

            streams.Add(new MediaStream { Url = m.Url, Kind = m.Kind, Label = "auto" });
        }

        await Task.CompletedTask.ConfigureAwait(false);

        return streams
            .GroupBy(s => s.Url, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .OrderByDescending(s => s.Height)
            .ToList();
    }

    private static string? ExtractTitle(string html)
    {
        if (string.IsNullOrEmpty(html)) return null;
        var dom = new HtmlAgilityPack.HtmlDocument();
        dom.LoadHtml(html);

        var title = dom.DocumentNode.SelectSingleNode("//meta[@property='og:title']/@content") is not null
            ? dom.DocumentNode.SelectSingleNode("//meta[@property='og:title']")?.GetAttributeValue("content", "")
            : null;

        if (string.IsNullOrWhiteSpace(title))
            title = dom.DocumentNode.SelectSingleNode("//h1")?.InnerText;
        if (string.IsNullOrWhiteSpace(title))
            title = dom.DocumentNode.SelectSingleNode("//title")?.InnerText;

        title = HtmlAgilityPack.HtmlEntity.DeEntitize(title ?? "").Trim();
        return title.Length == 0 ? null : title;
    }

    /// <summary>เก็บร่องรอยไว้ด้วย — เป็นวัตถุดิบของ diagnostic bundle ในเฟส 7</summary>
    private static ResolveOutcome Failed(string message, List<string> trail)
        => new(true, "Generic", null, [], message + " · ทางที่เดินมา: " + string.Join(" → ", trail));

    private static string Host(string url)
        => Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host : url;
}
