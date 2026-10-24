using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NewKewi.Core;

namespace NewKewi.Bridge;

/// <summary>ลิงก์ที่ส่วนขยายในเบราว์เซอร์ส่งเข้ามา</summary>
public sealed record IncomingLink(
    string Url,
    string? Title,
    string? PageUrl,
    string? Referer,
    int Height,
    string? Kind,
    IReadOnlyDictionary<string, string> Headers);

/// <summary>
/// ช่องทางที่ส่วนขยายในเบราว์เซอร์คุยกับแอป
///
/// **ความปลอดภัย** — ของที่เปิดพอร์ตไว้ต้องคิดเรื่องนี้ให้ครบ:
/// <list type="bullet">
/// <item>ฟังเฉพาะ 127.0.0.1 เครื่องอื่นในวงแลนต่อไม่ได้</item>
/// <item>ทุกคำขอต้องมี token ที่สุ่มตอนติดตั้ง · หน้าเว็บทั่วไปไม่มีทางรู้</item>
/// <item>ต้องมีหัว <c>X-NewKewi: 1</c> ด้วย ซึ่งฟอร์ม HTML ธรรมดาส่งไม่ได้
///       (ต้องผ่าน CORS preflight ก่อน) จึงกัน CSRF จากหน้าเว็บที่ผู้ใช้เปิดอยู่</item>
/// <item>การขอ token ครั้งแรกต้องให้ผู้ใช้กดอนุญาตในแอปเอง</item>
/// </list>
/// </summary>
public sealed class BridgeServer : IDisposable
{
    /// <summary>ของเดิม YtdlpGUI ใช้ 47777 · เปลี่ยนเลขกันชนกับแอปเก่าที่อาจยังติดตั้งอยู่</summary>
    public const int DefaultPort = 47800;

    private readonly string _tokenFile;
    private readonly string _appVersion;
    private readonly MiniHttpServer _http;
    private DateTime _lastPairAttempt = DateTime.MinValue;

    public BridgeServer(AppPaths paths, string appVersion)
    {
        _tokenFile = Path.Combine(paths.Data, "bridge-token.txt");
        _appVersion = appVersion;
        Token = LoadOrCreateToken();
        _http = new MiniHttpServer(Handle);
    }

    /// <summary>token ที่ต้องแนบมากับทุกคำขอ · โชว์ในหน้าตั้งค่าได้</summary>
    public string Token { get; private set; }

    public int Port => _http.Port;

    /// <summary>
    /// ส่วนขยายขอเชื่อมต่อครั้งแรก · คืน true เพื่ออนุญาต
    /// แอปเป็นคนถามผู้ใช้ — ห้ามอนุญาตเองเงียบๆ
    /// </summary>
    public Func<string, bool>? PairRequested { get; set; }

    /// <summary>ได้รับลิงก์จากส่วนขยาย</summary>
    public Action<IncomingLink>? LinkReceived { get; set; }

    public void Start(int port = DefaultPort) => _http.Start(port);

    /// <summary>สร้าง token ใหม่ · ส่วนขยายที่เคยจับคู่ไว้จะต้องจับคู่ใหม่</summary>
    public string ResetToken()
    {
        Token = NewToken();
        File.WriteAllText(_tokenFile, Token, new UTF8Encoding(false));
        return Token;
    }

    private HttpReply Handle(HttpRequestLine req)
    {
        if (req.Method == "OPTIONS") return new HttpReply(204, "");

        var path = req.Path.Split('?')[0].TrimEnd('/');
        if (path.Length == 0) path = "/";

        return path switch
        {
            "/pair" => HandlePair(req),
            "/ping" => RequireToken(req) ?? HttpReply.Json(
                $$"""{"app":"NewKewiDownloader","version":"{{_appVersion}}"}"""),
            "/add" => RequireToken(req) ?? HandleAdd(req),
            _ => HttpReply.Text(404, "ไม่มีเส้นทางนี้"),
        };
    }

    /// <summary>คืน null = ผ่าน · คืน reply = ปฏิเสธ</summary>
    private HttpReply? RequireToken(HttpRequestLine req)
    {
        // หัวนี้ส่งจากฟอร์ม HTML ธรรมดาไม่ได้ ต้องผ่าน preflight ของ CORS ก่อน
        if (!req.Headers.TryGetValue("X-NewKewi", out var mark) || mark != "1")
            return HttpReply.Text(403, "คำขอนี้ไม่ได้มาจากส่วนขยายของแอป");

        if (!req.Headers.TryGetValue("X-NewKewi-Token", out var token) || !TokenMatches(token))
            return HttpReply.Text(401, "token ไม่ถูกต้อง — ต้องจับคู่ส่วนขยายกับแอปใหม่");

        return null;
    }

    /// <summary>เทียบแบบใช้เวลาคงที่ กันการเดา token ทีละตัวอักษร</summary>
    private bool TokenMatches(string given)
    {
        var a = Encoding.UTF8.GetBytes(given ?? "");
        var b = Encoding.UTF8.GetBytes(Token);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    private HttpReply HandlePair(HttpRequestLine req)
    {
        if (req.Method != "POST") return HttpReply.Text(400, "ต้องเป็น POST");

        // กันการถามซ้ำรัวๆ จนผู้ใช้เผลอกดอนุญาต
        if (DateTime.UtcNow - _lastPairAttempt < TimeSpan.FromSeconds(10))
            return HttpReply.Text(429, "ขอถี่เกินไป รออีกสักครู่");
        _lastPairAttempt = DateTime.UtcNow;

        var name = ReadString(req.Body, "name") ?? "ส่วนขยายที่ไม่ระบุชื่อ";

        // ไม่มีคนรับเรื่อง = ไม่อนุญาต · ห้าม default เป็นอนุญาตเด็ดขาด
        var allowed = PairRequested?.Invoke(name) ?? false;
        if (!allowed) return HttpReply.Text(403, "ผู้ใช้ไม่อนุญาต");

        return HttpReply.Json($$"""{"token":"{{Token}}"}""");
    }

    private HttpReply HandleAdd(HttpRequestLine req)
    {
        if (req.Method != "POST") return HttpReply.Text(400, "ต้องเป็น POST");

        JsonElement root;
        try
        {
            using var doc = JsonDocument.Parse(req.Body);
            root = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return HttpReply.Text(400, "เนื้อหาไม่ใช่ JSON");
        }

        var url = Str(root, "url");
        if (string.IsNullOrWhiteSpace(url) ||
            !Uri.TryCreate(url, UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
        {
            return HttpReply.Text(400, "url ต้องเป็น http หรือ https");
        }

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (root.TryGetProperty("headers", out var h) && h.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in h.EnumerateObject())
            {
                // ไม่รับ Cookie จากส่วนขยาย — แอปใช้ cookie ของตัวเองเท่านั้น
                if (p.Name.Equals("Cookie", StringComparison.OrdinalIgnoreCase)) continue;
                headers[p.Name] = p.Value.ToString();
            }
        }

        LinkReceived?.Invoke(new IncomingLink(
            url!,
            Str(root, "title"),
            Str(root, "pageUrl"),
            Str(root, "referer"),
            root.TryGetProperty("height", out var hv) && hv.TryGetInt32(out var height) ? height : 0,
            Str(root, "kind"),
            headers));

        return HttpReply.Json("""{"ok":true}""");
    }

    private static string? Str(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string? ReadString(string json, string name)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return Str(doc.RootElement, name);
        }
        catch (JsonException) { return null; }
    }

    private string LoadOrCreateToken()
    {
        try
        {
            if (File.Exists(_tokenFile))
            {
                var saved = File.ReadAllText(_tokenFile, Encoding.UTF8).Trim('﻿', ' ', '\r', '\n');
                if (saved.Length >= 32) return saved;
            }
        }
        catch (IOException) { /* อ่านไม่ได้ก็สร้างใหม่ */ }

        var token = NewToken();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_tokenFile)!);
            File.WriteAllText(_tokenFile, token, new UTF8Encoding(false));
        }
        catch (IOException) { /* เขียนไม่ได้ก็ใช้ในหน่วยความจำรอบนี้ไปก่อน */ }
        return token;
    }

    private static string NewToken()
        => Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

    public void Dispose() => _http.Dispose();
}
