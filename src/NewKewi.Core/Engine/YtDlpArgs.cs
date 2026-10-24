using NewKewi.Core.Models;
using NewKewi.Core.Settings;

namespace NewKewi.Core.Engine;

/// <summary>
/// ปั้นคำสั่งที่ส่งให้ yt-dlp
/// แยกออกมาเป็นคลาสล้วนๆ ไม่แตะดิสก์ ไม่ยิงเน็ต เพื่อให้เทสตรวจ args ได้ตรงๆ
/// </summary>
public static class YtDlpArgs
{
    /// <summary>ขึ้นต้นบรรทัดความคืบหน้า — ตั้งเองเพื่อไม่ต้องเดาจากข้อความอังกฤษของ yt-dlp</summary>
    public const string ProgressPrefix = "NKPROG";

    private const string ProgressTemplate =
        "download:" + ProgressPrefix +
        "|%(progress.downloaded_bytes)s|%(progress.total_bytes)s" +
        "|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s";

    public sealed record Context(
        AppPaths Paths,
        AppSettings Settings,
        string TempDir,
        string ResultPathFile,
        string? CookieJar);

    public static List<string> Build(DownloadItem item, Context ctx)
    {
        var s = item.Stream;
        var url = s?.Url ?? item.SourceUrl;
        var isPlaylist = s?.IsPlaylist ?? false;
        var a = new List<string>();

        // ---- พื้นฐาน ----
        a.Add("--ignore-config");          // ไม่ให้ไฟล์ config ในเครื่องผู้ใช้มาเปลี่ยนพฤติกรรม
        a.Add("--no-playlist");            // ลิงก์เดียว = คลิปเดียว ไม่ลากทั้งแชนเนลมา
        a.Add("--newline");
        a.Add("--progress");
        a.Add("--progress-template"); a.Add(ProgressTemplate);

        // ---- ไม่มี retry ระดับงาน ----
        // fail แล้วจบ ไม่วนซ้ำ · ที่เหลือไว้คือ retry ของชิ้นส่วนภายในความพยายามเดียวกัน
        // (ตั้ง 0 ได้ถ้าอยากเข้มกว่านี้)
        a.Add("--retries"); a.Add("0");
        a.Add("--extractor-retries"); a.Add("0");
        a.Add("--fragment-retries"); a.Add(ctx.Settings.FragmentRetries.ToString());
        a.Add("--no-abort-on-error");

        if (ctx.Settings.SocketTimeoutSeconds > 0)
        {
            a.Add("--socket-timeout");
            a.Add(ctx.Settings.SocketTimeoutSeconds.ToString());
        }

        // ---- ปลายทาง ----
        a.Add("--paths"); a.Add("home:" + item.OutputDirectory);
        a.Add("--paths"); a.Add("temp:" + ctx.TempDir);
        a.Add("-o"); a.Add(OutputTemplate(item));
        a.Add("--restrict-filenames");     // กันชื่อไฟล์ที่ Windows รับไม่ได้
        if (item.Force || !ctx.Settings.SkipExisting) a.Add("--force-overwrites");
        else a.Add("--no-overwrites");

        // บอกกลับมาว่าไฟล์จริงชื่ออะไร — ดีกว่าไปแกะจากข้อความ log ที่เปลี่ยนทุกเวอร์ชัน
        a.Add("--no-simulate");
        a.Add("--print-to-file"); a.Add("after_move:filepath"); a.Add(ctx.ResultPathFile);

        // ---- รูปแบบไฟล์: เล็งไปที่ mp4 ตั้งแต่ต้น ----
        if (ctx.Settings.AlwaysMp4)
        {
            a.Add("--merge-output-format"); a.Add("mp4");
        }
        a.Add("-f"); a.Add(FormatSelector(item));
        if (item.Stream is { Height: > 0 } st && st.Kind == StreamKind.Page)
        {
            a.Add("-S"); a.Add($"res:{st.Height}");
        }

        // ---- หลายช่องต่อหนึ่งลิงก์ ----
        var ch = ctx.Settings.ChannelsPerDownload;
        if (isPlaylist)
        {
            // playlist ต้องใช้ตัวโหลดในตัวของ yt-dlp เท่านั้น
            // ห้ามสั่ง aria2c กับ playlist และห้ามใช้ --download-sections
            // เพราะมันบังคับให้ ffmpeg เป็นตัวโหลด แล้ว ffmpeg ปฏิเสธ segment ที่ไม่มีนามสกุล
            a.Add("--concurrent-fragments"); a.Add(ch.ToString());
        }
        else
        {
            a.Add("--downloader"); a.Add(ctx.Paths.Aria2c);
            a.Add("--downloader-args");
            a.Add($"aria2c:-x{ch} -s{ch} -k1M --file-allocation=none --summary-interval=1");
        }

        // ---- header ----
        // ถ้า playlist กับไฟล์ย่อยต้องใช้ header คนละชุด engine จะดึง playlist เองแล้วส่งเป็นไฟล์มาที่นี่
        // ตอนนั้น url จะขึ้นต้นด้วย file:// และเราส่งแค่ referer อย่างเดียว
        var viaLocalPlaylist = url.StartsWith("file://", StringComparison.OrdinalIgnoreCase);
        if (viaLocalPlaylist) a.Add("--enable-file-urls");

        if (!string.IsNullOrWhiteSpace(s?.Referer))
        {
            a.Add("--referer"); a.Add(s!.Referer!);
        }
        if (s is not null && !viaLocalPlaylist)
        {
            foreach (var (k, v) in s.EffectiveHeaders.OrderBy(p => p.Key, StringComparer.Ordinal))
            {
                if (string.Equals(k, "Referer", StringComparison.OrdinalIgnoreCase)) continue;
                a.Add("--add-header"); a.Add($"{k}:{v}");
            }
        }

        // ---- cookie ----
        // ใช้ jar ของแอปเองเท่านั้น · ห้ามเพิ่ม --cookies-from-browser กลับมาเด็ดขาด
        if (!string.IsNullOrEmpty(ctx.CookieJar)) { a.Add("--cookies"); a.Add(ctx.CookieJar); }

        a.Add("--"); // กัน url ที่ขึ้นต้นด้วย - ถูกอ่านเป็นธง
        a.Add(url);
        return a;
    }

    /// <summary>เลือก format — playlist ที่แกะมาแล้วรับมาทั้งก้อน ส่วนหน้าเว็บให้เลือกดีที่สุดที่รวมเป็น mp4 ได้</summary>
    private static string FormatSelector(DownloadItem item)
    {
        if (item.Stream is { Kind: not StreamKind.Page }) return "best";
        return "bv*+ba/b";
    }

    private static string OutputTemplate(DownloadItem item)
    {
        // ถ้ารู้ชื่อแล้วใช้ชื่อนั้น ไม่งั้นให้ yt-dlp ตั้งเอง
        if (!string.IsNullOrWhiteSpace(item.Title))
            return SanitizeTemplate(item.Title) + ".%(ext)s";
        return "%(title)s [%(id)s].%(ext)s";
    }

    /// <summary>ตัดตัวอักษรที่ Windows ห้าม และ % ที่จะถูกอ่านเป็นตัวแปรของ yt-dlp</summary>
    public static string SanitizeTemplate(string name)
    {
        var bad = Path.GetInvalidFileNameChars().Concat(['%', '$']).ToHashSet();
        var cleaned = new string(name.Select(c => bad.Contains(c) ? '_' : c).ToArray()).Trim();
        if (cleaned.Length > 150) cleaned = cleaned[..150].Trim();
        return cleaned.Length == 0 ? "video" : cleaned;
    }
}
