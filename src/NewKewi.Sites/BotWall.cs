namespace NewKewi.Sites;

/// <summary>
/// รู้จักหน้าตาของด่านกันบอท (Cloudflare, DDoS-Guard และพวกเดียวกัน)
///
/// แยกออกมาเป็นที่เดียว เพราะทั้ง <see cref="PageFetcher"/> (ตัดสินใจว่าจะขยับชั้นไหม)
/// และ <see cref="Browser.ChromiumBrowser"/> (รอจนกว่าผู้ใช้จะกดผ่าน) ต้องใช้คำตอบเดียวกัน
/// </summary>
public static class BotWall
{
    private static readonly string[] Marks =
    [
        "just a moment", "cf-browser-verification", "checking your browser",
        "__cf_chl", "cf-challenge", "enable javascript and cookies to continue",
        "ddos-guard", "attention required!", "verifying you are human",
        "needs to review the security of your connection",
    ];

    public static bool Detect(string html, int status)
    {
        // 403/503 ที่ตัวหน้าสั้นๆ แทบจะเป็นด่านกันบอทเสมอ
        if (status is 403 or 503 && html.Length < 100_000) return true;
        if (html.Length == 0) return false;

        var head = (html.Length > 60_000 ? html[..60_000] : html).ToLowerInvariant();
        return Marks.Any(m => head.Contains(m, StringComparison.Ordinal));
    }
}
