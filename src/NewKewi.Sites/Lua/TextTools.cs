using System.Text;
using System.Text.RegularExpressions;

namespace NewKewi.Sites.Lua;

/// <summary>เครื่องมือแกะข้อความที่เว็บชอบใช้ซ่อนลิงก์</summary>
public static partial class TextTools
{
    /// <summary>
    /// แตก JS ที่ถูกบีบด้วย <c>eval(function(p,a,c,k,e,d){...})</c> (packer ของ Dean Edwards)
    /// เว็บตระกูล FirePlayer ใช้ตัวนี้ซ่อนลิงก์วิดีโอ
    /// </summary>
    public static string UnpackJs(string source)
    {
        if (string.IsNullOrEmpty(source)) return "";

        var m = PackerRegex().Match(source);
        if (!m.Success) return source;

        var payload = m.Groups["p"].Value;
        var radix = int.Parse(m.Groups["a"].Value);
        var count = int.Parse(m.Groups["c"].Value);
        var words = m.Groups["k"].Value.Split('|');

        payload = Unescape(payload);

        var sb = new StringBuilder();
        foreach (var token in TokenRegex().Split(payload))
        {
            if (token.Length > 0 && IsWord(token))
            {
                var index = FromBase(token, radix);
                if (index >= 0 && index < count && index < words.Length && words[index].Length > 0)
                {
                    sb.Append(words[index]);
                    continue;
                }
            }
            sb.Append(token);
        }
        return sb.ToString();
    }

    /// <summary>แปลง <c>\x5a\x54</c> กลับเป็นตัวอักษร — FirePlayer ใช้ซ่อน base64 อีกชั้น</summary>
    public static string HexUnescape(string s)
        => string.IsNullOrEmpty(s) ? "" : HexEscapeRegex().Replace(s,
            m => ((char)Convert.ToInt32(m.Groups[1].Value, 16)).ToString());

    public static string Base64Decode(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        s = s.Trim().Replace('-', '+').Replace('_', '/');
        s = s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
        try { return Encoding.UTF8.GetString(Convert.FromBase64String(s)); }
        catch (FormatException) { return ""; }
    }

    public static string Base64Encode(string s)
        => Convert.ToBase64String(Encoding.UTF8.GetBytes(s ?? ""));

    /// <summary>จับด้วย regex แล้วคืนกลุ่มที่ขอ · group 0 = ทั้งก้อน · ไม่เจอ = สตริงว่าง</summary>
    public static string Match(string input, string pattern, int group = 1)
    {
        if (string.IsNullOrEmpty(input) || string.IsNullOrEmpty(pattern)) return "";
        try
        {
            var m = Regex.Match(input, pattern, RegexOptions.Singleline, TimeSpan.FromSeconds(5));
            if (!m.Success || group >= m.Groups.Count) return "";
            return m.Groups[group].Value;
        }
        catch (ArgumentException) { return ""; }      // pattern พัง
        catch (RegexMatchTimeoutException) { return ""; }
    }

    public static List<string> MatchAll(string input, string pattern, int group = 1)
    {
        var results = new List<string>();
        if (string.IsNullOrEmpty(input) || string.IsNullOrEmpty(pattern)) return results;
        try
        {
            foreach (Match m in Regex.Matches(input, pattern, RegexOptions.Singleline, TimeSpan.FromSeconds(5)))
                if (m.Success && group < m.Groups.Count) results.Add(m.Groups[group].Value);
        }
        catch (ArgumentException) { /* pattern พัง → ว่าง */ }
        catch (RegexMatchTimeoutException) { /* ยอมแพ้ */ }
        return results;
    }

    public static string Replace(string input, string pattern, string replacement)
    {
        if (string.IsNullOrEmpty(input)) return "";
        try { return Regex.Replace(input, pattern, replacement ?? "", RegexOptions.None, TimeSpan.FromSeconds(5)); }
        catch (ArgumentException) { return input; }
        catch (RegexMatchTimeoutException) { return input; }
    }

    // ---- ตัวช่วยตัดข้อความแบบที่ module เขียนง่าย ----

    public static string Before(string s, string mark)
    {
        var i = s?.IndexOf(mark, StringComparison.Ordinal) ?? -1;
        return i < 0 ? "" : s![..i];
    }

    public static string After(string s, string mark)
    {
        var i = s?.IndexOf(mark, StringComparison.Ordinal) ?? -1;
        return i < 0 ? "" : s![(i + mark.Length)..];
    }

    public static string BeforeLast(string s, string mark)
    {
        var i = s?.LastIndexOf(mark, StringComparison.Ordinal) ?? -1;
        return i < 0 ? "" : s![..i];
    }

    public static string AfterLast(string s, string mark)
    {
        var i = s?.LastIndexOf(mark, StringComparison.Ordinal) ?? -1;
        return i < 0 ? "" : s![(i + mark.Length)..];
    }

    // ---- ส่วนในของ UnpackJs ----

    private static string Unescape(string s) =>
        s.Replace("\\\\", "\\").Replace("\\'", "'").Replace("\\\"", "\"");

    private static bool IsWord(string t) => t.All(char.IsLetterOrDigit);

    private static int FromBase(string token, int radix)
    {
        const string Alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var value = 0;
        foreach (var c in token)
        {
            var digit = Alphabet.IndexOf(c);
            if (digit < 0 || digit >= radix) return -1;
            value = value * radix + digit;
        }
        return value;
    }

    [GeneratedRegex(@"\}\s*\(\s*'(?<p>.*?)'\s*,\s*(?<a>\d+)\s*,\s*(?<c>\d+)\s*,\s*'(?<k>.*?)'\s*\.split\('\|'\)",
        RegexOptions.Singleline)]
    private static partial Regex PackerRegex();

    [GeneratedRegex(@"(\b[0-9a-zA-Z]+\b)")]
    private static partial Regex TokenRegex();

    [GeneratedRegex(@"\\x([0-9a-fA-F]{2})")]
    private static partial Regex HexEscapeRegex();
}
