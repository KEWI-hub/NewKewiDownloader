using System.IO.Compression;
using System.Text;
using NewKewi.Core;
using NewKewi.Core.Processes;
using NewKewi.Core.Tools;

namespace NewKewi.Tests;

/// <summary>ตัวโหลดปลอม · เทสจะได้ไม่ต้องดึงของจริงหลายร้อยเมกฯ ทุกครั้งที่รัน</summary>
public sealed class FakeDownloader : IDownloader
{
    /// <summary>url -> ตัวเขียนไฟล์ปลายทาง · ไม่มีใน map = โหลดไม่สำเร็จ</summary>
    public Dictionary<string, Action<string>> Responses { get; } = new(StringComparer.OrdinalIgnoreCase);

    public List<string> Requested { get; } = [];

    public Task<bool> GetFileAsync(string url, string targetFile, IProgress<string>? progress, CancellationToken ct)
    {
        Requested.Add(url);
        if (!Responses.TryGetValue(url, out var write)) return Task.FromResult(false);

        Directory.CreateDirectory(Path.GetDirectoryName(targetFile)!);
        write(targetFile);
        return Task.FromResult(true);
    }
}

public class ToolInstallerTests
{
    private const string YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

    private static AppPaths Sandbox()
    {
        var root = Path.Combine(Path.GetTempPath(), "newkewi-tools-" + Guid.NewGuid().ToString("n")[..8]);
        var paths = new AppPaths(root);
        paths.EnsureCreated();
        Directory.CreateDirectory(paths.Bin);
        return paths;
    }

    /// <summary>ไฟล์ขนาดตามต้องการแบบไม่ต้องเขียนข้อมูลจริงทั้งก้อน</summary>
    private static void FakeBinary(string path, long bytes)
    {
        using var fs = File.Create(path);
        fs.SetLength(bytes);
    }

    private static void PlaceAllBut(AppPaths paths, string missing)
    {
        foreach (var (file, size) in new (string, long)[]
                 {
                     ("yt-dlp.exe", 18_000_000), ("ffmpeg.exe", 90_000_000),
                     ("ffprobe.exe", 90_000_000), ("aria2c.exe", 5_000_000),
                 })
        {
            if (file.Equals(missing, StringComparison.OrdinalIgnoreCase)) continue;
            FakeBinary(Path.Combine(paths.Bin, file), size);
        }
    }

    [Fact]
    public async Task เครื่องมือครบอยู่แล้วก็ไม่โหลดอะไรเลย()
    {
        var paths = Sandbox();
        PlaceAllBut(paths, "ไม่ขาดอะไร");

        var downloader = new FakeDownloader();
        var result = await new ToolInstaller(paths, downloader)
            .EnsureAllAsync(null, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Empty(downloader.Requested);
        CleanUp(paths);
    }

    [Fact]
    public async Task ขาดตัวเดียวก็โหลดเฉพาะตัวนั้น()
    {
        var paths = Sandbox();
        PlaceAllBut(paths, "yt-dlp.exe");

        var downloader = new FakeDownloader();
        downloader.Responses[YtDlpUrl] = target => FakeBinary(target, 18_000_000);

        var result = await new ToolInstaller(paths, downloader)
            .EnsureAllAsync(null, CancellationToken.None);

        Assert.True(result.Ok, result.Message);
        Assert.Equal(1, result.Installed);
        Assert.Equal(YtDlpUrl, Assert.Single(downloader.Requested));
        Assert.True(File.Exists(paths.YtDlp));
        Assert.Empty(paths.MissingTools());
        CleanUp(paths);
    }

    [Fact]
    public async Task ไฟล์ที่ได้มาเล็กผิดปกติถูกทิ้ง_ไม่เก็บไว้ให้เข้าใจผิดว่ามีแล้ว()
    {
        var paths = Sandbox();
        PlaceAllBut(paths, "yt-dlp.exe");

        var downloader = new FakeDownloader();
        // ได้หน้า error ของเว็บมาแทนตัวโปรแกรม
        downloader.Responses[YtDlpUrl] = target => File.WriteAllText(target, "<html>404</html>");

        var result = await new ToolInstaller(paths, downloader)
            .EnsureAllAsync(null, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Contains("yt-dlp.exe", result.Message);
        Assert.False(File.Exists(paths.YtDlp), "ไฟล์เสียต้องถูกลบ ไม่ใช่ปล่อยไว้");
        CleanUp(paths);
    }

    [Fact]
    public async Task โหลดไม่สำเร็จก็บอกว่าตัวไหนพัง()
    {
        var paths = Sandbox();
        PlaceAllBut(paths, "yt-dlp.exe");

        var result = await new ToolInstaller(paths, new FakeDownloader())   // ไม่มี url ไหนตอบ
            .EnsureAllAsync(null, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Contains("yt-dlp", result.Message);
        CleanUp(paths);
    }

    [Fact]
    public async Task ไฟล์ที่รันไม่ขึ้นถูกทิ้งแม้ขนาดจะผ่าน()
    {
        var paths = Sandbox();
        PlaceAllBut(paths, "yt-dlp.exe");

        var downloader = new FakeDownloader();
        downloader.Responses[YtDlpUrl] = target => FakeBinary(target, 18_000_000);

        var runner = new FakeProcessRunner();
        runner.YtDlpStdErr = "รันไม่ขึ้น";   // ตัวปลอมทำให้ --version ล้มเหลว

        var result = await new ToolInstaller(paths, downloader, runner)
            .EnsureAllAsync(null, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.False(File.Exists(paths.YtDlp));
        CleanUp(paths);
    }

    [Fact]
    public async Task บอกขนาดที่ต้องโหลดก่อนเริ่มได้()
    {
        var paths = Sandbox();
        PlaceAllBut(paths, "ไม่ขาดอะไร");
        Assert.Equal(0, new ToolInstaller(paths, new FakeDownloader()).ApproximateMegabytes());

        File.Delete(paths.FFmpeg);
        Assert.True(new ToolInstaller(paths, new FakeDownloader()).ApproximateMegabytes() >= 80);

        CleanUp(paths);
        await Task.CompletedTask;
    }

    // ---- การแตก zip ----

    private static string MakeZip(string file, IEnumerable<(string Path, string Body)> entries)
    {
        using var stream = File.Create(file);
        using var zip = new ZipArchive(stream, ZipArchiveMode.Create);

        foreach (var (path, body) in entries)
        {
            var entry = zip.CreateEntry(path);
            using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
            writer.Write(body);
        }
        return file;
    }

    [Fact]
    public void แตกเฉพาะไฟล์ที่ต้องการออกจาก_zip()
    {
        var dir = Path.Combine(Path.GetTempPath(), "newkewi-zip-" + Guid.NewGuid().ToString("n")[..8]);
        Directory.CreateDirectory(dir);
        var target = Path.Combine(dir, "bin");

        var zip = MakeZip(Path.Combine(dir, "a.zip"),
        [
            ("ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe", "ของจริง"),
            ("ffmpeg-master-latest-win64-gpl/bin/ffprobe.exe", "ของจริง"),
            ("ffmpeg-master-latest-win64-gpl/bin/ffplay.exe", "ไม่เอา"),
            ("ffmpeg-master-latest-win64-gpl/README.txt", "ไม่เอา"),
        ]);

        var written = ToolInstaller.Extract(zip, ["ffmpeg.exe", "ffprobe.exe"], target);

        Assert.Equal(2, written);
        Assert.True(File.Exists(Path.Combine(target, "ffmpeg.exe")));
        Assert.True(File.Exists(Path.Combine(target, "ffprobe.exe")));
        Assert.False(File.Exists(Path.Combine(target, "ffplay.exe")));

        Directory.Delete(dir, recursive: true);
    }

    [Fact]
    public void zip_ที่พยายามเขียนออกนอกโฟลเดอร์ทำไม่ได้()
    {
        var dir = Path.Combine(Path.GetTempPath(), "newkewi-zip-" + Guid.NewGuid().ToString("n")[..8]);
        Directory.CreateDirectory(dir);
        var target = Path.Combine(dir, "bin");

        var zip = MakeZip(Path.Combine(dir, "evil.zip"),
        [
            ("../../../yt-dlp.exe", "โดนแฮก"),
            ("ok/yt-dlp.exe", "ของจริง"),
        ]);

        var written = ToolInstaller.Extract(zip, ["yt-dlp.exe"], target);

        // ชื่อไฟล์ถูกดึงออกมาจาก path แล้วประกอบใหม่ใน bin เสมอ จึงออกนอกไม่ได้
        Assert.Equal(1, written);
        Assert.True(File.Exists(Path.Combine(target, "yt-dlp.exe")));
        Assert.False(File.Exists(Path.Combine(dir, "yt-dlp.exe")));
        Assert.Equal("ของจริง", File.ReadAllText(Path.Combine(target, "yt-dlp.exe")));

        Directory.Delete(dir, recursive: true);
    }

    private static void CleanUp(AppPaths paths)
    {
        try { Directory.Delete(paths.Root, recursive: true); } catch { /* ช่างมัน */ }
    }
}
