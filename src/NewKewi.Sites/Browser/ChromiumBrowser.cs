using System.Diagnostics;
using System.Text.Json;
using NewKewi.Core;

namespace NewKewi.Sites.Browser;

public sealed record BrowserOptions
{
    /// <summary>โฟลเดอร์ส่วนขยายกันโฆษณาที่จะเสียบเข้า Chromium · ว่าง = ไม่โหลด</summary>
    public string? AdBlockExtensionPath { get; init; }

    /// <summary>รอให้ผู้ใช้กดผ่านด่านกันบอทนานสุดกี่วินาที (โหมดมีหน้าต่าง)</summary>
    public int BotWallWaitSeconds { get; init; } = 180;
}

/// <summary>
/// Chromium พกพาที่แอปคุมเองผ่าน CDP
///
/// **ไม่แตะ profile หรือ cookie ของเบราว์เซอร์ผู้ใช้เลย** · ใช้ <c>_profile/</c> ของตัวเอง
/// cookie ที่ได้มาถูกเขียนลง <c>data/cookies.txt</c> ให้ yt-dlp ใช้ต่อ และลบทิ้งได้ทั้งก้อน
///
/// เปิด–ปิดใหม่ทุกครั้งที่เรียก ช้ากว่าเลี้ยงไว้แต่เชื่อถือได้กว่ามาก
/// (เบราว์เซอร์ค้างแล้วแอปค้างตามคือปัญหาที่แพงที่สุดของแอปเก่า)
/// </summary>
public sealed class ChromiumBrowser(
    AppPaths paths,
    BrowserIdentity identity,
    BrowserOptions? options = null) : IBrowser
{
    private readonly BrowserOptions _options = options ?? new BrowserOptions();
    private readonly SemaphoreSlim _oneAtATime = new(1, 1);

    public bool IsReady => File.Exists(paths.ChromeExe);

    /// <summary>เรียกเมื่อเปิดหน้าต่างให้ผู้ใช้กดผ่านด่านกันบอท — แอปเอาไปขึ้นข้อความบอก</summary>
    public Action<string>? OnNotice { get; set; }

    public async Task<BrowsePage> OpenAsync(
        string url, BrowseMode mode, int waitSeconds, CancellationToken ct)
    {
        if (!IsReady)
            throw new InvalidOperationException("ยังไม่ได้ติดตั้ง Chromium พกพา");

        await _oneAtATime.WaitAsync(ct).ConfigureAwait(false);
        Process? chrome = null;
        try
        {
            // แยก profile ของสองโหมด เพราะเปิดพร้อมกันไม่ได้ (Chromium ล็อกโฟลเดอร์ไว้)
            // ทั้งคู่อยู่ใต้ _profile/ เพื่อให้ .gitignore บรรทัดเดียวครอบได้หมด
            var profile = mode == BrowseMode.Visible ? paths.VisibleProfile : paths.SilentProfile;
            Directory.CreateDirectory(profile);

            chrome = Launch(profile, mode);
            var port = await ReadDevToolsPortAsync(profile, ct).ConfigureAwait(false);
            var wsUrl = await FindBlankPageAsync(port, ct).ConfigureAwait(false);

            await using var cdp = await CdpSession.ConnectAsync(wsUrl, ct).ConfigureAwait(false);

            // เปิด Network ก่อนพาไปหน้าเว็บ ไม่งั้น request ชุดแรกจะหลุดไม่ถูกดัก
            await cdp.SendAsync("Network.enable", null, ct).ConfigureAwait(false);
            await cdp.SendAsync("Page.enable", null, ct).ConfigureAwait(false);

            // จำ UA ไว้ให้ HttpClient กับ yt-dlp ใช้ตัวเดียวกัน — จำเป็นกับ cf_clearance
            var ua = await EvaluateStringAsync(cdp, "navigator.userAgent", ct).ConfigureAwait(false);
            identity.Set(ua);

            await cdp.SendAsync("Page.navigate", new { url }, ct).ConfigureAwait(false);
            await cdp.WaitForEventAsync("Page.loadEventFired", waitSeconds, ct).ConfigureAwait(false);

            // ให้ JS ที่ทำงานหลัง load ได้ยิง request ของมันออกมาก่อน
            await Task.Delay(TimeSpan.FromSeconds(mode == BrowseMode.Visible ? 2 : 1), ct)
                .ConfigureAwait(false);

            var html = await EvaluateStringAsync(cdp, "document.documentElement.outerHTML", ct)
                .ConfigureAwait(false);

            if (mode == BrowseMode.Visible && BotWall.Detect(html, 200))
                html = await WaitForHumanAsync(cdp, url, ct).ConfigureAwait(false);

            var finalUrl = await EvaluateStringAsync(cdp, "location.href", ct).ConfigureAwait(false);
            await SaveCookiesAsync(cdp, ct).ConfigureAwait(false);

            var adBlockActive = await IsAdBlockActiveAsync(cdp, ct).ConfigureAwait(false);

            return new BrowsePage(html, string.IsNullOrEmpty(finalUrl) ? url : finalUrl,
                cdp.Snapshot(), ua, adBlockActive);
        }
        finally
        {
            Kill(chrome);
            _oneAtATime.Release();
        }
    }

    /// <summary>
    /// รอให้ **ผู้ใช้** กดผ่านด่านกันบอทในหน้าต่างที่เปิดอยู่
    ///
    /// แอปไม่ได้แก้โจทย์ให้ — มันแค่เปิดเบราว์เซอร์จริงค้างไว้ แล้วคอยดูว่าหน้าเปลี่ยนไปหรือยัง
    /// ผ่านแล้วค่อยเก็บ cookie ที่ได้ไปใช้ต่อ
    /// </summary>
    private async Task<string> WaitForHumanAsync(CdpSession cdp, string url, CancellationToken ct)
    {
        OnNotice?.Invoke($"เว็บ {HostOf(url)} กันบอทอยู่ — กดยืนยันในหน้าต่างที่เปิดขึ้นมา แล้วแอปจะไปต่อเอง");

        var deadline = DateTime.UtcNow.AddSeconds(_options.BotWallWaitSeconds);
        var html = "";

        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Delay(1500, ct).ConfigureAwait(false);

            html = await EvaluateStringAsync(cdp, "document.documentElement.outerHTML", ct)
                .ConfigureAwait(false);

            if (html.Length > 0 && !BotWall.Detect(html, 200))
            {
                OnNotice?.Invoke("ผ่านด่านแล้ว กำลังไปต่อ");
                // ให้หน้าจริงโหลดเสร็จและยิง request ของมันออกมาก่อน
                await Task.Delay(2500, ct).ConfigureAwait(false);
                return await EvaluateStringAsync(cdp, "document.documentElement.outerHTML", ct)
                    .ConfigureAwait(false);
            }
        }

        OnNotice?.Invoke($"รอจนหมดเวลาแล้วยังผ่านด่านของ {HostOf(url)} ไม่ได้");
        return html;
    }

    private Process Launch(string profile, BrowseMode mode)
    {
        var psi = new ProcessStartInfo
        {
            FileName = paths.ChromeExe,
            UseShellExecute = false,
            CreateNoWindow = mode == BrowseMode.Silent,
        };

        var args = new List<string>();
        if (mode == BrowseMode.Silent)
        {
            args.Add("--headless=new");
            args.Add("--disable-gpu");
        }

        args.AddRange(
        [
            "--remote-debugging-port=0",
            "--user-data-dir=" + profile,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-features=Translate,OptimizationHints",
            "--disable-background-networking",
            "--disable-sync",
            "--mute-audio",
            "--window-size=1280,860",
        ]);

        // ส่วนขยายกันโฆษณา · ทำให้หน้าเว็บที่เต็มไปด้วย popup แกะลิงก์ได้สะอาดกว่ามาก
        // และตอนผู้ใช้ต้องกดผ่านด่านเอง จะได้ไม่มีโฆษณามาเด้งทับ
        var ext = _options.AdBlockExtensionPath;
        if (!string.IsNullOrWhiteSpace(ext) && Directory.Exists(ext))
        {
            args.Add("--disable-extensions-except=" + ext);
            args.Add("--load-extension=" + ext);
        }

        args.Add("about:blank");
        foreach (var a in args) psi.ArgumentList.Add(a);

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
    /// ส่วนขยายกันโฆษณาทำงานอยู่จริงไหม
    ///
    /// ดูจากร่องรอยที่ <c>page-world.js</c> ทิ้งไว้: มันล็อก <c>window.open</c> ให้เขียนทับไม่ได้
    /// เช็คแบบนี้เชื่อถือได้กว่าการดูว่า Chromium รับธง --load-extension ไปหรือยัง
    /// เพราะส่วนขยายที่ manifest พังจะโหลดไม่ขึ้นโดยไม่มี error ให้เห็น
    /// </summary>
    private async Task<bool> IsAdBlockActiveAsync(CdpSession cdp, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_options.AdBlockExtensionPath)) return false;

        var answer = await EvaluateStringAsync(cdp,
            "String(Object.getOwnPropertyDescriptor(window, 'open')?.writable === false)", ct)
            .ConfigureAwait(false);

        return answer == "true";
    }

    /// <summary>เขียน cookie ของ**แอปเอง**ลงไฟล์แบบ Netscape ให้ yt-dlp กินต่อได้</summary>
    private async Task SaveCookiesAsync(CdpSession cdp, CancellationToken ct)
    {
        try
        {
            var r = await cdp.SendAsync("Network.getAllCookies", null, ct).ConfigureAwait(false);
            if (!r.TryGetProperty("cookies", out var cookies)) return;

            var records = new List<CookieRecord>();
            foreach (var c in cookies.EnumerateArray())
            {
                var expires = c.TryGetProperty("expires", out var e) && e.ValueKind == JsonValueKind.Number
                    ? (long)Math.Max(0, e.GetDouble())
                    : 0;

                records.Add(new CookieRecord(
                    Get(c, "domain"), Get(c, "path"), Get(c, "name"), Get(c, "value"),
                    c.TryGetProperty("secure", out var s) && s.GetBoolean(), expires));
            }

            NetscapeCookieFile.Write(paths.CookieJar, records);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // เก็บ cookie ไม่ได้ก็ยังโหลดต่อได้ ไม่ควรทำให้ทั้งงานล้ม
        }
    }

    private static string Get(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) ? v.GetString() ?? "" : "";

    private static string HostOf(string url)
        => Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host : url;

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
