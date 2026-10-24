using NewKewi.Core;
using NewKewi.Core.Engine;
using NewKewi.Core.Models;
using NewKewi.Core.Queue;
using NewKewi.Core.Settings;

namespace NewKewi.Tests;

public class ProgressParserTests
{
    [Fact]
    public void อ่านค่าปกติได้ครบ()
    {
        Assert.True(ProgressParser.TryParse("NKPROG|500|1000|NA|250|2", out var p));
        Assert.Equal(500, p.DownloadedBytes);
        Assert.Equal(1000, p.TotalBytes);
        Assert.Equal(250, p.SpeedBytesPerSecond);
        Assert.Equal(2, p.EtaSeconds);
        Assert.Equal(50, p.Percent);
    }

    [Fact]
    public void total_เป็น_NA_แล้วถอยไปใช้ค่าประมาณ()
    {
        Assert.True(ProgressParser.TryParse("NKPROG|500|NA|2000|NA|NA", out var p));
        Assert.Equal(2000, p.TotalBytes);
        Assert.Equal(25, p.Percent);
        Assert.Equal(0, p.SpeedBytesPerSecond);
    }

    [Theory]
    [InlineData("[download]  42.0% of 1.00GiB at 8.00MiB/s ETA 02:10")]
    [InlineData("")]
    [InlineData("NKPROG|500")]
    public void บรรทัดที่ไม่ใช่รูปแบบของเราถูกมองข้าม(string line)
        => Assert.False(ProgressParser.TryParse(line, out _));

    [Fact]
    public void ไม่มีขนาดรวมแล้วเปอร์เซ็นต์เป็นศูนย์_ไม่ใช่หารด้วยศูนย์()
    {
        Assert.True(ProgressParser.TryParse("NKPROG|500|NA|NA|NA|NA", out var p));
        Assert.Equal(0, p.Percent);
    }
}

public class ErrorClassifierTests
{
    [Theory]
    [InlineData("ERROR: Unsupported URL: https://x", FailureKind.UnsupportedSite)]
    [InlineData("HTTP Error 416: Requested Range Not Satisfiable", FailureKind.StalePartial)]
    [InlineData("Use --impersonate chrome", FailureKind.BotWall)]
    [InlineData("Sign in to confirm you're not a bot", FailureKind.NeedsAuth)]
    [InlineData("Video unavailable", FailureKind.Gone)]
    [InlineData("HTTP Error 522:", FailureKind.ServerDown)]
    [InlineData("The link has expired", FailureKind.Expired)]
    [InlineData("Read operation timed out", FailureKind.Network)]
    [InlineData("No space left on device", FailureKind.Disk)]
    public void จับประเภทได้ถูกตามตาราง(string stderr, FailureKind kind)
        => Assert.Equal(kind, ErrorClassifier.Classify(stderr).Kind);

    [Fact]
    public void ข้อความที่ไม่รู้จักยังคืนบรรทัดสุดท้ายให้ไล่ปัญหาต่อได้()
    {
        var f = ErrorClassifier.Classify("WARNING: อะไรสักอย่าง\nERROR: เรื่องแปลกใหม่");
        Assert.Equal(FailureKind.Unknown, f.Kind);
        Assert.Contains("เรื่องแปลกใหม่", f.Message);
    }

    [Fact]
    public void ประเภทที่ควรถอยไปอ่านหน้าเว็บเองถูกทำเครื่องหมายไว้()
    {
        Assert.True(ErrorClassifier.Classify("Unsupported URL").WorthFallingBack);
        Assert.True(ErrorClassifier.Classify("--impersonate").WorthFallingBack);
        Assert.False(ErrorClassifier.Classify("No space left on device").WorthFallingBack);
    }
}

public class QueueTests
{
    private static (DownloadQueue queue, TempApp app) Make(int parallel = 2)
    {
        var app = new TempApp();
        app.Settings.MaxParallelDownloads = parallel;
        var q = new DownloadQueue(app.Paths, app.Settings, app.Engine());
        return (q, app);
    }

    [Fact]
    public void งานที่ล้มเหลวยังเป็นล้มเหลวหลังปิดเปิดแอป()
    {
        var (q, app) = Make();
        using var _ = app;

        var item = q.Add("https://example.com/1", "คลิป");
        item.Fail("เซิร์ฟเวอร์ต้นทางล่ม");
        q.Save();

        var reopened = new DownloadQueue(app.Paths, app.Settings, app.Engine());
        reopened.Load();

        var loaded = Assert.Single(reopened.Items);
        Assert.Equal(DownloadStatus.Failed, loaded.Status);
        Assert.Equal("เซิร์ฟเวอร์ต้นทางล่ม", loaded.FailureReason);
    }

    [Fact]
    public void งานที่ค้างกลางทางตอนปิดแอปกลับมาเป็นหยุดพัก_ไม่ใช่รอโหลด()
    {
        var (q, app) = Make();
        using var _ = app;

        var item = q.Add("https://example.com/1");
        item.Status = DownloadStatus.Downloading;
        q.Save();

        var reopened = new DownloadQueue(app.Paths, app.Settings, app.Engine());
        reopened.Load();

        Assert.Equal(DownloadStatus.Paused, reopened.Items[0].Status);
    }

    [Fact]
    public void งานที่ล้มเหลวจะกลับเข้าคิวได้ก็ต่อเมื่อผู้ใช้สั่งเอง()
    {
        var (q, app) = Make();
        using var _ = app;

        var item = q.Add("https://example.com/1");
        item.Fail("อะไรสักอย่าง");

        q.Pump();   // คิวเดินเองไม่หยิบของที่ fail ขึ้นมา
        Assert.Equal(DownloadStatus.Failed, item.Status);

        q.Retry(item);
        Assert.Null(item.FailureReason);
        Assert.Equal(0, item.Progress);
    }

    [Fact]
    public async Task โหลดหลายลิงก์พร้อมกันไม่เกินที่ตั้งไว้()
    {
        var (q, app) = Make(parallel: 2);
        using var _ = app;

        for (var i = 0; i < 5; i++)
        {
            var it = q.Add($"https://example.com/{i}", $"คลิป{i}");
            it.Force = true;
        }
        app.Runner.ProducedFile = Path.Combine(app.Output, "ได้ไฟล์.mp4");

        q.Start();
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (q.Items.Any(i => !i.IsFinished) && DateTime.UtcNow < deadline)
            await Task.Delay(50);

        Assert.All(q.Items, i => Assert.Equal(DownloadStatus.Done, i.Status));
    }

    [Fact]
    public void queue_json_เขียนแบบไม่มี_BOM()
    {
        var (q, app) = Make();
        using var _ = app;

        q.Add("https://example.com/1", "คลิปภาษาไทย");
        q.Save();

        var bytes = File.ReadAllBytes(app.Paths.QueueFile);
        Assert.False(bytes is [0xEF, 0xBB, 0xBF, ..], "ไฟล์ติด BOM — ตัวอ่านจะพังเงียบๆ แล้วได้คิวว่าง");
        Assert.Contains("คลิปภาษาไทย", File.ReadAllText(app.Paths.QueueFile));
    }

    [Fact]
    public void ไฟล์คิวพังแล้วได้คิวว่างพร้อมเหตุผล_ไม่ใช่แอปเปิดไม่ขึ้น()
    {
        using var app = new TempApp();
        Directory.CreateDirectory(app.Paths.Data);
        File.WriteAllText(app.Paths.QueueFile, "{ นี่ไม่ใช่ json");

        var items = new QueueStore(app.Paths).Load(out var error);

        Assert.Empty(items);
        Assert.NotNull(error);
    }
}

public class SettingsTests
{
    [Fact]
    public void ค่าที่ผู้ใช้แก้จนเพี้ยนถูกดึงกลับเข้าช่วง()
    {
        var s = new AppSettings { MaxParallelDownloads = 999, ChannelsPerDownload = 0 }.Normalized();
        Assert.Equal(16, s.MaxParallelDownloads);
        Assert.Equal(1, s.ChannelsPerDownload);
    }

    [Fact]
    public void เซฟแล้วอ่านกลับได้ค่าเดิม()
    {
        using var app = new TempApp();
        var store = new SettingsStore(app.Paths);
        store.Save(new AppSettings { MaxParallelDownloads = 5, DownloadDirectory = @"D:\หนัง" });

        var back = store.Load();
        Assert.Equal(5, back.MaxParallelDownloads);
        Assert.Equal(@"D:\หนัง", back.DownloadDirectory);
    }
}
