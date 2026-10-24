using NewKewi.Core.Engine;
using NewKewi.Core.Models;
using NewKewi.Sites;
using NewKewi.Sites.Browser;

namespace NewKewi.Tests;

/// <summary>เบราว์เซอร์ปลอม · เทสทุกข้อจะได้ไม่ต้องเปิด Chromium จริง</summary>
public sealed class FakeBrowser : IBrowser
{
    public bool IsReady { get; set; } = true;
    public Dictionary<string, string> Pages { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<CapturedRequest> Requests { get; } = [];
    public List<(string Url, BrowseMode Mode)> Opened { get; } = [];

    public Task<BrowsePage> OpenAsync(string url, BrowseMode mode, int waitSeconds, CancellationToken ct)
    {
        Opened.Add((url, mode));
        var html = Pages.TryGetValue(url, out var h) ? h : "";
        return Task.FromResult(new BrowsePage(html, url, Requests));
    }
}

public class MediaScannerTests
{
    [Fact]
    public void เจอ_m3u8_และ_mp4_ในหน้า()
    {
        const string Html = """
            <video></video>
            <script>var s = "https://cdn.example.com/a/master.m3u8?t=1";</script>
            <a href="https://cdn.example.com/a/clip.mp4">โหลด</a>
            """;

        var found = MediaScanner.FindMedia(Html, "https://site.example/");

        Assert.Contains(found, f => f.Url.Contains("master.m3u8") && f.Kind == StreamKind.Hls);
        Assert.Contains(found, f => f.Url.Contains("clip.mp4") && f.Kind == StreamKind.File);
        Assert.Equal(StreamKind.Hls, found[0].Kind);   // playlist มาก่อนไฟล์เดี่ยวเสมอ
    }

    [Fact]
    public void ลิงก์ที่หนีด้วย_backslash_ใน_json_ถูกคลายก่อนสแกน()
    {
        const string Html = """{"hls":"https:\/\/cdn.example.com\/x\/index.m3u8"}""";

        var found = MediaScanner.FindMedia(Html, "https://site.example/");

        Assert.Equal("https://cdn.example.com/x/index.m3u8", found[0].Url);
    }

    [Fact]
    public void อ่านรูปแบบ_file_ของ_jwplayer_ได้()
    {
        const string Html = """ jwplayer("p").setup({ file: "https://cdn.example.com/v/720.mp4" }); """;

        Assert.Contains(MediaScanner.FindMedia(Html, "https://site.example/"),
            f => f.Url.EndsWith("720.mp4"));
    }

    [Fact]
    public void path_เปล่าถูกต่อกับ_url_ของหน้า()
    {
        const string Html = """ <script>var file = "/stream/abc/index.m3u8";</script> """;

        Assert.Equal("https://site.example/stream/abc/index.m3u8",
            MediaScanner.FindMedia(Html, "https://site.example/watch/1")[0].Url);
    }

    [Fact]
    public void iframe_โฆษณาถูกข้าม_เหลือแต่ของจริง()
    {
        const string Html = """
            <iframe src="https://googlesyndication.com/ads/x"></iframe>
            <iframe src="https://player.example.com/e/ABC"></iframe>
            <iframe src="about:blank"></iframe>
            """;

        var frames = MediaScanner.FindFrames(Html, "https://site.example/");

        Assert.Single(frames);
        Assert.Equal("https://player.example.com/e/ABC", frames[0]);
    }
}

public class MasterPlaylistTests
{
    private const string Master = """
        #EXTM3U
        #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
        360/index.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
        720/index.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080
        1080/index.m3u8
        """;

    [Fact]
    public void แตกความชัดออกมาครบและเรียงจากสูงไปต่ำ()
    {
        var v = MasterPlaylist.ParseVariants(Master, "https://cdn.example.com/x/master.m3u8");

        Assert.Equal(3, v.Count);
        Assert.Equal([1080, 720, 360], v.Select(x => x.Height));
        Assert.Equal("https://cdn.example.com/x/1080/index.m3u8", v[0].Url);
        Assert.Equal("1080p", v[0].Label);
    }

    [Fact]
    public void playlist_เดี่ยวไม่ใช่_master_จึงไม่มีความชัดให้เลือก()
    {
        const string Single = "#EXTM3U\n#EXTINF:4.0,\nseg1.ts\n";

        Assert.False(MasterPlaylist.LooksLikeMaster(Single));
        Assert.Empty(MasterPlaylist.ParseVariants(Single, "https://cdn/x.m3u8"));
    }
}

public class PageFetcherTests
{
    [Theory]
    [InlineData("<title>Just a moment...</title>", 200, true)]
    [InlineData("<div id=\"cf-browser-verification\"></div>", 200, true)]
    [InlineData("<html>ปกติดี</html>", 403, true)]
    [InlineData("<html>ปกติดี</html>", 200, false)]
    public void จับด่านกันบอทได้(string html, int status, bool expected)
        => Assert.Equal(expected, PageFetcher.LooksLikeBotWall(html, status));

    [Fact]
    public async Task เจอด่านกันบอทแล้วขยับไปใช้เบราว์เซอร์จริง()
    {
        var web = new FakeWebClient();
        web.Pages["https://site.example/x"] = "<title>Just a moment...</title>";

        var browser = new FakeBrowser();
        browser.Pages["https://site.example/x"] = "<html><h1>ผ่านด่านแล้ว</h1></html>";

        var result = await new PageFetcher(web, browser)
            .FetchAsync("https://site.example/x", allowVisible: false, CancellationToken.None);

        Assert.Equal(FetchLayer.Silent, result.Layer);
        Assert.Contains("ผ่านด่านแล้ว", result.Html);
    }

    [Fact]
    public async Task หน้าปกติจบที่ชั้นแรก_ไม่เปิดเบราว์เซอร์ให้เปลืองเวลา()
    {
        var web = new FakeWebClient();
        web.Pages["https://site.example/x"] = "<html>ปกติดี</html>";
        var browser = new FakeBrowser();

        var result = await new PageFetcher(web, browser)
            .FetchAsync("https://site.example/x", allowVisible: false, CancellationToken.None);

        Assert.Equal(FetchLayer.Simple, result.Layer);
        Assert.Empty(browser.Opened);
    }

    [Fact]
    public async Task ยังไม่ได้ติดตั้ง_chromium_ก็ไม่พัง_แค่ได้เท่าที่ชั้นแรกให้()
    {
        var web = new FakeWebClient();
        web.Pages["https://site.example/x"] = "<title>Just a moment...</title>";

        var result = await new PageFetcher(web, new FakeBrowser { IsReady = false })
            .FetchAsync("https://site.example/x", allowVisible: false, CancellationToken.None);

        Assert.Equal(FetchLayer.Simple, result.Layer);
    }
}

public class GenericResolverTests
{
    private static GenericResolver Make(FakeWebClient web, FakeBrowser browser)
        => new(new PageFetcher(web, browser), web, browser);

    [Fact]
    public void เจอ_m3u8_ในหน้าแรกก็จบ()
    {
        var web = new FakeWebClient();
        web.Pages["https://site.example/watch/1"] =
            """<h1>ชื่อคลิป</h1><script>var u="https://cdn/x/master.m3u8";</script>""";
        web.Pages["https://cdn/x/master.m3u8"] = "#EXTM3U\n#EXTINF:4,\nseg.ts\n";

        var r = Make(web, new FakeBrowser()).Resolve("https://site.example/watch/1", CancellationToken.None);

        Assert.True(r.Ok, r.Error);
        Assert.Equal("ชื่อคลิป", r.Title);
        Assert.Equal("https://cdn/x/master.m3u8", r.Streams[0].Url);
    }

    [Fact]
    public void master_playlist_ถูกแตกเป็นหลายความชัดให้เลือก()
    {
        var web = new FakeWebClient();
        web.Pages["https://site.example/watch/1"] = """<script>var u="https://cdn/x/master.m3u8";</script>""";
        web.Pages["https://cdn/x/master.m3u8"] = """
            #EXTM3U
            #EXT-X-STREAM-INF:RESOLUTION=1280x720
            720.m3u8
            #EXT-X-STREAM-INF:RESOLUTION=640x360
            360.m3u8
            """;

        var r = Make(web, new FakeBrowser()).Resolve("https://site.example/watch/1", CancellationToken.None);

        Assert.Equal(2, r.Streams.Count);
        Assert.Equal(720, r.Streams[0].Height);
    }

    [Fact]
    public void ตาม_iframe_ลงไปอีกชั้นแล้วเจอ()
    {
        var web = new FakeWebClient();
        web.Pages["https://site.example/watch/1"] =
            """<iframe src="https://player.example.com/e/ABC"></iframe>""";
        web.Pages["https://player.example.com/e/ABC"] =
            """<script>file: "https://cdn/deep/index.m3u8"</script>""";
        web.Pages["https://cdn/deep/index.m3u8"] = "#EXTM3U\n#EXTINF:4,\nseg.ts\n";

        var r = Make(web, new FakeBrowser()).Resolve("https://site.example/watch/1", CancellationToken.None);

        Assert.True(r.Ok, r.Error);
        Assert.Equal("https://cdn/deep/index.m3u8", r.Streams[0].Url);
    }

    [Fact]
    public void ไม่เจออะไรเลยแล้วบอกทางที่เดินมาไว้ให้ทำ_config_ต่อ()
    {
        var web = new FakeWebClient();
        web.Pages["https://site.example/watch/1"] = "<html><body>ไม่มีวิดีโอ</body></html>";

        var r = Make(web, new FakeBrowser { IsReady = false })
            .Resolve("https://site.example/watch/1", CancellationToken.None);

        Assert.True(r.Handled);
        Assert.False(r.Ok);
        Assert.Contains("ต้องเขียน config", r.Error);
        Assert.Contains("ทางที่เดินมา", r.Error);
    }

    [Fact]
    public void หน้าที่สร้างด้วย_js_ถูกดักจาก_request_ที่เบราว์เซอร์ยิงออกไป()
    {
        var web = new FakeWebClient();
        web.Pages["https://site.example/watch/1"] = "<html><div id=app></div></html>";

        var browser = new FakeBrowser();
        browser.Pages["https://site.example/watch/1"] = "<html><div id=app>โหลดแล้ว</div></html>";
        browser.Requests.Add(new CapturedRequest(
            "https://cdn/live/master.m3u8", "XHR", new Dictionary<string, string>()));

        web.Pages["https://cdn/live/master.m3u8"] = "#EXTM3U\n#EXTINF:4,\nseg.ts\n";

        var r = Make(web, browser).Resolve("https://site.example/watch/1", CancellationToken.None);

        Assert.True(r.Ok, r.Error);
        Assert.Equal("https://cdn/live/master.m3u8", r.Streams[0].Url);
    }

    [Fact]
    public void ด่านกันบอทที่ผ่านไม่ได้_บอกตรงๆ_ว่าต้องกดยืนยันเอง()
    {
        var web = new FakeWebClient();
        web.Pages["https://site.example/x"] = "<title>Just a moment...</title>";

        var r = Make(web, new FakeBrowser { IsReady = false })
            .Resolve("https://site.example/x", CancellationToken.None);

        Assert.False(r.Ok);
        Assert.Contains("กันบอท", r.Error);
    }
}

/// <summary>resolver ปลอมสำหรับเทสว่า engine เดินทางถอยกลับถูกไหม</summary>
public sealed class FakeResolver : IStreamResolver
{
    public ResolveOutcome Primary { get; set; } = ResolveOutcome.NotHandled;
    public ResolveOutcome Fallback { get; set; } = ResolveOutcome.NotHandled;
    public int PrimaryCalls { get; private set; }
    public int FallbackCalls { get; private set; }

    public ResolveOutcome Resolve(string url, CancellationToken ct)
    {
        PrimaryCalls++;
        return Primary;
    }

    public ResolveOutcome ResolveFallback(string url, CancellationToken ct)
    {
        FallbackCalls++;
        return Fallback;
    }
}

public class EngineFallbackTests
{
    private static DownloadItem NewItem(TempApp app) => new()
    {
        SourceUrl = "https://site.example/watch/1",
        Title = "คลิปทดสอบ",
        OutputDirectory = app.Output,
        Force = true,
    };

    [Fact]
    public async Task ytdlp_ไม่รู้จักเว็บ_แล้วถอยไปอ่านหน้าเองจนสำเร็จ()
    {
        using var app = new TempApp();
        var resolver = new FakeResolver
        {
            Fallback = new ResolveOutcome(true, "Generic", "ชื่อจากหน้าเว็บ",
                [new MediaStream { Url = "https://cdn/x/master.m3u8", Kind = StreamKind.Hls, Height = 720 }],
                null),
        };

        app.Runner.YtDlpSequence.Add("ERROR: Unsupported URL: https://site.example/watch/1");
        app.Runner.YtDlpSequence.Add(null);   // ครั้งที่สองผ่าน
        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.mp4");

        var item = NewItem(app);
        await new DownloadEngine(app.Paths, app.Settings, app.Runner, resolver)
            .RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Done, item.Status);
        Assert.Equal(1, resolver.FallbackCalls);
        Assert.Equal(2, app.Runner.YtDlpCalls);
        Assert.Equal("Generic", item.ModuleName);

        // ครั้งที่สองต้องยิงไปที่ m3u8 ที่แกะได้ ไม่ใช่หน้าเว็บเดิม
        var second = app.Runner.Calls.Where(c => c.FileName.EndsWith("yt-dlp.exe")).ToList()[1];
        Assert.Contains("https://cdn/x/master.m3u8", second.Arguments);
    }

    [Fact]
    public async Task ถอยกลับได้ครั้งเดียว_ครั้งที่สองพังก็จบ_ไม่วนต่อ()
    {
        using var app = new TempApp();
        var resolver = new FakeResolver
        {
            Fallback = new ResolveOutcome(true, "Generic", null,
                [new MediaStream { Url = "https://cdn/x/master.m3u8", Kind = StreamKind.Hls }], null),
        };

        app.Runner.YtDlpStdErr = "ERROR: Unsupported URL: x";   // พังทุกครั้ง

        var item = NewItem(app);
        await new DownloadEngine(app.Paths, app.Settings, app.Runner, resolver)
            .RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Failed, item.Status);
        Assert.Equal(2, app.Runner.YtDlpCalls);     // ไม่ใช่ 3 ไม่ใช่ 10
        Assert.Equal(1, resolver.FallbackCalls);
    }

    [Fact]
    public async Task ความผิดพลาดที่ถอยไปก็ไม่ช่วย_ไม่ต้องเสียเวลาอ่านหน้าเว็บ()
    {
        using var app = new TempApp();
        var resolver = new FakeResolver();
        app.Runner.YtDlpStdErr = "ERROR: No space left on device";

        var item = NewItem(app);
        await new DownloadEngine(app.Paths, app.Settings, app.Runner, resolver)
            .RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Failed, item.Status);
        Assert.Equal(0, resolver.FallbackCalls);
        Assert.Equal(1, app.Runner.YtDlpCalls);
    }

    [Fact]
    public async Task มี_module_ของเว็บอยู่แล้วก็ไม่ต้องถอยไปทางทั่วไป()
    {
        using var app = new TempApp();
        var resolver = new FakeResolver
        {
            Primary = new ResolveOutcome(true, "MyModule", "ชื่อจาก module",
                [new MediaStream { Url = "https://cdn/m/master.m3u8", Kind = StreamKind.Hls, Height = 1080 }],
                null),
        };
        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.mp4");

        var item = NewItem(app);
        await new DownloadEngine(app.Paths, app.Settings, app.Runner, resolver)
            .RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Done, item.Status);
        Assert.Equal(1, resolver.PrimaryCalls);
        Assert.Equal(0, resolver.FallbackCalls);
        Assert.Equal("MyModule", item.ModuleName);
    }

    [Fact]
    public async Task ผู้ใช้เลือก_720p_แล้วได้_720p_ไม่ใช่ตัวใหญ่สุด()
    {
        using var app = new TempApp();
        var resolver = new FakeResolver
        {
            Primary = new ResolveOutcome(true, "M", null,
            [
                new MediaStream { Url = "https://cdn/1080.m3u8", Kind = StreamKind.Hls, Height = 1080 },
                new MediaStream { Url = "https://cdn/720.m3u8", Kind = StreamKind.Hls, Height = 720 },
                new MediaStream { Url = "https://cdn/360.m3u8", Kind = StreamKind.Hls, Height = 360 },
            ], null),
        };
        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.mp4");

        var item = NewItem(app);
        item.PreferredHeight = 720;
        await new DownloadEngine(app.Paths, app.Settings, app.Runner, resolver)
            .RunAsync(item, CancellationToken.None);

        Assert.Equal("https://cdn/720.m3u8", item.Stream!.Url);
    }

    [Fact]
    public async Task ไม่มีความชัดที่ขอ_ก็เอาตัวที่ใกล้ที่สุดโดยไม่เกิน()
    {
        using var app = new TempApp();
        var resolver = new FakeResolver
        {
            Primary = new ResolveOutcome(true, "M", null,
            [
                new MediaStream { Url = "https://cdn/1080.m3u8", Kind = StreamKind.Hls, Height = 1080 },
                new MediaStream { Url = "https://cdn/480.m3u8", Kind = StreamKind.Hls, Height = 480 },
            ], null),
        };
        app.Runner.ProducedFile = Path.Combine(app.Output, "คลิปทดสอบ.mp4");

        var item = NewItem(app);
        item.PreferredHeight = 720;
        await new DownloadEngine(app.Paths, app.Settings, app.Runner, resolver)
            .RunAsync(item, CancellationToken.None);

        Assert.Equal(480, item.Stream!.Height);
    }
}
