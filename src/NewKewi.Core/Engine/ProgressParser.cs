using System.Globalization;

namespace NewKewi.Core.Engine;

public readonly record struct DownloadProgress(
    long DownloadedBytes,
    long TotalBytes,
    double SpeedBytesPerSecond,
    int EtaSeconds,
    int FragmentIndex = 0,
    int FragmentCount = 0)
{
    public double Percent => TotalBytes > 0
        ? Math.Clamp(DownloadedBytes * 100.0 / TotalBytes, 0, 100)
        : 0;
}

/// <summary>
/// อ่านบรรทัดความคืบหน้าที่เราสั่งให้ yt-dlp พิมพ์ตามรูปแบบของเราเอง
/// ไม่ได้ parse ข้อความอังกฤษอิสระ จึงไม่พังเวลา yt-dlp เปลี่ยนถ้อยคำ
/// </summary>
public static class ProgressParser
{
    public static bool TryParse(string line, out DownloadProgress progress)
    {
        progress = default;
        if (line is null) return false;

        var i = line.IndexOf(YtDlpArgs.ProgressPrefix, StringComparison.Ordinal);
        if (i < 0) return false;

        var parts = line[(i + YtDlpArgs.ProgressPrefix.Length)..].Split('|');
        // [0] ว่าง (มาจากตัวคั่นตัวแรก) [1] downloaded [2] total [3] estimate [4] speed [5] eta
        if (parts.Length < 6) return false;

        var downloaded = Num(parts[1]);
        var total = Num(parts[2]);
        if (total <= 0) total = Num(parts[3]);   // บาง stream บอกได้แค่ค่าประมาณ

        progress = new DownloadProgress(
            (long)downloaded,
            (long)total,
            Num(parts[4]),
            (int)Num(parts[5]),
            // ชิ้นส่วนของ HLS · บรรทัดรุ่นเก่าไม่มี 2 ช่องนี้ ถือว่าเป็น 0
            parts.Length > 6 ? (int)Num(parts[6]) : 0,
            parts.Length > 7 ? (int)Num(parts[7]) : 0);
        return true;
    }

    /// <summary>yt-dlp ส่ง "NA" หรือ "None" มาได้เมื่อยังไม่รู้ค่า</summary>
    private static double Num(string s)
    {
        s = s.Trim();
        if (s.Length == 0 || s is "NA" or "None" or "N/A") return 0;
        return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) && v > 0 ? v : 0;
    }
}
