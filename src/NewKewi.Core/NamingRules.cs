using System.Text.RegularExpressions;

namespace NewKewi.Core;

public sealed class NamingReplace
{
    public string From { get; set; } = "";
    public string To { get; set; } = "";
}

public sealed class NamingRule
{
    /// <summary>โดเมนที่กฎนี้ใช้ · ว่าง = กฎเริ่มต้น</summary>
    public string Host { get; set; } = "";

    /// <summary>รูปแบบชื่อไฟล์ · ใช้ได้: {title} {host} {quality} {date} {id}</summary>
    public string Template { get; set; } = "{title}";

    /// <summary>XPath ของชื่อคลิปในหน้าเว็บ · ว่าง = ใช้ชื่อที่หาได้ตามปกติ</summary>
    public string TitleFrom { get; set; } = "";

    /// <summary>โฟลเดอร์ย่อยใต้โฟลเดอร์ปลายทาง · ว่าง = ไม่แยก</summary>
    public string Folder { get; set; } = "";

    public int MaxLength { get; set; } = 120;

    /// <summary>
    /// regex เก็บกวาด **ค่าของ {title}** ก่อนเอาไปใส่ในรูปแบบ
    ///
    /// ทำกับ title ไม่ใช่กับชื่อที่ประกอบเสร็จแล้ว เพราะขยะมาจากชื่อหน้าเว็บ
    /// (เช่น ลงท้ายด้วย " - ชื่อเว็บ") ถ้าไปทำทีหลัง กฎที่ยึดท้ายสตริงด้วย <c>$</c>
    /// จะไม่แมตช์ทันทีที่รูปแบบมีอะไรต่อท้าย เช่น <c>{title} ({quality})</c>
    /// </summary>
    public List<NamingReplace> Replace { get; set; } = [];
}

/// <summary>
/// กฎตั้งชื่อไฟล์ต่อเว็บ · อ่านจาก <c>modules/naming.json</c>
///
/// มีไว้สำหรับเว็บที่**ไม่มี Lua module** เป็นหลัก เพราะเว็บพวกนั้นได้ชื่อตามที่ yt-dlp เดาให้
/// จะได้ไม่ต้องเขียน module ทั้งไฟล์แค่เพราะอยากแก้ชื่อไฟล์
/// (เว็บที่มี module ก็ใช้ได้ ถ้าโดเมนตรงกฎ — มันแค่ทับชื่อที่ module ตั้งมา)
///
/// แนวคิดยืมมาจาก smartnaming ของ Video DownloadHelper แต่ใช้ XPath ชุดเดียวกับทั้งแอป
/// ไม่ใช่ CSS selector จะได้ไม่มีสองภาษาให้จำ
/// </summary>
public sealed partial class NamingRules
{
    public NamingRule Default { get; set; } = new();
    public List<NamingRule> Rules { get; set; } = [];

    public static NamingRules Load(string path) => Json.Read(path, new NamingRules());

    /// <summary>กฎที่ตรงกับโดเมนนี้ · ตัวบนในไฟล์ชนะ · ไม่ตรงเลยก็ใช้กฎเริ่มต้น</summary>
    public NamingRule Match(string? host)
    {
        if (string.IsNullOrWhiteSpace(host)) return Default;

        var clean = host.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? host[4..] : host;

        foreach (var rule in Rules)
        {
            if (string.IsNullOrWhiteSpace(rule.Host)) continue;
            var domain = rule.Host.Trim().ToLowerInvariant();
            if (clean.Equals(domain, StringComparison.OrdinalIgnoreCase) ||
                clean.EndsWith("." + domain, StringComparison.OrdinalIgnoreCase))
                return rule;
        }
        return Default;
    }

    /// <summary>
    /// แทนค่าในรูปแบบแล้วเก็บกวาดให้เป็นชื่อไฟล์ที่ใช้ได้จริง
    /// คืนสตริงว่างเมื่อผลออกมาไม่มีอะไรเหลือ — ผู้เรียกจะได้รู้ว่าให้ใช้ชื่อเดิมต่อ
    /// </summary>
    public static string Apply(NamingRule rule, IReadOnlyDictionary<string, string> values)
    {
        var name = rule.Template;
        if (string.IsNullOrWhiteSpace(name)) name = "{title}";

        // เก็บกวาด title ก่อน แล้วค่อยเอาไปใส่ในรูปแบบ
        var cleaned = new Dictionary<string, string>(values, StringComparer.OrdinalIgnoreCase);
        if (cleaned.TryGetValue("title", out var title))
            cleaned["title"] = Clean(title, rule.Replace);

        foreach (var (key, value) in cleaned)
            name = name.Replace("{" + key + "}", value, StringComparison.OrdinalIgnoreCase);

        // ตัวแปรที่ไม่มีค่าให้ ลบทิ้งแทนที่จะปล่อยให้ {xxx} ติดไปอยู่ในชื่อไฟล์
        name = LeftoverRegex().Replace(name, "");

        // เก็บกวาดวงเล็บที่ว่างเปล่าและช่องว่างซ้อน ซึ่งเกิดจากตัวแปรที่ไม่มีค่า
        name = EmptyBracketRegex().Replace(name, "");
        name = SpaceRegex().Replace(name, " ").Trim(' ', '-', '_', '.');

        var max = rule.MaxLength > 0 ? rule.MaxLength : 120;
        if (name.Length > max) name = name[..max].Trim();

        return name;
    }

    /// <summary>ใช้กฎ replace กับค่าหนึ่งค่า · regex ที่ผู้ใช้เขียนผิดถูกข้ามไปเฉยๆ</summary>
    private static string Clean(string value, List<NamingReplace> replaces)
    {
        foreach (var r in replaces)
        {
            if (string.IsNullOrEmpty(r.From)) continue;
            try
            {
                value = Regex.Replace(value, r.From, r.To ?? "", RegexOptions.None, TimeSpan.FromSeconds(2));
            }
            catch (ArgumentException) { /* regex ที่ผู้ใช้เขียนผิด — ข้ามข้อนั้น */ }
            catch (RegexMatchTimeoutException) { /* ยอมแพ้ข้อนั้น */ }
        }
        return value.Trim();
    }

    [GeneratedRegex(@"\{[A-Za-z0-9_]+\}")]
    private static partial Regex LeftoverRegex();

    [GeneratedRegex(@"\(\s*\)|\[\s*\]")]
    private static partial Regex EmptyBracketRegex();

    [GeneratedRegex(@"\s{2,}")]
    private static partial Regex SpaceRegex();
}
