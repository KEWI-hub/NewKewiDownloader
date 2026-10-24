namespace NewKewi.Core.Engine;

public enum FailureKind
{
    Unknown,
    /// <summary>yt-dlp ไม่รู้จักเว็บนี้ — ต้องให้เราแกะลิงก์เอง</summary>
    UnsupportedSite,
    /// <summary>โดน Cloudflare หรือการกันบอทอื่น — ต้องใช้เบราว์เซอร์จริง</summary>
    BotWall,
    /// <summary>ต้องล็อกอิน/สมาชิก</summary>
    NeedsAuth,
    /// <summary>คลิปถูกลบหรือเป็นส่วนตัว</summary>
    Gone,
    /// <summary>ฝั่งเซิร์ฟเวอร์ล่ม (5xx)</summary>
    ServerDown,
    /// <summary>ลิงก์หมดอายุ ต้องขอใหม่</summary>
    Expired,
    /// <summary>ซากไฟล์เก่าใช้ต่อไม่ได้ (HTTP 416)</summary>
    StalePartial,
    /// <summary>เน็ต/timeout</summary>
    Network,
    /// <summary>พื้นที่ดิสก์หรือสิทธิ์เขียนไฟล์</summary>
    Disk,
}

public sealed record Failure(FailureKind Kind, string Message)
{
    /// <summary>จะได้ผลไหมถ้าถอยไปอ่านหน้าเว็บเอง แทนที่จะให้ yt-dlp ลองต่อ</summary>
    public bool WorthFallingBack =>
        Kind is FailureKind.UnsupportedSite or FailureKind.BotWall or FailureKind.Expired;
}

/// <summary>
/// แปลผลที่ yt-dlp พ่นออกมาเป็นสาเหตุที่คนอ่านรู้เรื่อง
///
/// ของเดิมกระจายการเช็คคำว่า "Unsupported URL" / "HTTP Error 500" / "impersonat"
/// ไว้ทั่วโค้ดเป็นเงื่อนไข fallback ซึ่งพังทุกครั้งที่ yt-dlp เปลี่ยนถ้อยคำ
/// ที่นี่รวมไว้เป็น **ตารางเดียว** ที่เทสครอบได้ทั้งตาราง
/// </summary>
public static class ErrorClassifier
{
    private static readonly (string[] Needles, FailureKind Kind, string Thai)[] Table =
    [
        (["http error 416", "requested range not satisfiable"], FailureKind.StalePartial,
            "ซากไฟล์ที่โหลดค้างไว้ใช้ต่อไม่ได้ ลบแล้วเริ่มใหม่"),

        (["unsupported url", "no suitable extractor"], FailureKind.UnsupportedSite,
            "yt-dlp ไม่รู้จักเว็บนี้ ต้องมี config ของเว็บถึงจะโหลดได้"),

        (["impersonat", "cloudflare", "just a moment", "enable javascript and cookies"], FailureKind.BotWall,
            "เว็บกันบอทอยู่ ต้องเปิดผ่านเบราว์เซอร์จริงก่อน"),

        (["http error 401", "http error 403", "login required", "members-only",
          "sign in to confirm", "private video"], FailureKind.NeedsAuth,
            "เข้าถึงไม่ได้ ต้องล็อกอินหรือเป็นสมาชิก"),

        (["http error 404", "http error 410", "video unavailable",
          "has been removed", "this video is no longer"], FailureKind.Gone,
            "คลิปนี้ถูกลบหรือไม่มีอยู่แล้ว"),

        (["http error 500", "http error 502", "http error 503",
          "http error 504", "http error 520", "http error 521", "http error 522"], FailureKind.ServerDown,
            "เซิร์ฟเวอร์ต้นทางล่ม ลองใหม่ทีหลัง"),

        (["expired", "token has expired", "link has expired"], FailureKind.Expired,
            "ลิงก์หมดอายุแล้ว ต้องขอลิงก์ใหม่"),

        (["timed out", "timeout", "connection reset", "connection aborted",
          "temporary failure in name resolution", "unable to connect"], FailureKind.Network,
            "ต่อเน็ตไปหาเว็บไม่ได้หรือหมดเวลารอ"),

        (["no space left", "disk full", "permission denied", "access is denied"], FailureKind.Disk,
            "เขียนไฟล์ไม่ได้ ดิสก์เต็มหรือไม่มีสิทธิ์"),
    ];

    public static Failure Classify(string stdErr, string stdOut = "", int exitCode = 1)
    {
        var text = (stdErr + "\n" + stdOut).ToLowerInvariant();

        foreach (var (needles, kind, thai) in Table)
        {
            if (needles.Any(n => text.Contains(n, StringComparison.Ordinal)))
                return new Failure(kind, thai);
        }

        var lastLine = LastMeaningfulLine(stdErr);
        return new Failure(FailureKind.Unknown,
            string.IsNullOrWhiteSpace(lastLine)
                ? $"โหลดไม่สำเร็จ (exit {exitCode})"
                : $"โหลดไม่สำเร็จ: {Trim(lastLine)}");
    }

    private static string LastMeaningfulLine(string text) =>
        text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .LastOrDefault(l => l.Length > 0 && !l.StartsWith("WARNING", StringComparison.OrdinalIgnoreCase))
        ?? "";

    private static string Trim(string s) => s.Length <= 200 ? s : s[..200] + "…";
}
