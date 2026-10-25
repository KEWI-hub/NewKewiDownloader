using NewKewi.Core;
using NewKewi.Core.Models;
using NewKewi.Sites;

namespace NewKewi.Tests;

/// <summary>
/// เทส module ที่ส่งจริงใน <c>modules/lua/</c> ด้วยข้อมูลจำลอง
///
/// ใช้ไฟล์ของจริงไม่ใช่ไฟล์ที่เขียนในเทส — พิมพ์ผิดใน module ที่ส่งให้ผู้ใช้จะได้ไม่หลุด
/// </summary>
public class RealModuleTests
{
    private static SiteRegistry RealRegistry()
    {
        var repo = AppPaths.ForRunningApp();
        var registry = new SiteRegistry(new AppPathsView(repo.LuaModules, repo.LocalModules));
        registry.Load();
        return registry;
    }

    private static ResolveResult Resolve(FakeWebClient web, string url)
        => new LuaResolver(RealRegistry(), web).Resolve(url, CancellationToken.None);

    [Fact]
    public void module_ที่ส่งจริงทุกไฟล์โหลดขึ้นหมด()
    {
        var registry = RealRegistry();

        Assert.Empty(registry.LoadErrors.Select(e => $"{Path.GetFileName(e.File)}: {e.Error}"));
        Assert.True(registry.Modules.Count >= 5, $"มีแค่ {registry.Modules.Count} module");
    }

    [Theory]
    [InlineData("https://av-th.io/video/1", "FirePlayer")]
    [InlineData("https://av-th.xyz/video/1", "FirePlayer")]
    [InlineData("https://supjav.com/x", "SupJav")]
    [InlineData("https://123av.com/x", "Av123")]
    [InlineData("https://taiav.com/cn/movie/x", "TaiAv")]
    [InlineData("https://pornavhd.com/x", "StreamOrigin")]
    public void แต่ละเว็บถูกส่งไปที่_module_ที่ถูกตัว(string url, string expected)
        => Assert.Equal(expected, RealRegistry().Find(url)?.Name);

    // ---- FirePlayer ----

    /// <summary>"aGFzaA==" (base64 ของคำว่า hash) ที่ถูกซ่อนอีกชั้นเป็น hex escape</summary>
    private const string CkHidden = @"\x61\x47\x46\x7a\x61\x41\x3d\x3d";

    [Fact]
    public void fireplayer_แกะ_ck_แล้วถาม_api_ได้ลิงก์พร้อม_header_สองขั้น()
    {
        var web = new FakeWebClient();
        web.Pages["https://av-th.io/video/1"] =
            """<h1>คลิปทดสอบ</h1><iframe src="https://av-th.xyz/video/ABC"></iframe>""";

        web.Pages["https://av-th.xyz/video/ABC"] =
            $$"""<script>FirePlayer("0123456789abcdef", {"ck":"{{CkHidden}}"});</script>""";

        web.Pages["https://av-th.xyz/player/index.php?data=0123456789abcdef&do=getVideo"] =
            """{"videoSource":"https:\/\/av-thstream1.example\/m3\/master.txt","securedLink":"https://ใช้ไม่ได้"}""";

        var r = Resolve(web, "https://av-th.io/video/1");

        Assert.True(r.Streams.Count == 1, "error=" + r.Error);
        var s = r.Streams[0];

        // ต้องใช้ videoSource ไม่ใช่ securedLink ซึ่งโดน 403 เสมอ
        Assert.Equal("https://av-thstream1.example/m3/master.txt", s.Url);

        Assert.True(s.NeedsSplitHeaders, "header สองขั้นต้องไม่เหมือนกัน");
        Assert.Equal("https://av-th.io", s.PlaylistHeaders["Origin"]);
        Assert.Equal("empty", s.PlaylistHeaders["Sec-Fetch-Dest"]);
        Assert.Empty(s.SegmentHeaders);

        // referer ต้องเป็นหน้าเว็บแม่ ไม่ใช่หน้า player
        Assert.Equal("https://av-th.io/", s.Referer);
    }

    [Fact]
    public void fireplayer_ที่หน้า_player_เปลี่ยนโครงแล้วบอกเหตุผล_ไม่เงียบ()
    {
        var web = new FakeWebClient();
        web.Pages["https://av-th.io/video/1"] =
            """<iframe src="https://av-th.xyz/video/ABC"></iframe>""";
        web.Pages["https://av-th.xyz/video/ABC"] = "<html>ไม่มีอะไรเลย</html>";

        var r = Resolve(web, "https://av-th.io/video/1");

        Assert.Empty(r.Streams);
        Assert.NotNull(r.Error);
    }

    // ---- SupJav ----

    [Fact]
    public void supjav_กลับด้าน_data_link_แล้วตามไปที่หน้า_player()
    {
        var web = new FakeWebClient();

        // "cba321" กลับด้านคือ "123abc"
        web.Pages["https://supjav.com/x"] =
            """<h1>ชื่อคลิป</h1><a class="btn-server" data-link="cba321">Server 1</a>""";

        const string Jump = "https://lk1.supremejav.com/supjav.php?c=123abc";
        web.Pages[Jump] = """<html><script>file: "https://cdn.example/a/index.m3u8"</script></html>""";

        var r = Resolve(web, "https://supjav.com/x");

        Assert.True(r.Streams.Count >= 1, "error=" + r.Error);
        Assert.Equal("https://cdn.example/a/index.m3u8", r.Streams[0].Url);
        Assert.Contains(Jump, web.Requested);
    }

    [Fact]
    public void supjav_ที่ติดด่านกันบอทบอกตรงๆ_ว่าหาปุ่มไม่เจอ()
    {
        var web = new FakeWebClient();
        web.Pages["https://supjav.com/x"] = "<title>Just a moment...</title>";

        var r = Resolve(web, "https://supjav.com/x");

        Assert.Empty(r.Streams);
        Assert.NotNull(r.Error);
    }

    // ---- 123av ----

    [Fact]
    public void av123_คลาย_escape_สองชั้นแล้วขอลิงก์จาก_player_ได้()
    {
        var web = new FakeWebClient();

        // ค่าจริงในหน้าถูก escape สองชั้น: " คือ " และ \\/ คือ /
        const string Embedded =
            """[{"name":"1","url":"https:\\/\\/jp.example\\/e\\/abc123"}]""";

        web.Pages["https://123av.com/x"] =
            $$"""<h1>ชื่อคลิป</h1><div x-data="player(JSON.parse('{{Embedded}}'))"></div>""";

        web.Pages["https://jp.example/stream?id=abc123"] =
            """{"media":{"stream":"https://cdn.example/v/720.m3u8"}}""";

        var r = Resolve(web, "https://123av.com/x");

        Assert.True(r.Streams.Count == 1, "error=" + r.Error);
        Assert.Equal("https://cdn.example/v/720.m3u8", r.Streams[0].Url);
    }
}

public class LocalPlaylistWriterTests
{
    private const string Master = """
        #EXTM3U
        #EXT-X-STREAM-INF:RESOLUTION=1280x720
        v720/list.m3u8
        #EXT-X-STREAM-INF:RESOLUTION=640x360
        v360/list.m3u8
        """;

    private static MediaStream SplitStream() => new()
    {
        Url = "https://cdn.example/m3/master.txt",
        Kind = StreamKind.Hls,
        Referer = "https://site.example/",
        PlaylistHeaders = { ["Origin"] = "https://site.example", ["Sec-Fetch-Dest"] = "empty" },
        SegmentHeaders = { },
    };

    [Fact]
    public void เขียน_playlist_ลงเครื่องแล้วชี้ไฟล์ย่อยเป็น_url_เต็ม()
    {
        var work = Path.Combine(Path.GetTempPath(), "newkewi-hls-" + Guid.NewGuid().ToString("n")[..8]);
        var web = new FakeWebClient();

        web.Pages["https://cdn.example/m3/master.txt"] = Master;
        web.Pages["https://cdn.example/m3/v720/list.m3u8"] =
            "#EXTM3U\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nseg2.ts\n#EXT-X-ENDLIST\n";
        web.Pages["https://cdn.example/m3/v360/list.m3u8"] =
            "#EXTM3U\n#EXTINF:4,\nseg1.ts\n#EXT-X-ENDLIST\n";

        try
        {
            var prepared = new LocalPlaylistWriter(web).Prepare(SplitStream(), work, CancellationToken.None);

            Assert.StartsWith("file:///", prepared.Url);

            // header ชุดเข้มใช้ไปแล้วตอนดึง playlist · ส่งต่อให้ yt-dlp ไม่ได้ ไฟล์ย่อยจะโดน 500
            Assert.Empty(prepared.PlaylistHeaders);
            Assert.Empty(prepared.SegmentHeaders);
            Assert.Equal("https://site.example/", prepared.Referer);

            var masterFile = prepared.Url["file:///".Length..].Replace('/', Path.DirectorySeparatorChar);
            var written = File.ReadAllText(masterFile);
            Assert.Contains("hls-1.m3u8", written);
            Assert.Contains("hls-2.m3u8", written);
            Assert.DoesNotContain("v720/list.m3u8", written);

            // ไฟล์ย่อยต้องเป็น url เต็ม เพราะ playlist ย้ายมาอยู่ในเครื่องแล้ว
            var variant = File.ReadAllText(Path.Combine(work, "hls-1.m3u8"));
            Assert.Contains("https://cdn.example/m3/v720/seg1.ts", variant);
            Assert.DoesNotContain("\nseg1.ts", variant);

            // ต้องยิง playlist ด้วย header ชุดเข้มจริงๆ
            Assert.Contains(web.SentHeaders, h => h.ContainsKey("Origin"));
        }
        finally
        {
            try { Directory.Delete(work, recursive: true); } catch { /* ช่างมัน */ }
        }
    }

    [Fact]
    public void สตรีมที่_header_เหมือนกันทั้งสองขั้นไม่ถูกแตะ()
    {
        var plain = new MediaStream { Url = "https://cdn/x.m3u8", Kind = StreamKind.Hls };
        var same = new LocalPlaylistWriter(new FakeWebClient())
            .Prepare(plain, Path.GetTempPath(), CancellationToken.None);

        Assert.Same(plain, same);
    }

    [Fact]
    public void ดึง_playlist_ไม่ได้ก็คืนตัวเดิมให้ไปลองทางปกติ()
    {
        var stream = SplitStream();
        var untouched = new LocalPlaylistWriter(new FakeWebClient())   // ไม่มีหน้าไหนตอบ 200
            .Prepare(stream, Path.GetTempPath(), CancellationToken.None);

        Assert.Same(stream, untouched);
    }
}

public class RedirectFollowTests
{
    [Fact]
    public void จับ_location_replace_ได้()
    {
        const string Html = """<script>location.replace("https://real.example/player/1")</script>""";
        Assert.Equal("https://real.example/player/1",
            MediaScanner.FindRedirect(Html, "https://jump.example/"));
    }

    [Fact]
    public void path_เปล่าถูกต่อกับหน้าปัจจุบัน()
        => Assert.Equal("https://jump.example/real/1",
            MediaScanner.FindRedirect("""<script>location.href='/real/1'</script>""",
                "https://jump.example/x"));

    [Fact]
    public void หน้าที่ส่งต่อด้วย_js_ถูกตามไปจนเจอวิดีโอ()
    {
        var web = new FakeWebClient();
        web.Pages["https://site.example/watch/1"] =
            """<script>location.replace("https://player.example/real")</script>""";
        web.Pages["https://player.example/real"] =
            """<script>file: "https://cdn.example/a/index.m3u8"</script>""";
        web.Pages["https://cdn.example/a/index.m3u8"] = "#EXTM3U\n#EXTINF:4,\nseg.ts\n";

        var browser = new FakeBrowser { IsReady = false };
        var r = new GenericResolver(new PageFetcher(web, browser), web, browser)
            .Resolve("https://site.example/watch/1", CancellationToken.None);

        Assert.True(r.Ok, r.Error);
        Assert.Equal("https://cdn.example/a/index.m3u8", r.Streams[0].Url);
    }

    [Fact]
    public void jwplayer_ที่เก็บลิงก์หลายตัวใน_hls2_hls3_ถูกอ่านด้วย()
    {
        const string Html = """ links = {"hls2":"https://cdn.example/a/720.m3u8","hls4":"https://cdn.example/a/1080.m3u8"} """;

        var found = MediaScanner.FindMedia(Html, "https://site.example/");

        Assert.Contains(found, f => f.Url.EndsWith("720.m3u8"));
        Assert.Contains(found, f => f.Url.EndsWith("1080.m3u8"));
    }
}
