using NewKewi.Core;
using NewKewi.Core.Engine;
using NewKewi.Core.Models;
using NewKewi.Core.Processes;
using NewKewi.Core.Settings;

namespace NewKewi.Tests;

/// <summary>
/// เทสที่ยิงเน็ตจริงด้วย yt-dlp/ffmpeg ตัวจริง
/// ไม่รันในชุดปกติ (เน็ตช้าหรือเว็บล่มจะ fail แบบหลอกๆ) — สั่งเองด้วย:
///   dotnet test --filter "Category=live"
/// </summary>
[Trait("Category", "live")]
public class LiveDownloadTests
{
    /// <summary>
    /// โฟลเดอร์ชั่วคราวที่มี bin/ จริงก๊อปเข้าไป — ยิงเน็ตจริงได้
    /// แต่ไม่มีทางไปเขียนทับ data/ หรือ queue.json ของผู้ใช้
    /// </summary>
    private static (AppPaths paths, string outDir) Sandbox()
    {
        var repo = AppPaths.ForRunningApp();
        var root = Path.Combine(Path.GetTempPath(), "newkewi-live-" + Guid.NewGuid().ToString("n")[..8]);
        var paths = new AppPaths(root);
        paths.EnsureCreated();
        Directory.CreateDirectory(paths.Bin);
        foreach (var f in Directory.EnumerateFiles(repo.Bin, "*.exe"))
            File.Copy(f, Path.Combine(paths.Bin, Path.GetFileName(f)), overwrite: true);

        var outDir = Path.Combine(root, "out");
        Directory.CreateDirectory(outDir);
        return (paths, outDir);
    }

    [Fact]
    public async Task โหลดไฟล์_mp4_ตรงๆ_ด้วย_aria2c_ได้จริง()
    {
        var (paths, outDir) = Sandbox();
        var settings = new AppSettings { DownloadDirectory = outDir, ChannelsPerDownload = 4 }.Normalized();

        var item = new DownloadItem
        {
            SourceUrl = "https://www.w3schools.com/html/mov_bbb.mp4",
            Title = "live-direct-mp4",
            OutputDirectory = outDir,
            Force = true,
        };

        var engine = new DownloadEngine(paths, settings, new ProcessRunner());
        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(3));
        await engine.RunAsync(item, cts.Token);

        Assert.True(item.Status == DownloadStatus.Done,
            $"สถานะ={item.Status} เหตุผล={item.FailureReason}");
        Assert.EndsWith(".mp4", item.OutputFile);
        Assert.True(new FileInfo(item.OutputFile!).Length > 10_000);

        Directory.Delete(paths.Root, recursive: true);
    }

    [Fact]
    public async Task โหลด_HLS_ด้วย_concurrent_fragments_แล้วได้_mp4()
    {
        var (paths, outDir) = Sandbox();
        var settings = new AppSettings { DownloadDirectory = outDir, ChannelsPerDownload = 8 }.Normalized();

        var item = new DownloadItem
        {
            SourceUrl = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
            Title = "live-hls",
            OutputDirectory = outDir,
            Force = true,
            Stream = new MediaStream
            {
                Url = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
                Kind = StreamKind.Hls,
                Height = 360,
            },
        };

        var engine = new DownloadEngine(paths, settings, new ProcessRunner());
        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
        await engine.RunAsync(item, cts.Token);

        Assert.True(item.Status == DownloadStatus.Done,
            $"สถานะ={item.Status} เหตุผล={item.FailureReason}");
        Assert.EndsWith(".mp4", item.OutputFile);

        Directory.Delete(paths.Root, recursive: true);
    }
}
