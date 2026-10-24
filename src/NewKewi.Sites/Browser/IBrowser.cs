namespace NewKewi.Sites.Browser;

public sealed record BrowsePage(
    string Html,
    string FinalUrl,
    IReadOnlyList<CapturedRequest> Requests,
    string UserAgent = "",
    /// <summary>ส่วนขยายกันโฆษณาทำงานอยู่จริงบนหน้านี้ไหม</summary>
    bool AdBlockActive = false,
    /// <summary>ผลของ JS ที่สั่งให้รันก่อนปิดหน้า · ใช้ไล่ปัญหา</summary>
    string ProbeResult = "")
{
    public static readonly BrowsePage Empty = new("", "", []);
    public bool HasHtml => Html.Length > 0;
}

public enum BrowseMode
{
    /// <summary>ไม่มีหน้าต่าง · ใช้ตอนแค่อยากได้ DOM หลังรัน JS</summary>
    Silent,

    /// <summary>มีหน้าต่างให้คนเห็น · ใช้ตอนเจอ Cloudflare แล้วต้องให้ผู้ใช้กดยืนยันเอง</summary>
    Visible,
}

/// <summary>
/// เบราว์เซอร์จริงที่แอปคุมเอง
/// แยกเป็น interface เพื่อให้เทสสวมตัวปลอมได้ — ไม่งั้นเทสทุกข้อต้องเปิด Chromium จริง
/// </summary>
public interface IBrowser
{
    bool IsReady { get; }

    /// <summary>เปิดหน้าเว็บ รอ JS ทำงาน แล้วคืน DOM จริง พร้อมรายการ request ที่ดักได้</summary>
    Task<BrowsePage> OpenAsync(string url, BrowseMode mode, int waitSeconds, CancellationToken ct);
}
