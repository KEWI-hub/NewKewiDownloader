using NewKewi.Sites.Browser;

namespace NewKewi.Sites;

public enum FetchLayer
{
    /// <summary>HttpClient ธรรมดา · เบาที่สุด ใช้ได้กับเว็บส่วนใหญ่</summary>
    Simple,

    /// <summary>Chromium ไม่มีหน้าต่าง · เมื่อหน้าเว็บสร้างเนื้อหาด้วย JS</summary>
    Silent,

    /// <summary>Chromium มีหน้าต่าง · เมื่อต้องให้ผู้ใช้กดยืนยันผ่านด่านกันบอทเอง</summary>
    Visible,
}

public sealed record FetchResult(
    string Html,
    string FinalUrl,
    FetchLayer Layer,
    int Status,
    IReadOnlyList<CapturedRequest> Requests)
{
    public bool HasHtml => Html.Length > 0;
}

/// <summary>
/// ชั้นดึงหน้าเว็บ 3 ชั้น ไล่จากเบาไปหนัก
///
/// ส่วนนี้ยกมาจากแอปเก่าทั้งดุ้นเพราะเป็นของที่คุ้มที่สุด:
/// เว็บส่วนใหญ่จบที่ชั้นแรก เว็บที่ใช้ JS จบที่ชั้นสอง เหลือแค่ด่านกันบอทที่ต้องพึ่งคน
/// </summary>
public sealed class PageFetcher(IWebClient web, IBrowser browser)
{
    public static bool LooksLikeBotWall(string html, int status) => BotWall.Detect(html, status);

    public FetchResult Simple(string url, CancellationToken ct)
    {
        var r = web.Get(url, new Dictionary<string, string>(), ct);
        return new FetchResult(r.Body ?? "", r.FinalUrl, FetchLayer.Simple, r.Status, []);
    }

    public async Task<FetchResult> BrowserAsync(
        string url, BrowseMode mode, int waitSeconds, CancellationToken ct)
    {
        var page = await browser.OpenAsync(url, mode, waitSeconds, ct).ConfigureAwait(false);
        return new FetchResult(page.Html, page.FinalUrl,
            mode == BrowseMode.Visible ? FetchLayer.Visible : FetchLayer.Silent,
            page.HasHtml ? 200 : 0, page.Requests);
    }

    /// <summary>
    /// ไล่ชั้นให้อัตโนมัติ · ขยับขึ้นชั้นถัดไปเมื่อเจอด่านกันบอทเท่านั้น
    /// (หน้าที่ "ไม่เจอวิดีโอ" ให้ <see cref="GenericResolver"/> เป็นคนตัดสินใจขยับเอง)
    /// </summary>
    public async Task<FetchResult> FetchAsync(string url, bool allowVisible, CancellationToken ct)
    {
        var simple = Simple(url, ct);
        if (!LooksLikeBotWall(simple.Html, simple.Status) && simple.HasHtml) return simple;

        if (!browser.IsReady) return simple;

        var silent = await BrowserAsync(url, BrowseMode.Silent, 25, ct).ConfigureAwait(false);
        if (!LooksLikeBotWall(silent.Html, silent.Status) && silent.HasHtml) return silent;

        if (!allowVisible) return silent.HasHtml ? silent : simple;

        // ชั้นสุดท้าย: เปิดหน้าต่างให้ผู้ใช้กดผ่านด่านเอง แล้วเราเก็บ cookie ที่ได้ไว้ใช้ต่อ
        var visible = await BrowserAsync(url, BrowseMode.Visible, 90, ct).ConfigureAwait(false);
        return visible.HasHtml ? visible : silent;
    }
}
