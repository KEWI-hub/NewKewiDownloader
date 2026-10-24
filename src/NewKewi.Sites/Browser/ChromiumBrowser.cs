using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using NewKewi.Core;

namespace NewKewi.Sites.Browser;

/// <summary>
/// Chromium พกพาที่แอปคุมเองผ่าน CDP
///
/// **ไม่แตะ profile หรือ cookie ของเบราว์เซอร์ผู้ใช้เลย** · ใช้ <c>_profile/</c> ของตัวเอง
/// cookie ที่ได้มาถูกเขียนลง <c>data/cookies.txt</c> ให้ yt-dlp ใช้ต่อ และลบทิ้งได้ทั้งก้อน
///
/// เปิด–ปิดใหม่ทุกครั้งที่เรียก ช้ากว่าเลี้ยงไว้แต่เชื่อถือได้กว่ามาก
/// (เบราว์เซอร์ค้างแล้วแอปค้างตามคือปัญหาที่แพงที่สุดของแอปเก่า)
/// </summary>
public sealed class ChromiumBrowser(AppPaths paths) : IBrowser
{
    private readonly SemaphoreSlim _oneAtATime = new(1, 1);

    public bool IsReady => File.Exists(paths.ChromeExe);

    public async Task<BrowsePage> OpenAsync(
        string url, BrowseMode mode, int waitSeconds, CancellationToken ct)
    {
        if (!IsReady)
            throw new InvalidOperationException("ยังไม่ได้ติดตั้ง Chromium พกพา");

        await _oneAtATime.WaitAsync(ct).ConfigureAwait(false);
        Process? chrome = null;
        try
        {
            var profile = mode == BrowseMode.Visible
                ? paths.BrowserProfile
                : paths.BrowserProfile + "-silent";
            Directory.CreateDirectory(profile);

            chrome = Launch(profile, mode);
            var port = await ReadDevToolsPortAsync(profile, ct).ConfigureAwait(false);
            var wsUrl = await FindBlankPageAsync(port, ct).ConfigureAwait(false);

            await using var cdp = await CdpSession.ConnectAsync(wsUrl, ct).ConfigureAwait(false);

            // เปิด Network ก่อนพาไปหน้าเว็บ ไม่งั้น request ชุดแรกจะหลุดไม่ถูกดัก
            await cdp.SendAsync("Network.enable", null, ct).ConfigureAwait(false);
            await cdp.SendAsync("Page.enable", null, ct).ConfigureAwait(false);

            await cdp.SendAsync("Page.navigate", new { url }, ct).ConfigureAwait(false);
            await cdp.WaitForEventAsync("Page.loadEventFired", waitSeconds, ct).ConfigureAwait(false);

            // ให้ JS ที่ทำงานหลัง load ได้ยิง request ของมันออกมาก่อน
            await Task.Delay(TimeSpan.FromSeconds(mode == BrowseMode.Visible ? 2 : 1), ct)
                .ConfigureAwait(false);

            var html = await EvaluateStringAsync(cdp, "document.documentElement.outerHTML", ct)
                .ConfigureAwait(false);
            var finalUrl = await EvaluateStringAsync(cdp, "location.href", ct).ConfigureAwait(false);

            await SaveCookiesAsync(cdp, ct).ConfigureAwait(false);

            return new BrowsePage(html, string.IsNullOrEmpty(finalUrl) ? url : finalUrl, cdp.Snapshot());
        }
        finally
        {
            Kill(chrome);
            _oneAtATime.Release();
        }
    }

    private Process Launch(string profile, BrowseMode mode)
    {
        var psi = new ProcessStartInfo
        {
            FileName = paths.ChromeExe,
            UseShellExecute = false,
            CreateNoWindow = mode == BrowseMode.Silent,
        };

        foreach (var a in new[]
                 {
                     "--remote-debugging-port=0",
                     "--user-data-dir=" + profile,
                     "--no-first-run",
                     "--no-default-browser-check",
                     "--disable-features=Translate,OptimizationHints",
                     "--disable-background-networking",
                     "--disable-sync",                 // ไม่มีบัญชีให้ซิงก์อยู่แล้ว
                     "--mute-audio",
                     "--window-size=1280,860",
                     "about:blank",
                 })
        {
            psi.ArgumentList.Add(a);
        }

        if (mode == BrowseMode.Silent)
        {
            psi.ArgumentList.Insert(0, "--headless=new");
            psi.ArgumentList.Insert(1, "--disable-gpu");
        }

        return Process.Start(psi)
            ?? throw new InvalidOperationException("เปิด Chromium ไม่ขึ้น");
    }

    /// <summary>Chromium เขียนพอร์ตจริงลงไฟล์ <c>DevToolsActivePort</c> ใน profile</summary>
    private static async Task<int> ReadDevToolsPortAsync(string profile, CancellationToken ct)
    {
        var file = Path.Combine(profile, "DevToolsActivePort");
        TryDelete(file);

        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            if (File.Exists(file))
            {
                try
                {
                    var first = File.ReadAllLines(file).FirstOrDefault();
                    if (int.TryParse(first, out var port) && port > 0) return port;
                }
                catch (IOException) { /* เขียนอยู่พอดี รออีกรอบ */ }
            }
            await Task.Delay(100, ct).ConfigureAwait(false);
        }
        throw new TimeoutException("Chromium ไม่บอกพอร์ต DevTools ภายใน 30 วินาที");
    }

    private static async Task<string> FindBlankPageAsync(int port, CancellationToken ct)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        var deadline = DateTime.UtcNow.AddSeconds(20);

        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var json = await http.GetStringAsync($"http://127.0.0.1:{port}/json/list", ct)
                    .ConfigureAwait(false);
                using var doc = JsonDocument.Parse(json);
                foreach (var t in doc.RootElement.EnumerateArray())
                {
                    if (t.TryGetProperty("type", out var type) && type.GetString() == "page" &&
                        t.TryGetProperty("webSocketDebuggerUrl", out var ws))
                        return ws.GetString()!;
                }
            }
            catch (HttpRequestException) { /* ยังไม่พร้อม */ }
            await Task.Delay(150, ct).ConfigureAwait(false);
        }
        throw new TimeoutException("หาแท็บของ Chromium ผ่าน DevTools ไม่เจอ");
    }

    private static async Task<string> EvaluateStringAsync(
        CdpSession cdp, string expression, CancellationToken ct)
    {
        try
        {
            var r = await cdp.SendAsync("Runtime.evaluate",
                new { expression, returnByValue = true }, ct).ConfigureAwait(false);

            if (r.TryGetProperty("result", out var res) && res.TryGetProperty("value", out var v))
                return v.GetString() ?? "";
        }
        catch (Exception ex) when (ex is InvalidOperationException or TimeoutException)
        {
            // หน้าเว็บเด้งไปที่อื่นระหว่างอ่าน → ได้ว่างดีกว่าทั้งงานล้ม
        }
        return "";
    }

    /// <summary>
    /// เขียน cookie ของ**แอปเอง**ลงไฟล์แบบ Netscape ให้ yt-dlp กินต่อได้
    /// ไฟล์นี้ลบได้ทั้งก้อนจากหน้าตั้งค่า และไม่เคยมี cookie ของเบราว์เซอร์ผู้ใช้ปนอยู่
    /// </summary>
    private async Task SaveCookiesAsync(CdpSession cdp, CancellationToken ct)
    {
        try
        {
            var r = await cdp.SendAsync("Network.getAllCookies", null, ct).ConfigureAwait(false);
            if (!r.TryGetProperty("cookies", out var cookies)) return;

            var sb = new StringBuilder();
            sb.AppendLine("# Netscape HTTP Cookie File");
            sb.AppendLine("# เขียนโดย New Kewi Video Downloader — cookie ของแอปเอง ไม่ใช่ของเบราว์เซอร์ผู้ใช้");

            foreach (var c in cookies.EnumerateArray())
            {
                var domain = Get(c, "domain");
                if (domain.Length == 0) continue;

                var expires = c.TryGetProperty("expires", out var e) && e.ValueKind == JsonValueKind.Number
                    ? (long)Math.Max(0, e.GetDouble())
                    : 0;

                sb.Append(domain).Append('\t')
                  .Append(domain.StartsWith('.') ? "TRUE" : "FALSE").Append('\t')
                  .Append(Get(c, "path") is { Length: > 0 } p ? p : "/").Append('\t')
                  .Append(c.TryGetProperty("secure", out var s) && s.GetBoolean() ? "TRUE" : "FALSE").Append('\t')
                  .Append(expires.ToString(CultureInfo.InvariantCulture)).Append('\t')
                  .Append(Get(c, "name")).Append('\t')
                  .Append(Get(c, "value")).Append('\n');
            }

            Directory.CreateDirectory(Path.GetDirectoryName(paths.CookieJar)!);
            await File.WriteAllTextAsync(paths.CookieJar, sb.ToString(),
                new UTF8Encoding(false), ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // เก็บ cookie ไม่ได้ก็ยังโหลดต่อได้ ไม่ควรทำให้ทั้งงานล้ม
        }
    }

    private static string Get(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) ? v.GetString() ?? "" : "";

    private static void Kill(Process? p)
    {
        if (p is null) return;
        try { if (!p.HasExited) p.Kill(entireProcessTree: true); }
        catch { /* ตายไปแล้วก็ดี */ }
        p.Dispose();
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { /* ช่างมัน */ }
    }
}
