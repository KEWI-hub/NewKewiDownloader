using NewKewi.Core.Engine;
using NewKewi.Core.Models;

namespace NewKewi.Tests;

/// <summary>
/// เทสทุกข้อในไฟล์นี้เรียก <see cref="DownloadEngine.RunAsync"/>
/// ซึ่งเป็นทางเดียวกับตอนผู้ใช้กดโหลดจริง ไม่มีข้อไหนเรียกตัวปั้น args หรือ remuxer ตรงๆ
/// </summary>
public class EngineTests
{
    private static DownloadItem NewItem(TempApp app, MediaStream? stream = null, string title = "คลิปทดสอบ")
        => new()
        {
            SourceUrl = "https://example.com/watch/1",
            Title = title,
            OutputDirectory = app.Output,
            Stream = stream,
        };

    [Fact]
    public async Task โหลดสำเร็จแล้วได้สถานะเสร็จพร้อมไฟล์ปลายทาง()
    {
        using var app = new TempApp();
        var item = NewItem(app);
        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.mp4");

        await app.Engine().RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Done, item.Status);
        Assert.Equal(app.Runner.ProducedFile, item.OutputFile);
        Assert.Equal(100, item.Progress);
        Assert.Null(item.FailureReason);
    }

    [Fact]
    public async Task ล้มเหลวแล้วไม่ลองใหม่เอง_เรียก_ytdlp_ครั้งเดียวเท่านั้น()
    {
        using var app = new TempApp();
        var item = NewItem(app);
        app.Runner.YtDlpStdErr = "ERROR: Unsupported URL: https://example.com/watch/1";

        await app.Engine().RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Failed, item.Status);
        var ytdlpCalls = app.Runner.Calls.Count(c => c.FileName.EndsWith("yt-dlp.exe"));
        Assert.Equal(1, ytdlpCalls);
    }

    [Theory]
    [InlineData("ERROR: Unsupported URL: x", "config")]
    [InlineData("ERROR: unable to download: HTTP Error 416: Requested Range Not Satisfiable", "ซากไฟล์")]
    [InlineData("ERROR: HTTP Error 503: Service Unavailable", "เซิร์ฟเวอร์")]
    [InlineData("ERROR: you need to pass --impersonate", "กันบอท")]
    [InlineData("ERROR: HTTP Error 404: Not Found", "ถูกลบ")]
    public async Task เหตุผลที่ล้มเหลวเป็นภาษาไทยที่อ่านรู้เรื่อง(string stderr, string ต้องมีคำว่า)
    {
        using var app = new TempApp();
        var item = NewItem(app);
        app.Runner.YtDlpStdErr = stderr;

        await app.Engine().RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Failed, item.Status);
        Assert.Contains(ต้องมีคำว่า, item.FailureReason);
    }

    [Fact]
    public async Task ไฟล์ที่ไม่ใช่_mp4_ถูกแปลงเป็น_mp4_ด้วยการ_copy()
    {
        using var app = new TempApp();
        var item = NewItem(app);
        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.mkv");
        app.Runner.ProbeFormat = "matroska,webm";

        await app.Engine().RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Done, item.Status);
        Assert.EndsWith(".mp4", item.OutputFile);
        Assert.True(File.Exists(item.OutputFile));

        // ขั้นแรกต้องเป็นการ copy ไม่ใช่ encode ใหม่
        var first = app.Runner.FFmpegCalls[0];
        Assert.Contains("copy", first);
        Assert.DoesNotContain("libx264", first);
    }

    [Fact]
    public async Task copy_ไม่ผ่านแล้วถอยไปแปลงเสียงก่อน_แล้วค่อยแปลงภาพ()
    {
        using var app = new TempApp();
        var item = NewItem(app);
        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.webm");
        app.Runner.ProbeFormat = "matroska,webm";
        app.Runner.ProbeVideoCodec = "vp9";
        app.Runner.ProbeAudioCodec = "opus";
        app.Runner.FFmpegFailuresBeforeSuccess = 2;   // ให้ 2 ขั้นแรกพัง

        await app.Engine().RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Done, item.Status);
        Assert.Equal(3, app.Runner.FFmpegCalls.Count);
        Assert.Contains("aac", app.Runner.FFmpegCalls[1]);      // ขั้น 2 แปลงเฉพาะเสียง
        Assert.Contains("libx264", app.Runner.FFmpegCalls[2]);  // ขั้น 3 แปลงภาพ
    }

    [Fact]
    public async Task ห้ามแปลงเป็น_h265_ไม่ว่ากรณีไหน()
    {
        using var app = new TempApp();
        var item = NewItem(app);
        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.webm");
        app.Runner.ProbeFormat = "matroska,webm";
        app.Runner.FFmpegFailuresBeforeSuccess = 2;

        await app.Engine().RunAsync(item, CancellationToken.None);

        foreach (var call in app.Runner.FFmpegCalls)
        {
            Assert.DoesNotContain("libx265", call);
            Assert.DoesNotContain("hevc_nvenc", call);
        }
    }

    [Fact]
    public async Task ซากไฟล์_part_ของรอบก่อนถูกลบก่อนเริ่ม()
    {
        using var app = new TempApp();
        var item = NewItem(app);
        var temp = app.Paths.TempFor(item.Id);
        Directory.CreateDirectory(temp);
        var stale = Path.Combine(temp, "เก่า.mp4.part");
        File.WriteAllText(stale, "ซากจากรอบก่อน");

        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.mp4");
        await app.Engine().RunAsync(item, CancellationToken.None);

        Assert.False(File.Exists(stale));
    }

    [Fact]
    public async Task มีไฟล์อยู่แล้วให้ข้าม_แต่ตั้ง_Force_แล้วต้องโหลด()
    {
        using var app = new TempApp();
        File.WriteAllText(Path.Combine(app.Output, "คลิปทดสอบ.mp4"), "ของเก่า");

        var skipped = NewItem(app);
        await app.Engine().RunAsync(skipped, CancellationToken.None);
        Assert.Equal(DownloadStatus.Skipped, skipped.Status);
        Assert.Empty(app.Runner.Calls);

        var forced = NewItem(app);
        forced.Force = true;
        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.mp4");
        await app.Engine().RunAsync(forced, CancellationToken.None);
        Assert.Equal(DownloadStatus.Done, forced.Status);
    }

    [Fact]
    public async Task ขาดเครื่องมือใน_bin_แล้วบอกชื่อที่ขาด()
    {
        using var app = new TempApp();
        File.Delete(app.Paths.FFmpeg);

        var item = NewItem(app);
        await app.Engine().RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Failed, item.Status);
        Assert.Contains("ffmpeg.exe", item.FailureReason);
    }

    [Fact]
    public async Task ความคืบหน้าถูกอ่านจากบรรทัดที่เราสั่งให้พิมพ์เอง()
    {
        using var app = new TempApp();
        var item = NewItem(app);
        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.mp4");
        app.Runner.ProgressLines.Add("NKPROG|52428800|104857600|NA|8388608|6");

        await app.Engine().RunAsync(item, CancellationToken.None);

        Assert.Equal(104857600, item.TotalBytes);
        Assert.Equal(52428800, item.DownloadedBytes);
    }

    // ---- args ที่ส่งให้ yt-dlp จริง — ตรวจผ่านทางเดินปกติ ไม่ได้เรียกตัวปั้น args ตรงๆ ----

    private static async Task<List<string>> ArgsFor(TempApp app, DownloadItem item)
    {
        app.Runner.ProducedFile ??= Path.Combine(app.Output, "คลิปทดสอบ.mp4");
        await app.Engine().RunAsync(item, CancellationToken.None);
        return app.Runner.Calls.First(c => c.FileName.EndsWith("yt-dlp.exe")).Arguments.ToList();
    }

    [Fact]
    public async Task playlist_ใช้_concurrent_fragments_และห้ามใช้_aria2c()
    {
        using var app = new TempApp();
        var item = NewItem(app, new MediaStream { Url = "https://cdn/x/master.m3u8", Kind = StreamKind.Hls });

        var args = await ArgsFor(app, item);

        Assert.Contains("--concurrent-fragments", args);
        Assert.Equal(app.Settings.ChannelsPerDownload.ToString(), args[args.IndexOf("--concurrent-fragments") + 1]);
        Assert.DoesNotContain("--downloader", args);          // ห้าม aria2c กับ playlist
        Assert.DoesNotContain("--download-sections", args);   // ทำให้ ffmpeg เป็นตัวโหลดแล้วพังกับ segment ไม่มีนามสกุล
    }

    [Fact]
    public async Task ไฟล์เดี่ยวใช้_aria2c_แตกหลายช่อง()
    {
        using var app = new TempApp();
        var item = NewItem(app, new MediaStream { Url = "https://cdn/x/video.mp4", Kind = StreamKind.File });

        var args = await ArgsFor(app, item);

        Assert.Contains("--downloader", args);
        Assert.Contains(args, a => a.Contains("aria2c:-x8 -s8"));
        Assert.DoesNotContain("--concurrent-fragments", args);
    }

    [Fact]
    public async Task ห้ามมี_cookies_from_browser_เด็ดขาด()
    {
        using var app = new TempApp();
        var args = await ArgsFor(app, NewItem(app));

        Assert.DoesNotContain(args, a => a.Contains("cookies-from-browser"));
    }

    [Fact]
    public void playlist_ที่ต้องใช้_header_คนละชุดถูกมองว่าต้องแยก()
    {
        var stream = new MediaStream
        {
            Url = "https://player/master.txt",
            Kind = StreamKind.Hls,
            PlaylistHeaders = { ["Origin"] = "https://av-th.xyz" },
            SegmentHeaders = { },
        };
        Assert.True(stream.NeedsSplitHeaders);

        var same = new MediaStream { Url = "x", Kind = StreamKind.Hls };
        Assert.False(same.NeedsSplitHeaders);
    }

    [Fact]
    public async Task playlist_ที่เขียนเองส่งเป็น_file_url_พร้อมธงที่ต้องมี()
    {
        using var app = new TempApp();
        var local = Path.Combine(app.Paths.Temp, "master.m3u8");
        Directory.CreateDirectory(app.Paths.Temp);
        File.WriteAllText(local, "#EXTM3U");

        var item = NewItem(app, new MediaStream
        {
            Url = "file:///" + local.Replace('\\', '/'),
            Kind = StreamKind.Hls,
            Referer = "https://av-th.io/",
            PlaylistHeaders = { ["Origin"] = "https://av-th.xyz" },
        });

        var args = await ArgsFor(app, item);

        Assert.Contains("--enable-file-urls", args);
        Assert.Contains("--referer", args);
        Assert.Equal("https://av-th.io/", args[args.IndexOf("--referer") + 1]);
        // ส่ง referer อย่างเดียว ไม่ยัด Origin ไปด้วย เพราะไฟล์ย่อยจะโดน 500
        Assert.DoesNotContain(args, a => a.StartsWith("Origin:"));
    }

    [Fact]
    public async Task ตั้ง_merge_output_format_เป็น_mp4_ตั้งแต่ต้น()
    {
        using var app = new TempApp();
        var args = await ArgsFor(app, NewItem(app));

        Assert.Contains("--merge-output-format", args);
        Assert.Equal("mp4", args[args.IndexOf("--merge-output-format") + 1]);
    }

    [Fact]
    public async Task ไม่มี_retry_ระดับงาน_ใน_args()
    {
        using var app = new TempApp();
        var args = await ArgsFor(app, NewItem(app));

        Assert.Equal("0", args[args.IndexOf("--retries") + 1]);
        Assert.Equal("0", args[args.IndexOf("--extractor-retries") + 1]);
    }
}
