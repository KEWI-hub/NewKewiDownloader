using NewKewi.Core;
using NewKewi.Sites;
using NewKewi.Sites.Browser;

namespace NewKewi.Tests;

/// <summary>
/// เทสที่เปิด Chromium จริงและยิงเน็ตจริง
/// ไม่รันในชุดปกติ · สั่งเองด้วย dotnet test พร้อมธง filter เป็น Category=live
///
/// ใช้ <c>_chromium/</c> ของโปรเจกต์จริง (ครั้งแรกจะโหลดมาราว 150 MB)
/// แต่ profile กับ cookie ชี้ไปโฟลเดอร์ชั่วคราวของเทส
/// </summary>
[Trait("Category", "live")]
public class LiveBrowserTests
{
    private static AppPaths RepoPaths() => AppPaths.ForRunningApp();

    [Fact]
    public async Task ติดตั้ง_chromium_พกพาได้จริง()
    {
        var paths = RepoPaths();
        var installer = new ChromiumInstaller(paths);

        var steps = new List<string>();
        var exe = await installer.EnsureAsync(
            new Progress<string>(s => steps.Add(s)),
            new CancellationTokenSource(TimeSpan.FromMinutes(15)).Token);

        Assert.True(File.Exists(exe), "ติดตั้งแล้วแต่ไม่เจอ chrome.exe");
        Assert.True(installer.IsInstalled);
    }

    [Fact]
    public async Task เปิดหน้าเว็บจริงแล้วได้_DOM_หลังรัน_JS_พร้อมดัก_request()
    {
        var repo = RepoPaths();
        await new ChromiumInstaller(repo).EnsureAsync(null,
            new CancellationTokenSource(TimeSpan.FromMinutes(15)).Token);

        // profile กับ cookie ของเทสอยู่ในโฟลเดอร์ชั่วคราว ไม่ไปทับของจริง
        var sandbox = Path.Combine(Path.GetTempPath(), "newkewi-browse-" + Guid.NewGuid().ToString("n")[..8]);
        var paths = new AppPaths(sandbox);
        paths.EnsureCreated();
        Directory.CreateDirectory(Path.Combine(sandbox, "_chromium"));
        // ชี้ไปที่ chromium ของจริงด้วย junction แทนการก๊อป 400 MB
        LinkChromium(repo.Chromium, paths.Chromium);

        try
        {
            var browser = new ChromiumBrowser(paths, new BrowserIdentity(paths),
                new BrowserOptions { AdBlockExtensionPath = AdSkipperPath() });
            Assert.True(browser.IsReady, "ควรเจอ chrome.exe ผ่าน junction");

            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            var page = await browser.OpenAsync("https://www.wikipedia.org/", BrowseMode.Silent, 25, cts.Token);

            Assert.Contains("<html", page.Html, StringComparison.OrdinalIgnoreCase);
            Assert.True(page.Html.Length > 2000, $"DOM สั้นผิดปกติ ({page.Html.Length} ตัวอักษร)");
            Assert.NotEmpty(page.Requests);
            Assert.True(File.Exists(paths.CookieJar), "ควรเขียน cookies.txt ของแอปเอง");

            // UA ต้องถูกจำไว้ ไม่งั้น cookie ที่ฝ่าด่านมาได้จะใช้กับ yt-dlp ไม่ได้
            Assert.Contains("Chrome/", page.UserAgent);
            Assert.Equal(page.UserAgent, new BrowserIdentity(paths).UserAgent);

            if (AdSkipperPath() is not null)
                Assert.True(page.AdBlockActive, "เสียบส่วนขยายแล้วแต่มันไม่ได้ทำงานบนหน้าเว็บ");
        }
        finally
        {
            TryDeleteTree(sandbox);
        }
    }

    [Fact]
    public async Task generic_resolver_หาไฟล์วิดีโอในหน้าเว็บจริงเจอ()
    {
        using var web = new NewKewi.Sites.WebClient(TimeSpan.FromSeconds(30));
        var browser = new FakeBrowser { IsReady = false };   // ข้อนี้ไม่ต้องใช้เบราว์เซอร์
        var resolver = new GenericResolver(new PageFetcher(web, browser), web, browser);

        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
        var r = await resolver.ResolveAsync("https://www.w3schools.com/html/html5_video.asp", cts.Token);

        Assert.True(r.Ok, r.Error);
        Assert.Contains(r.Streams, s => s.Url.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// ส่วนขยายกันโฆษณาวางอยู่ข้างๆ repo นี้ (<c>..\video-ad-skipper</c>)
    /// ไม่มีก็คืน null แล้วเทสจะข้ามการตรวจส่วนนั้นไป
    /// </summary>
    private static string? AdSkipperPath()
    {
        var sibling = Path.GetFullPath(Path.Combine(RepoPaths().Root, "..", "video-ad-skipper"));
        return File.Exists(Path.Combine(sibling, "manifest.json")) ? sibling : null;
    }

    private static void LinkChromium(string source, string target)
    {
        if (Directory.Exists(target)) Directory.Delete(target, recursive: true);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);

        var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c mklink /J \"{target}\" \"{source}\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        });
        p!.WaitForExit();
    }

    private static void TryDeleteTree(string path)
    {
        // ลบ junction ก่อน ไม่งั้นจะเผลอลบ chromium ตัวจริงตาม
        try
        {
            var link = Path.Combine(path, "_chromium");
            if (Directory.Exists(link)) Directory.Delete(link);
        }
        catch { /* ช่างมัน */ }

        try { Directory.Delete(path, recursive: true); } catch { /* ช่างมัน */ }
    }
}
