using System.Net;

namespace NewKewi.Sites;

public sealed record WebResponse(int Status, string Body, string FinalUrl)
{
    public bool Ok => Status is >= 200 and < 300;
}

/// <summary>
/// ตัวยิง HTTP ที่ Lua เรียกผ่าน <c>http.Get</c> / <c>http.Post</c>
/// เป็น interface เพื่อให้เทสสวมตัวปลอมได้ — เทส Lua module จะได้ไม่ต้องพึ่งเน็ตจริง
/// </summary>
public interface IWebClient
{
    WebResponse Get(string url, IReadOnlyDictionary<string, string> headers, CancellationToken ct);

    WebResponse Post(string url, IReadOnlyDictionary<string, string> headers,
        IReadOnlyDictionary<string, string> form, CancellationToken ct);
}

/// <summary>
/// ตัวจริง · ถือ cookie ไว้ใน container **ของแอปเอง** ไม่เคยอ่าน cookie ของเบราว์เซอร์ผู้ใช้
/// </summary>
public sealed class WebClient : IWebClient, IDisposable
{
    public const string DefaultUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

    private readonly HttpClient _http;

    public WebClient(TimeSpan? timeout = null)
    {
        Cookies = new CookieContainer();
        var handler = new HttpClientHandler
        {
            CookieContainer = Cookies,
            AllowAutoRedirect = true,
            AutomaticDecompression = DecompressionMethods.All,
            UseCookies = true,
        };
        _http = new HttpClient(handler) { Timeout = timeout ?? TimeSpan.FromSeconds(30) };
    }

    /// <summary>cookie ที่แอปเก็บเอง — ล้างทิ้งได้ทั้งก้อนจากหน้าตั้งค่า</summary>
    public CookieContainer Cookies { get; }

    public WebResponse Get(string url, IReadOnlyDictionary<string, string> headers, CancellationToken ct)
        => Send(new HttpRequestMessage(HttpMethod.Get, url), headers, ct);

    public WebResponse Post(string url, IReadOnlyDictionary<string, string> headers,
        IReadOnlyDictionary<string, string> form, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new FormUrlEncodedContent(form.Select(p => new KeyValuePair<string, string>(p.Key, p.Value))),
        };
        return Send(req, headers, ct);
    }

    private WebResponse Send(HttpRequestMessage req, IReadOnlyDictionary<string, string> headers, CancellationToken ct)
    {
        req.Headers.TryAddWithoutValidation("User-Agent", DefaultUserAgent);
        req.Headers.TryAddWithoutValidation("Accept-Language", "en-US,en;q=0.9,th;q=0.8");

        foreach (var (k, v) in headers)
        {
            if (!req.Headers.TryAddWithoutValidation(k, v))
                req.Content?.Headers.TryAddWithoutValidation(k, v);
        }

        try
        {
            // Lua เป็นโค้ดซิงโครนัส จึงต้องรอตรงนี้
            // ตัว resolver ถูกเรียกจาก thread พื้นหลังอยู่แล้ว ไม่ได้บล็อก UI
            using var res = _http.Send(req, HttpCompletionOption.ResponseContentRead, ct);
            var body = res.Content.ReadAsStringAsync(ct).GetAwaiter().GetResult();
            return new WebResponse((int)res.StatusCode, body,
                res.RequestMessage?.RequestUri?.ToString() ?? req.RequestUri!.ToString());
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            return new WebResponse(0, "", req.RequestUri!.ToString());
        }
    }

    public void Dispose() => _http.Dispose();
}
