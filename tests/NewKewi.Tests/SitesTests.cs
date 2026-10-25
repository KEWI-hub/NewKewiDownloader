using NewKewi.Core;
using NewKewi.Core.Models;
using NewKewi.Sites;
using NewKewi.Sites.Lua;

namespace NewKewi.Tests;

/// <summary>ตัวปลอมของเน็ต · จับคู่ url กับเนื้อหา และจำ header ที่ module ส่งไป</summary>
public sealed class FakeWebClient : IWebClient
{
    public Dictionary<string, string> Pages { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<string> Requested { get; } = [];
    public List<IReadOnlyDictionary<string, string>> SentHeaders { get; } = [];

    /// <summary>url ที่ไม่ได้ใส่ไว้จะตอบ 404 — module ต้องรับมือได้ ไม่ใช่พังทั้งแอป</summary>
    public WebResponse Get(string url, IReadOnlyDictionary<string, string> headers, CancellationToken ct)
    {
        Requested.Add(url);
        SentHeaders.Add(new Dictionary<string, string>(headers));
        return Pages.TryGetValue(url, out var body)
            ? new WebResponse(200, body, url)
            : new WebResponse(404, "", url);
    }

    public WebResponse Post(string url, IReadOnlyDictionary<string, string> headers,
        IReadOnlyDictionary<string, string> form, CancellationToken ct)
        => Get(url, headers, ct);
}

/// <summary>โฟลเดอร์ module ชั่วคราว ให้เขียนไฟล์ .lua ทดสอบได้โดยไม่แตะของจริง</summary>
public sealed class TempModules : IDisposable
{
    public TempModules()
    {
        Root = Path.Combine(Path.GetTempPath(), "newkewi-mods-" + Guid.NewGuid().ToString("n")[..8]);
        Shared = Path.Combine(Root, "lua");
        Local = Path.Combine(Root, "local");
        Directory.CreateDirectory(Shared);
        Directory.CreateDirectory(Local);
        View = new AppPathsView(Shared, Local);
    }

    public string Root { get; }
    public string Shared { get; }
    public string Local { get; }
    public AppPathsView View { get; }

    public void Write(string name, string lua, bool local = false)
        => File.WriteAllText(Path.Combine(local ? Local : Shared, name), lua);

    public SiteRegistry Loaded()
    {
        var r = new SiteRegistry(View);
        r.Load();
        return r;
    }

    public void Dispose()
    {
        try { Directory.Delete(Root, recursive: true); } catch { /* ช่างมัน */ }
    }
}

public class SiteRegistryTests
{
    private const string Simple = """
        function Register()
            module.Name = 'Simple'
            module.Domains:Add('example.com')
        end
        function GetStreams() end
        """;

    [Fact]
    public void อ่าน_Register_แล้วแมปโดเมนได้()
    {
        using var m = new TempModules();
        m.Write("Simple.lua", Simple);

        var found = m.Loaded().Find("https://example.com/watch/1");

        Assert.NotNull(found);
        Assert.Equal("Simple", found.Name);
    }

    [Fact]
    public void โดเมนย่อยและ_www_ถูกนับว่าตรงกัน()
    {
        using var m = new TempModules();
        m.Write("Simple.lua", Simple);
        var r = m.Loaded();

        Assert.NotNull(r.Find("https://www.example.com/x"));
        Assert.NotNull(r.Find("https://cdn.example.com/x"));
        Assert.Null(r.Find("https://notexample.com/x"));
        Assert.Null(r.Find("https://example.com.evil.net/x"));
    }

    [Fact]
    public void ไฟล์ขึ้นต้นด้วยขีดล่างไม่ถูกนับเป็น_module_ของเว็บ()
    {
        using var m = new TempModules();
        m.Write("_Template.lua", Simple);

        Assert.Empty(m.Loaded().Modules);
    }

    [Fact]
    public void module_พังหนึ่งไฟล์ต้องไม่ทำให้ไฟล์อื่นโหลดไม่ขึ้น()
    {
        using var m = new TempModules();
        m.Write("Broken.lua", "this is not lua at all ((((");
        m.Write("Simple.lua", Simple);

        var r = m.Loaded();

        Assert.Single(r.Modules);
        Assert.Single(r.LoadErrors);
        Assert.Contains("Broken.lua", r.LoadErrors[0].File);
    }

    [Fact]
    public void module_ที่ไม่ประกาศโดเมนถูกปัดตกพร้อมเหตุผล()
    {
        using var m = new TempModules();
        m.Write("NoDomain.lua", "function Register() module.Name='x' end");

        var r = m.Loaded();

        Assert.Empty(r.Modules);
        Assert.Contains("Domains", r.LoadErrors[0].Error);
    }

    [Fact]
    public void ของผู้ใช้เองชนะของที่ซิงก์มา()
    {
        using var m = new TempModules();
        m.Write("Simple.lua", Simple);
        m.Write("Mine.lua", Simple.Replace("'Simple'", "'ของฉันเอง'"), local: true);

        var first = m.Loaded().Find("https://example.com/x");

        Assert.Equal("ของฉันเอง", first!.Name);
    }

    [Fact]
    public void โดเมนที่เจาะจงกว่าถูกลองก่อน()
    {
        using var m = new TempModules();
        m.Write("Wide.lua", Simple);
        m.Write("Narrow.lua", """
            function Register()
                module.Name = 'Narrow'
                module.Domains:Add('player.example.com')
            end
            function GetStreams() end
            """);

        Assert.Equal("Narrow", m.Loaded().Find("https://player.example.com/x")!.Name);
    }

    [Fact]
    public void Register_ยิงเน็ตไม่ได้()
    {
        using var m = new TempModules();
        m.Write("Naughty.lua", """
            function Register()
                module.Name = 'Naughty'
                module.Domains:Add('example.com')
                http.Get('https://example.com/')
            end
            """);

        var r = m.Loaded();

        Assert.Empty(r.Modules);
        Assert.Single(r.LoadErrors);
    }
}

public class LuaSandboxTests
{
    private static ResolveResult Run(string lua, string url, FakeWebClient web, string page = "")
    {
        using var m = new TempModules();
        m.Write("T.lua", lua);
        web.Pages[url] = page;
        return new LuaResolver(m.Loaded(), web).Resolve(url, CancellationToken.None);
    }

    [Fact]
    public void module_แตะไฟล์ในเครื่องไม่ได้()
    {
        var web = new FakeWebClient();
        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams()
                local f = io.open('C:/Windows/win.ini', 'r')
            end
            """, "https://example.com/x", web);

        Assert.True(r.Handled);
        Assert.NotNull(r.Error);   // io เป็น nil → เรียกแล้วพัง ซึ่งคือสิ่งที่ต้องการ
    }

    [Theory]
    [InlineData("dofile('C:/Windows/win.ini')")]
    [InlineData("loadfile('C:/Windows/win.ini')")]
    [InlineData("require('../../../ไฟล์ข้างนอก')")]
    [InlineData("require('C:/Windows/win')")]
    [InlineData("require('a/b')")]
    public void ทางอ่านไฟล์นอกโฟลเดอร์_module_ถูกปิดหมด(string attempt)
    {
        var web = new FakeWebClient();
        var r = Run($$"""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams()
                {{attempt}}
            end
            """, "https://example.com/x", web);

        Assert.True(r.Handled);
        Assert.NotNull(r.Error);
    }

    [Fact]
    public void require_โหลดไฟล์ฐานร่วมในโฟลเดอร์เดียวกันได้()
    {
        using var m = new TempModules();
        m.Write("_Shared.lua", "local M = {} function M.greet() return 'สวัสดี' end return M");
        m.Write("T.lua", """
            local shared = require '_Shared'
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams()
                streams.Add{ url = 'https://cdn/x.m3u8', label = shared.greet() }
            end
            """);

        var web = new FakeWebClient();
        web.Pages["https://example.com/x"] = "";
        var r = new LuaResolver(m.Loaded(), web).Resolve("https://example.com/x", CancellationToken.None);

        Assert.True(r.Streams.Count == 1, "error=" + r.Error);
        Assert.Equal("สวัสดี", r.Streams[0].Label);
    }

    [Fact]
    public void json_ที่หนีสแลชแบบ_backslash_slash_อ่านได้()
    {
        var web = new FakeWebClient();
        web.Pages["https://api.example/x"] = """{"videoSource":"https:\/\/cdn.example\/a\/master.m3u8"}""";

        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams()
                local data = http.GetJson('https://api.example/x')
                if data == nil then return end
                streams.Add{ url = data.videoSource, kind = 'hls' }
            end
            """, "https://example.com/x", web);

        Assert.True(r.Streams.Count == 1, "error=" + r.Error);
        Assert.Equal("https://cdn.example/a/master.m3u8", r.Streams[0].Url);
    }

    [Fact]
    public void json_ที่อ่านไม่ออกคืน_nil_ไม่ใช่ทำให้_module_ล้ม()
    {
        var web = new FakeWebClient();
        web.Pages["https://api.example/x"] = "{ นี่ไม่ใช่ json";

        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams()
                local data = http.GetJson('https://api.example/x')
                streams.Add{ url = 'https://cdn/x.m3u8', label = (data == nil) and 'nil' or 'มีค่า' }
            end
            """, "https://example.com/x", web);

        Assert.True(r.Streams.Count == 1, "error=" + r.Error);
        Assert.Equal("nil", r.Streams[0].Label);
    }

    [Fact]
    public void เมธอดของสตริงใช้ได้ครบ()
    {
        var web = new FakeWebClient();
        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams()
                local s = 'a/b/c.m3u8?k=1'
                streams.Add{
                    url    = 'https://cdn/' .. s:before('?'),
                    label  = s:afterlast('/') .. '|' .. s:regex('([a-z])/b', 1),
                    height = 720,
                }
            end
            """, "https://example.com/x", web);

        Assert.True(r.Streams.Count == 1, "error=" + r.Error);
        var s = r.Streams[0];
        Assert.Equal("https://cdn/a/b/c.m3u8", s.Url);
        Assert.Equal("c.m3u8?k=1|a", s.Label);
    }

    [Fact]
    public void ลิงก์ที่เป็น_path_เปล่าถูกต่อกับ_url_ของหน้าให้เอง()
    {
        var web = new FakeWebClient();
        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams()
                streams.Add{ url = '/videos/a/index.m3u8?key=9', height = 480 }
            end
            """, "https://example.com/cn/movie/abc", web);

        Assert.Equal("https://example.com/videos/a/index.m3u8?key=9", r.Streams[0].Url);
    }

    [Fact]
    public void kind_ที่ไม่ได้บอกมาถูกเดาจากนามสกุล()
    {
        var web = new FakeWebClient();
        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams()
                streams.Add{ url = 'https://cdn/a.m3u8', height = 1080 }
                streams.Add{ url = 'https://cdn/b.mp4',  height = 720  }
            end
            """, "https://example.com/x", web);

        Assert.Equal(StreamKind.Hls, r.Streams[0].Kind);
        Assert.Equal(StreamKind.File, r.Streams[1].Kind);
        Assert.Equal("1080p", r.Streams[0].Label);   // ไม่ได้ตั้ง label ก็เติมจากความสูงให้
    }

    [Fact]
    public void header_สองขั้นถูกแยกไว้ตามที่_module_บอก()
    {
        var web = new FakeWebClient();
        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams()
                streams.Add{
                    url = 'https://cdn/master.txt', kind = 'hls', height = 1080,
                    playlistHeaders = { Origin = 'https://player.example.com' },
                    segmentHeaders  = { },
                }
            end
            """, "https://example.com/x", web);

        var s = r.Streams[0];
        Assert.True(s.NeedsSplitHeaders);
        Assert.Equal("https://player.example.com", s.PlaylistHeaders["Origin"]);
        Assert.Empty(s.SegmentHeaders);
    }

    [Fact]
    public void บอก_header_ชุดเดียวแปลว่าใช้ชุดนั้นทั้งสองขั้น()
    {
        var web = new FakeWebClient();
        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams()
                streams.Add{
                    url = 'https://cdn/a.m3u8', kind = 'hls', height = 720,
                    playlistHeaders = { ['X-Token'] = 'abc' },
                }
            end
            """, "https://example.com/x", web);

        Assert.False(r.Streams[0].NeedsSplitHeaders);
        Assert.Equal("abc", r.Streams[0].SegmentHeaders["X-Token"]);
    }

    [Fact]
    public void Probe_คืน_false_แล้วถือว่า_module_ไม่รับงานนี้()
    {
        var web = new FakeWebClient();
        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function Probe() return url:contains('/watch/') end
            function GetStreams() streams.Add{ url='https://cdn/a.m3u8' } end
            """, "https://example.com/other/1", web);

        Assert.Empty(r.Streams);
    }

    [Fact]
    public void module_พังระหว่างทางแล้วได้เหตุผล_ไม่ใช่เงียบ()
    {
        var web = new FakeWebClient();
        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetStreams() error('เว็บเปลี่ยนโครงหน้าแล้ว') end
            """, "https://example.com/x", web);

        Assert.True(r.Handled);
        Assert.Contains("เว็บเปลี่ยนโครงหน้าแล้ว", r.Error);
    }

    [Fact]
    public void ไม่มี_module_รับโดเมนนี้_แปลว่าให้ไปทางทั่วไป()
    {
        using var m = new TempModules();
        var r = new LuaResolver(m.Loaded(), new FakeWebClient())
            .Resolve("https://ไม่มีใครรู้จัก.com/x", CancellationToken.None);

        Assert.False(r.Handled);
        Assert.Null(r.Error);
    }

    [Fact]
    public void dom_อ่าน_attribute_ท้าย_xpath_ได้()
    {
        var web = new FakeWebClient();
        var r = Run("""
            function Register()
                module.Name='T' module.Domains:Add('example.com')
            end
            function GetInfo() info.Title = dom.SelectValue('//h1') end
            function GetStreams()
                streams.Add{ url = dom.SelectValue('//iframe/@src'), height = 1080 }
            end
            """,
            "https://example.com/x", web,
            page: "<html><h1>ชื่อคลิป &amp; อื่นๆ</h1><iframe src='https://p/e/AAA'></iframe></html>");

        Assert.Equal("ชื่อคลิป & อื่นๆ", r.Title);
        Assert.Equal("https://p/e/AAA", r.Streams[0].Url);
    }
}

public class TextToolsTests
{
    [Fact]
    public void แตก_js_ที่ถูกบีบด้วย_packer_ได้()
    {
        const string Packed =
            "eval(function(p,a,c,k,e,d){return p}('0 1',2,2,'var|x'.split('|'),0,{}))";

        Assert.Contains("var x", TextTools.UnpackJs(Packed));
    }

    [Fact]
    public void แปลง_hex_escape_กลับเป็นตัวอักษร()
        => Assert.Equal("ZT", TextTools.HexUnescape(@"\x5a\x54"));

    [Fact]
    public void base64_ถอดได้ทั้งแบบปกติและแบบ_url_safe()
    {
        Assert.Equal("hello", TextTools.Base64Decode("aGVsbG8="));
        Assert.Equal("hello", TextTools.Base64Decode("aGVsbG8"));      // ไม่มี padding
        Assert.Equal("", TextTools.Base64Decode("ไม่ใช่ base64 เลย"));
    }

    [Fact]
    public void pattern_พังแล้วคืนค่าว่าง_ไม่ใช่โยน_exception()
        => Assert.Equal("", TextTools.Match("abc", "[unclosed"));

    [Theory]
    [InlineData("https://a/b", "/c", "https://a/c")]
    [InlineData("https://a/b/", "c", "https://a/b/c")]
    [InlineData("https://a/b", "https://z/q", "https://z/q")]
    public void urljoin_ทำงานถูก(string b, string rel, string expected)
        => Assert.Equal(expected, LuaSandbox.UrlJoin(b, rel));
}
