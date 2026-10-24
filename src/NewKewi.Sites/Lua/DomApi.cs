using HtmlAgilityPack;
using MoonSharp.Interpreter;

namespace NewKewi.Sites.Lua;

/// <summary>
/// ห่อ HtmlAgilityPack ให้ Lua เรียกแบบ <c>dom.SelectValue('//h1')</c>
///
/// คืนเป็น Lua table ที่ข้างในเป็น closure จับเอกสารไว้ จึงเรียกด้วยจุด (ไม่ใช่โคลอน) ได้
/// เหมือนรูปแบบที่ HDoujinDownloader ใช้ คนที่เคยเขียน module ที่นั่นจะเขียนที่นี่ได้ทันที
/// </summary>
public static class DomApi
{
    public static Table Create(Script script, string html)
    {
        var doc = new HtmlDocument();
        doc.LoadHtml(html ?? "");
        var root = doc.DocumentNode;

        var t = new Table(script);

        t["SelectValue"] = (Func<string, string>)(xpath => First(root, xpath) ?? "");
        t["SelectValues"] = (Func<string, Table>)(xpath => ToTable(script, All(root, xpath)));
        t["Exists"] = (Func<string, bool>)(xpath => First(root, xpath) is not null);
        t["Html"] = html ?? "";
        t["Title"] = Clean(root.SelectSingleNode("//title")?.InnerText) ?? "";

        return t;
    }

    /// <summary>ตัวสร้างแบบ <c>Dom.New(html)</c></summary>
    public static Table CreateFactory(Script script)
    {
        var factory = new Table(script);
        factory["New"] = (Func<string, Table>)(html => Create(script, html));
        return factory;
    }

    private static string? First(HtmlNode root, string xpath) => All(root, xpath).FirstOrDefault();

    /// <summary>
    /// รองรับ xpath ที่ลงท้ายด้วย <c>/@attr</c> เอง
    /// เพราะ HtmlAgilityPack เลือก attribute ตรงๆ ได้ไม่ครบทุกกรณี
    /// </summary>
    private static List<string> All(HtmlNode root, string xpath)
    {
        var results = new List<string>();
        if (string.IsNullOrWhiteSpace(xpath)) return results;

        string? attribute = null;
        var at = xpath.LastIndexOf("/@", StringComparison.Ordinal);
        if (at > 0 && !xpath[(at + 2)..].Contains('/'))
        {
            attribute = xpath[(at + 2)..];
            xpath = xpath[..at];
        }

        HtmlNodeCollection? nodes;
        try { nodes = root.SelectNodes(xpath); }
        catch (System.Xml.XPath.XPathException) { return results; }   // xpath พัง → ว่าง ไม่ใช่ทั้งแอปล้ม
        if (nodes is null) return results;

        foreach (var n in nodes)
        {
            var value = attribute is null
                ? Clean(n.InnerText)
                : Clean(n.GetAttributeValue(attribute, null));
            if (!string.IsNullOrEmpty(value)) results.Add(value);
        }
        return results;
    }

    private static string? Clean(string? s)
        => s is null ? null : HtmlEntity.DeEntitize(s).Trim();

    private static Table ToTable(Script script, IEnumerable<string> values)
    {
        var t = new Table(script);
        var i = 1;
        foreach (var v in values) t[i++] = v;
        return t;
    }
}
