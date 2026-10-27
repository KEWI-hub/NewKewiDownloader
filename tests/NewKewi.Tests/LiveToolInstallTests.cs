using NewKewi.Core;
using NewKewi.Core.Processes;
using NewKewi.Core.Tools;

namespace NewKewi.Tests;

/// <summary>
/// โหลดเครื่องมือจาก URL จริง ~106 MB
///
/// ไม่รันในชุดปกติ · มีไว้ยืนยันว่า URL ต้นทางยังใช้ได้และโครงของไฟล์ zip ยังเหมือนเดิม
/// (ของพวกนี้เป็น release ของโปรเจกต์อื่น ย้ายที่หรือเปลี่ยนโครงเมื่อไรก็ได้)
/// </summary>
[Trait("Category", "live")]
public class LiveToolInstallTests
{
    [Fact]
    public async Task โหลดเครื่องมือครบทั้งสี่ตัวจาก_url_จริงแล้วรันได้()
    {
        var root = Path.Combine(Path.GetTempPath(), "newkewi-livetools-" + Guid.NewGuid().ToString("n")[..8]);
        var paths = new AppPaths(root);
        paths.EnsureCreated();

        using var downloader = new HttpDownloader();
        var installer = new ToolInstaller(paths, downloader, new ProcessRunner());

        Assert.Equal(4, installer.Missing().Count);
        Assert.True(installer.ApproximateMegabytes() > 50);

        var steps = new List<string>();
        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(20));

        try
        {
            var result = await installer.EnsureAllAsync(
                new Progress<string>(s => steps.Add(s)), cts.Token);

            Assert.True(result.Ok, result.Message + " · ทางที่เดินมา: " + string.Join(" → ", steps.TakeLast(5)));
            Assert.Equal(4, result.Installed);

            // VerifyAsync สั่ง --version ให้แล้ว ตรงนี้แค่ยืนยันว่าไฟล์อยู่ครบจริง
            Assert.Empty(paths.MissingTools());
            foreach (var tool in new[] { paths.YtDlp, paths.FFmpeg, paths.FFprobe, paths.Aria2c })
            {
                Assert.True(new FileInfo(tool).Length > 1_000_000, $"{Path.GetFileName(tool)} เล็กผิดปกติ");
            }

            // รอบสองต้องรู้ว่ามีครบแล้วและไม่โหลดซ้ำ
            var again = await installer.EnsureAllAsync(null, cts.Token);
            Assert.True(again.Ok);
            Assert.Equal(0, again.Installed);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { /* ช่างมัน */ }
        }
    }
}
