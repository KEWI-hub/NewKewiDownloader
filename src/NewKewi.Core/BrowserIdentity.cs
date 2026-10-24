namespace NewKewi.Core;

/// <summary>
/// ตัวตนของเบราว์เซอร์ที่แอปใช้ — เก็บไว้ที่เดียวแล้วใช้ร่วมกันทุกชั้น
///
/// **ทำไมเรื่องนี้สำคัญกับการฝ่า Cloudflare:** cookie `cf_clearance` ที่ได้มาตอนผู้ใช้กดผ่านด่าน
/// ผูกกับ **User-Agent ที่ใช้ตอนได้มันมา** ถ้าเอา cookie ไปใช้กับ UA คนละตัว Cloudflare จะไม่ยอม
/// แล้วเราจะเจอด่านซ้ำทั้งที่กดผ่านไปแล้ว
///
/// ดังนั้น UA ของ Chromium พกพา · ของ HttpClient · ของ yt-dlp ต้องเป็นตัวเดียวกันหมด
/// </summary>
public sealed class BrowserIdentity
{
    private readonly string _file;

    public BrowserIdentity(AppPaths paths)
    {
        _file = Path.Combine(paths.Data, "identity.json");
        var saved = Json.Read(_file, new Record());
        if (!string.IsNullOrWhiteSpace(saved.UserAgent)) UserAgent = saved.UserAgent;
    }

    /// <summary>UA จริงของ Chromium พกพา · null = ยังไม่เคยเปิดเบราว์เซอร์</summary>
    public string? UserAgent { get; private set; }

    public void Set(string? userAgent)
    {
        var ua = userAgent?.Trim();
        if (string.IsNullOrEmpty(ua) || ua == UserAgent) return;

        UserAgent = ua;
        Json.Write(_file, new Record { UserAgent = ua });
    }

    private sealed class Record
    {
        public string? UserAgent { get; set; }
    }
}
