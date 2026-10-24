using System.Net.Sockets;
using System.Text;
using NewKewi.Bridge;
using NewKewi.Core;

namespace NewKewi.Tests;

/// <summary>
/// เทส Bridge ด้วยการยิงเข้าทางซ็อกเก็ตจริง ไม่ได้เรียกเมธอดตรงๆ
/// เพราะเรื่องที่สำคัญที่สุดของชั้นนี้คือ **ใครยิงเข้ามาได้บ้าง** ซึ่งอยู่ที่ระดับ HTTP
///
/// ใช้พอร์ต 0 (ระบบเลือกให้) เสมอ · ห้ามแตะ 47800 ซึ่งเป็นพอร์ตของแอปจริง
/// ของเดิมเคยเผลอยิงลิงก์เข้าคิวของผู้ใช้เพราะเทสใช้พอร์ตจริง
/// </summary>
public class BridgeTests
{
    private sealed class Harness : IDisposable
    {
        public Harness(Func<string, bool>? pair = null)
        {
            Root = Path.Combine(Path.GetTempPath(), "newkewi-bridge-" + Guid.NewGuid().ToString("n")[..8]);
            Paths = new AppPaths(Root);
            Paths.EnsureCreated();

            Server = new BridgeServer(Paths, "9.9.9") { PairRequested = pair };
            Server.LinkReceived = link => Received.Add(link);
            Server.Start(0);
        }

        public string Root { get; }
        public AppPaths Paths { get; }
        public BridgeServer Server { get; }
        public List<IncomingLink> Received { get; } = [];

        public void Dispose()
        {
            Server.Dispose();
            try { Directory.Delete(Root, recursive: true); } catch { /* ช่างมัน */ }
        }
    }

    /// <summary>ยิง HTTP ดิบ เพื่อคุมได้ว่าจะใส่หัวอะไรบ้าง (หรือไม่ใส่เลย)</summary>
    private static (int Status, string Body) Send(
        int port, string method, string path, string? body = null,
        string? token = null, bool withMark = true)
    {
        using var client = new TcpClient();
        client.Connect("127.0.0.1", port);
        using var stream = client.GetStream();

        var payload = Encoding.UTF8.GetBytes(body ?? "");
        var head = new StringBuilder()
            .Append(method).Append(' ').Append(path).Append(" HTTP/1.1\r\n")
            .Append("Host: 127.0.0.1\r\n")
            .Append("Content-Type: application/json\r\n")
            .Append("Content-Length: ").Append(payload.Length).Append("\r\n");

        if (withMark) head.Append("X-NewKewi: 1\r\n");
        if (token is not null) head.Append("X-NewKewi-Token: ").Append(token).Append("\r\n");
        head.Append("Connection: close\r\n\r\n");

        stream.Write(Encoding.UTF8.GetBytes(head.ToString()));
        if (payload.Length > 0) stream.Write(payload);
        stream.Flush();

        using var reader = new MemoryStream();
        var buffer = new byte[8192];
        int read;
        while ((read = stream.Read(buffer, 0, buffer.Length)) > 0) reader.Write(buffer, 0, read);

        var text = Encoding.UTF8.GetString(reader.ToArray());
        var status = int.Parse(text.Split(' ')[1]);
        var split = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        return (status, split >= 0 ? text[(split + 4)..] : "");
    }

    [Fact]
    public void ping_ที่ไม่มีหัว_X_NewKewi_ถูกปฏิเสธ()
    {
        using var h = new Harness();
        var r = Send(h.Server.Port, "GET", "/ping", token: h.Server.Token, withMark: false);
        Assert.Equal(403, r.Status);
    }

    [Fact]
    public void ping_ที่_token_ผิดถูกปฏิเสธ()
    {
        using var h = new Harness();
        Assert.Equal(401, Send(h.Server.Port, "GET", "/ping", token: "ไม่ใช่ token").Status);
        Assert.Equal(401, Send(h.Server.Port, "GET", "/ping").Status);
    }

    [Fact]
    public void ping_ที่ถูกต้องตอบชื่อและเวอร์ชันของแอป()
    {
        using var h = new Harness();
        var r = Send(h.Server.Port, "GET", "/ping", token: h.Server.Token);

        Assert.Equal(200, r.Status);
        Assert.Contains("NewKewiDownloader", r.Body);
        Assert.Contains("9.9.9", r.Body);
    }

    [Fact]
    public void preflight_ตอบ_204_พร้อมหัว_CORS()
    {
        using var h = new Harness();
        Assert.Equal(204, Send(h.Server.Port, "OPTIONS", "/add").Status);
    }

    [Fact]
    public void ไม่มีใครรับเรื่องจับคู่_แปลว่าไม่อนุญาต_ห้ามปล่อยผ่าน()
    {
        using var h = new Harness(pair: null);
        var r = Send(h.Server.Port, "POST", "/pair", """{"name":"ส่วนขยายทดสอบ"}""");

        Assert.Equal(403, r.Status);
        Assert.DoesNotContain(h.Server.Token, r.Body);
    }

    [Fact]
    public void ผู้ใช้ปฏิเสธแล้วไม่ได้_token()
    {
        using var h = new Harness(pair: _ => false);
        var r = Send(h.Server.Port, "POST", "/pair", """{"name":"x"}""");

        Assert.Equal(403, r.Status);
        Assert.DoesNotContain(h.Server.Token, r.Body);
    }

    [Fact]
    public void ผู้ใช้อนุญาตแล้วได้_token_กลับไป()
    {
        var asked = new List<string>();
        using var h = new Harness(pair: name => { asked.Add(name); return true; });

        var r = Send(h.Server.Port, "POST", "/pair", """{"name":"Kewi Helper"}""");

        Assert.Equal(200, r.Status);
        Assert.Contains(h.Server.Token, r.Body);
        Assert.Equal("Kewi Helper", Assert.Single(asked));
    }

    [Fact]
    public void ขอจับคู่ถี่เกินไปถูกกั้น_กันผู้ใช้เผลอกดอนุญาต()
    {
        using var h = new Harness(pair: _ => true);

        Assert.Equal(200, Send(h.Server.Port, "POST", "/pair", """{"name":"a"}""").Status);
        Assert.Equal(429, Send(h.Server.Port, "POST", "/pair", """{"name":"a"}""").Status);
    }

    [Fact]
    public void add_ที่ถูกต้องส่งลิงก์เข้าแอป()
    {
        using var h = new Harness();
        var body = """
            {"url":"https://cdn.example.com/x/master.m3u8",
             "title":"คลิปทดสอบ","pageUrl":"https://site.example/watch/1",
             "referer":"https://site.example/","height":720,"kind":"hls",
             "headers":{"Origin":"https://site.example"}}
            """;

        var r = Send(h.Server.Port, "POST", "/add", body, token: h.Server.Token);

        Assert.Equal(200, r.Status);
        var link = Assert.Single(h.Received);
        Assert.Equal("https://cdn.example.com/x/master.m3u8", link.Url);
        Assert.Equal("คลิปทดสอบ", link.Title);
        Assert.Equal(720, link.Height);
        Assert.Equal("https://site.example", link.Headers["Origin"]);
    }

    [Fact]
    public void add_ไม่รับ_cookie_ที่ส่วนขยายส่งมา()
    {
        using var h = new Harness();
        var body = """
            {"url":"https://cdn/x.m3u8","headers":{"Cookie":"sid=ของผู้ใช้","Origin":"https://a"}}
            """;

        Send(h.Server.Port, "POST", "/add", body, token: h.Server.Token);

        var link = Assert.Single(h.Received);
        Assert.False(link.Headers.ContainsKey("Cookie"), "ต้องไม่รับ cookie ของเบราว์เซอร์ผู้ใช้");
        Assert.True(link.Headers.ContainsKey("Origin"));
    }

    [Theory]
    [InlineData("""{"url":"file:///C:/windows/win.ini"}""")]
    [InlineData("""{"url":"javascript:alert(1)"}""")]
    [InlineData("""{"url":""}""")]
    [InlineData("""{"ไม่มี":"url"}""")]
    public void add_ที่_url_ใช้ไม่ได้ถูกปฏิเสธ(string body)
    {
        using var h = new Harness();
        var r = Send(h.Server.Port, "POST", "/add", body, token: h.Server.Token);

        Assert.Equal(400, r.Status);
        Assert.Empty(h.Received);
    }

    [Fact]
    public void add_ที่เนื้อหาไม่ใช่_json_ถูกปฏิเสธ()
    {
        using var h = new Harness();
        Assert.Equal(400,
            Send(h.Server.Port, "POST", "/add", "นี่ไม่ใช่ json", token: h.Server.Token).Status);
    }

    [Fact]
    public void add_ที่ไม่มี_token_ไม่ถึงคิว()
    {
        using var h = new Harness();
        var body = """{"url":"https://cdn/x.m3u8"}""";

        Assert.Equal(401, Send(h.Server.Port, "POST", "/add", body).Status);
        Assert.Empty(h.Received);
    }

    [Fact]
    public void เส้นทางที่ไม่รู้จักตอบ_404()
    {
        using var h = new Harness();
        Assert.Equal(404, Send(h.Server.Port, "GET", "/อะไรสักอย่าง", token: h.Server.Token).Status);
    }

    [Fact]
    public void token_อยู่ข้ามการเปิดแอปใหม่()
    {
        using var h = new Harness();
        var first = h.Server.Token;

        using var again = new BridgeServer(h.Paths, "9.9.9");
        Assert.Equal(first, again.Token);
    }

    [Fact]
    public void รีเซ็ต_token_แล้วของเดิมใช้ไม่ได้()
    {
        using var h = new Harness();
        var old = h.Server.Token;
        var fresh = h.Server.ResetToken();

        Assert.NotEqual(old, fresh);
        Assert.Equal(401, Send(h.Server.Port, "GET", "/ping", token: old).Status);
        Assert.Equal(200, Send(h.Server.Port, "GET", "/ping", token: fresh).Status);
    }
}
