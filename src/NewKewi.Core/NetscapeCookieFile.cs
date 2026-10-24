using System.Globalization;
using System.Net;
using System.Text;

namespace NewKewi.Core;

/// <summary>
/// ไฟล์ cookie แบบ Netscape — รูปแบบเดียวกับที่ yt-dlp กิน
///
/// cookie ทั้งหมดในนี้มาจาก **Chromium พกพาของแอปเอง** ไม่เคยมีของเบราว์เซอร์ผู้ใช้ปนอยู่
/// และลบทิ้งได้ทั้งไฟล์
/// </summary>
public static class NetscapeCookieFile
{
    /// <summary>อ่านไฟล์เข้า container เพื่อให้ HttpClient ใช้ cookie ชุดเดียวกับเบราว์เซอร์</summary>
    public static int LoadInto(string path, CookieContainer container)
    {
        if (!File.Exists(path)) return 0;

        var added = 0;
        foreach (var line in ReadLines(path))
        {
            if (line.Length == 0 || line[0] == '#') continue;

            var f = line.Split('\t');
            if (f.Length < 7) continue;

            var domain = f[0].Trim();
            var cookiePath = f[2].Trim();
            var secure = f[3].Trim().Equals("TRUE", StringComparison.OrdinalIgnoreCase);
            var name = f[5].Trim();
            var value = f[6];

            if (domain.Length == 0 || name.Length == 0) continue;

            try
            {
                container.Add(new Cookie(name, value,
                    cookiePath.Length > 0 ? cookiePath : "/",
                    domain.TrimStart('.'))
                {
                    Secure = secure,
                });
                added++;
            }
            catch (CookieException)
            {
                // cookie ที่ชื่อหรือค่าผิดรูป — ข้ามตัวนั้นไป ไม่ใช่ทิ้งทั้งไฟล์
            }
        }
        return added;
    }

    /// <summary>เวลาแก้ไขล่าสุด · ใช้ดูว่ามี cookie ใหม่หลังเปิดเบราว์เซอร์ไหม</summary>
    public static DateTime LastWritten(string path)
        => File.Exists(path) ? File.GetLastWriteTimeUtc(path) : DateTime.MinValue;

    public static void Write(string path, IEnumerable<CookieRecord> cookies)
    {
        var sb = new StringBuilder();
        sb.Append("# Netscape HTTP Cookie File\n");
        sb.Append("# เขียนโดย New Kewi Video Downloader — cookie ของแอปเอง ไม่ใช่ของเบราว์เซอร์ผู้ใช้\n");

        foreach (var c in cookies)
        {
            if (string.IsNullOrEmpty(c.Domain) || string.IsNullOrEmpty(c.Name)) continue;
            sb.Append(c.Domain).Append('\t')
              .Append(c.Domain.StartsWith('.') ? "TRUE" : "FALSE").Append('\t')
              .Append(string.IsNullOrEmpty(c.Path) ? "/" : c.Path).Append('\t')
              .Append(c.Secure ? "TRUE" : "FALSE").Append('\t')
              .Append(c.Expires.ToString(CultureInfo.InvariantCulture)).Append('\t')
              .Append(c.Name).Append('\t')
              .Append(c.Value).Append('\n');
        }

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
    }

    private static IEnumerable<string> ReadLines(string path)
    {
        string[] lines;
        try { lines = File.ReadAllLines(path, Encoding.UTF8); }
        catch (IOException) { yield break; }

        foreach (var l in lines) yield return l.TrimEnd('\r');
    }
}

public sealed record CookieRecord(
    string Domain, string Path, string Name, string Value, bool Secure, long Expires);
