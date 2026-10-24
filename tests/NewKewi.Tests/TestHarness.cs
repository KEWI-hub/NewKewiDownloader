using System.Text;
using NewKewi.Core;
using NewKewi.Core.Engine;
using NewKewi.Core.Processes;
using NewKewi.Core.Settings;

namespace NewKewi.Tests;

/// <summary>
/// ตัวแทนโปรแกรมภายนอกสำหรับเทส
///
/// **ต้องตอบได้ทั้งสำเร็จและล้มเหลว** — ถ้าคืน exit 0 ตลอด ทางที่เดินตอนพังจะไม่เคยถูกเทสเลย
/// (บทเรียนตอนทำ v1.6.4 ของแอปเก่า)
/// </summary>
public sealed class FakeProcessRunner : IProcessRunner
{
    public List<ProcessRequest> Calls { get; } = [];

    /// <summary>ให้ yt-dlp ล้มเหลวพร้อมข้อความนี้ · null = สำเร็จ</summary>
    public string? YtDlpStdErr { get; set; }
    public int YtDlpExitCode { get; set; }

    /// <summary>บรรทัดความคืบหน้าที่จะพ่นออกมาตอนรัน yt-dlp</summary>
    public List<string> ProgressLines { get; } = [];

    /// <summary>ไฟล์ที่ yt-dlp "โหลดมาได้" — ตัวปลอมจะสร้างไฟล์นี้จริงแล้วเขียน path ลง result file</summary>
    public string? ProducedFile { get; set; }

    /// <summary>ffprobe จะบอกว่าไฟล์เป็นกล่องอะไร</summary>
    public string ProbeFormat { get; set; } = "mov,mp4,m4a,3gp,3g2,mj2";
    public string ProbeVideoCodec { get; set; } = "h264";
    public string ProbeAudioCodec { get; set; } = "aac";

    /// <summary>ให้ ffmpeg ล้มเหลวกี่ครั้งแรก (ใช้เทสการถอยไปขั้นถัดไป)</summary>
    public int FFmpegFailuresBeforeSuccess { get; set; }
    public List<IReadOnlyList<string>> FFmpegCalls { get; } = [];

    public Task<ProcessResult> RunAsync(ProcessRequest request, Action<string>? onStdOutLine, CancellationToken ct)
    {
        Calls.Add(request);
        var exe = Path.GetFileNameWithoutExtension(request.FileName).ToLowerInvariant();
        return Task.FromResult(exe switch
        {
            "yt-dlp" => RunYtDlp(request, onStdOutLine),
            "ffprobe" => RunFFprobe(),
            "ffmpeg" => RunFFmpeg(request),
            _ => new ProcessResult(0, "", ""),
        });
    }

    private ProcessResult RunYtDlp(ProcessRequest req, Action<string>? onLine)
    {
        foreach (var l in ProgressLines) onLine?.Invoke(l);

        if (YtDlpStdErr is not null)
            return new ProcessResult(YtDlpExitCode == 0 ? 1 : YtDlpExitCode, "", YtDlpStdErr);

        if (ProducedFile is not null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ProducedFile)!);
            if (!File.Exists(ProducedFile)) File.WriteAllText(ProducedFile, "ไฟล์วิดีโอปลอม");

            var resultFile = ArgAfter(req, "--print-to-file", skip: 1);
            if (resultFile is not null)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(resultFile)!);
                File.WriteAllText(resultFile, ProducedFile + "\n", new UTF8Encoding(false));
            }
        }
        return new ProcessResult(0, "", "");
    }

    private ProcessResult RunFFprobe() => new(0, $$"""
        {
          "format": { "format_name": "{{ProbeFormat}}" },
          "streams": [
            { "codec_type": "video", "codec_name": "{{ProbeVideoCodec}}" },
            { "codec_type": "audio", "codec_name": "{{ProbeAudioCodec}}" }
          ]
        }
        """, "");

    private ProcessResult RunFFmpeg(ProcessRequest req)
    {
        FFmpegCalls.Add(req.Arguments);
        if (FFmpegCalls.Count <= FFmpegFailuresBeforeSuccess)
            return new ProcessResult(1, "", "ffmpeg ปลอมสั่งให้ล้มเหลว");

        var output = req.Arguments[^1];
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        File.WriteAllText(output, "ไฟล์ mp4 ปลอม");
        return new ProcessResult(0, "", "");
    }

    private static string? ArgAfter(ProcessRequest req, string flag, int skip = 0)
    {
        for (var i = 0; i < req.Arguments.Count; i++)
            if (req.Arguments[i] == flag && i + 1 + skip < req.Arguments.Count)
                return req.Arguments[i + 1 + skip];
        return null;
    }
}

/// <summary>โฟลเดอร์ชั่วคราวที่มี bin/ ปลอมครบ · เทสไม่มีทางไปแตะโฟลเดอร์จริงของผู้ใช้</summary>
public sealed class TempApp : IDisposable
{
    public TempApp()
    {
        Root = Path.Combine(Path.GetTempPath(), "newkewi-test-" + Guid.NewGuid().ToString("n")[..8]);
        Paths = new AppPaths(Root);
        Paths.EnsureCreated();
        Directory.CreateDirectory(Paths.Bin);
        foreach (var t in new[] { Paths.YtDlp, Paths.FFmpeg, Paths.FFprobe, Paths.Aria2c })
            File.WriteAllText(t, "");

        Output = Path.Combine(Root, "out");
        Directory.CreateDirectory(Output);

        Settings = new AppSettings { DownloadDirectory = Output }.Normalized();
        Runner = new FakeProcessRunner();
    }

    public string Root { get; }
    public string Output { get; }
    public AppPaths Paths { get; }
    public AppSettings Settings { get; }
    public FakeProcessRunner Runner { get; }

    public DownloadEngine Engine() => new(Paths, Settings, Runner);

    public void Dispose()
    {
        try { Directory.Delete(Root, recursive: true); } catch { /* ลบไม่ได้ก็ช่าง */ }
    }
}
