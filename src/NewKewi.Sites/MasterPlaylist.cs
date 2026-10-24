using System.Globalization;
using System.Text.RegularExpressions;
using NewKewi.Core.Models;

namespace NewKewi.Sites;

/// <summary>
/// อ่าน master playlist ของ HLS เพื่อดูว่ามีความชัดอะไรให้เลือกบ้าง
///
/// จำเป็นสำหรับ popup เลือกความชัดบนหน้า video player (เฟส 6)
/// และทำให้ผู้ใช้เลือก 720p ได้แทนที่จะโดนยัดตัวที่ใหญ่ที่สุดเสมอ
/// </summary>
public static partial class MasterPlaylist
{
    public static bool LooksLikeMaster(string body)
        => body.Contains("#EXT-X-STREAM-INF", StringComparison.Ordinal);

    /// <summary>คืนรายการความชัด · ไม่ใช่ master (เป็น playlist เดี่ยว) จะได้รายการว่าง</summary>
    public static IReadOnlyList<MediaStream> ParseVariants(string body, string masterUrl)
    {
        var variants = new List<MediaStream>();
        if (string.IsNullOrEmpty(body)) return variants;

        var lines = body.Split('\n', StringSplitOptions.TrimEntries);
        for (var i = 0; i < lines.Length; i++)
        {
            if (!lines[i].StartsWith("#EXT-X-STREAM-INF", StringComparison.Ordinal)) continue;

            // บรรทัดถัดไปที่ไม่ใช่คอมเมนต์คือ url ของความชัดนั้น
            var target = "";
            for (var j = i + 1; j < lines.Length; j++)
            {
                if (lines[j].Length == 0 || lines[j].StartsWith('#')) continue;
                target = lines[j];
                break;
            }
            if (target.Length == 0) continue;

            var height = 0;
            var res = ResolutionRegex().Match(lines[i]);
            if (res.Success) height = int.Parse(res.Groups[2].Value, CultureInfo.InvariantCulture);

            variants.Add(new MediaStream
            {
                Url = Lua.LuaSandbox.UrlJoin(masterUrl, target),
                Kind = StreamKind.Hls,
                Height = height,
                Label = height > 0 ? height + "p" : "auto",
            });
        }

        return variants
            .GroupBy(v => v.Url, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .OrderByDescending(v => v.Height)
            .ToList();
    }

    [GeneratedRegex(@"RESOLUTION=(\d+)x(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex ResolutionRegex();
}
