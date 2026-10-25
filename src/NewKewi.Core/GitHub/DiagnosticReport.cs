using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace NewKewi.Core.GitHub;

/// <summary>
/// ข้อมูลที่ส่งขึ้น repo log เพื่อเอาไปเขียน config ของเว็บนั้นต่อ
///
/// **สิ่งที่จงใจไม่เก็บ:** cookie, query string, url เต็ม, ชื่อไฟล์ปลายทาง, ชื่อเครื่อง
/// เก็บแค่พอให้รู้ว่า "เว็บนี้ หน้าแบบนี้ เดินไปถึงไหนแล้วตันตรงไหน"
/// </summary>
public sealed class DiagnosticReport
{
    public int Schema { get; init; } = 1;
    public string App { get; init; } = "";
    public DateTimeOffset When { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>โดเมนของเว็บ · ต้องมี ไม่งั้นเอาไปทำ config ไม่ได้</summary>
    public string Host { get; init; } = "";

    /// <summary>sha256 ของ url เต็ม · ใช้ดูว่าเป็นคลิปเดิมไหม โดยไม่ต้องเก็บ url</summary>
    public string UrlHash { get; init; } = "";

    /// <summary>path ของหน้า **ไม่มี query** · บอกรูปแบบ url ของเว็บนั้น</summary>
    public string UrlPath { get; init; } = "";

    public string Reason { get; init; } = "";

    /// <summary>ทางที่ตัวแกะลิงก์เดินมา (คัดกรองแล้ว)</summary>
    public IReadOnlyList<string> Trail { get; init; } = [];

    /// <summary>ชื่อไฟล์ที่จะใช้ใน repo · <c>needs-config/&lt;host&gt;/&lt;วันที่&gt;-&lt;hash8&gt;.json</c></summary>
    public string RepoPath =>
        $"needs-config/{SafeFolder(Host)}/{When:yyyy-MM-dd}-{Short(UrlHash)}.json";

    private static string Short(string hash) => hash.Length >= 8 ? hash[..8] : "nohash";

    private static string SafeFolder(string host)
    {
        var cleaned = new string((host ?? "").Where(c => char.IsLetterOrDigit(c) || c is '.' or '-').ToArray());
        return cleaned.Length == 0 ? "unknown" : cleaned;
    }
}

/// <summary>
/// ปั้น <see cref="DiagnosticReport"/> จากงานที่ล้มเหลว พร้อมคัดกรองข้อมูลส่วนตัวออก
///
/// คัดกรองที่นี่ที่เดียว ไม่กระจายไปทำตามจุดต่างๆ — ตรวจง่ายและเทสคลุมได้หมด
/// </summary>
public static partial class DiagnosticBuilder
{
    public static DiagnosticReport Build(
        string sourceUrl, string? reason, IReadOnlyList<string>? trail, string appVersion)
    {
        Uri.TryCreate(sourceUrl, UriKind.Absolute, out var uri);

        return new DiagnosticReport
        {
            App = appVersion,
            Host = uri?.Host ?? "unknown",
            UrlHash = Sha256(sourceUrl),
            UrlPath = Scrub(uri?.AbsolutePath ?? ""),
            Reason = Clip(reason ?? "", 300),
            Trail = (trail ?? []).Select(Scrub).Where(s => s.Length > 0).Take(40).ToList(),
        };
    }

    /// <summary>
    /// ลบของที่ไม่ควรออกจากเครื่องผู้ใช้
    /// ตัด query string, ตัดค่าที่หน้าตาเหมือน token/key, ตัดความยาวเกิน
    /// </summary>
    public static string Scrub(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";

        // ตัด query string ของทุก url ที่โผล่ในข้อความ — ในนั้นมักมี token และ id ของผู้ใช้
        var cleaned = QueryRegex().Replace(text, "");

        // เผื่อมีคู่ key=value ลอยๆ ที่หน้าตาเป็นความลับ
        cleaned = SecretRegex().Replace(cleaned, "$1=***");

        return Clip(cleaned.Trim(), 300);
    }

    public static string Sha256(string text)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text ?? ""))).ToLowerInvariant();

    private static string Clip(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    [GeneratedRegex(@"\?[^\s""']*")]
    private static partial Regex QueryRegex();

    [GeneratedRegex(@"\b(token|key|auth|session|sid|pass|password|cookie|signature|sig)\b\s*=\s*[^\s&;""']+",
        RegexOptions.IgnoreCase)]
    private static partial Regex SecretRegex();
}
