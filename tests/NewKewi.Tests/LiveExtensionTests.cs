using NewKewi.Bridge;
using NewKewi.Core;
using NewKewi.Sites.Browser;

namespace NewKewi.Tests;

/// <summary>
/// เปิด Chromium จริงพร้อมส่วนขยายของแอป แล้วดูว่าแผงลอยเหนือวิดีโอโผล่จริงไหม
///
/// หน้าเว็บทดสอบเสิร์ฟจาก <see cref="MiniHttpServer"/> ของเราเองบน loopback
/// จะได้ไม่ต้องพึ่งเว็บภายนอกที่เปลี่ยนโครงหน้าเมื่อไรก็ได้ และได้วิดีโอขนาดที่คุมเองด้วย
/// </summary>
[Trait("Category", "live")]
public class LiveExtensionTests
{
    private const string TestPage = """
        <!doctype html>
        <html lang="th"><head><meta charset="utf-8"><title>หน้าทดสอบ</title>
        <style>body{margin:0;background:#111} video{width:640px;height:360px;display:block}</style>
        </head><body>
          <video id="v" width="640" height="360" controls muted
                 src="data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQ=="></video>
        </body></html>
        """;

    [Fact]
    public async Task แผงโหลดวิดีโอโผล่เหนือตัวเล่นจริง()
    {
        var repo = AppPaths.ForRunningApp();
        var extension = Path.Combine(repo.Root, "extension");
        Assert.True(File.Exists(Path.Combine(extension, "manifest.json")), "ไม่เจอโฟลเดอร์ส่วนขยาย");

        await new ChromiumInstaller(repo).EnsureAsync(null,
            new CancellationTokenSource(TimeSpan.FromMinutes(15)).Token);

        // เสิร์ฟหน้าทดสอบเองบน loopback
        using var site = new MiniHttpServer(_ => new HttpReply(200, TestPage, "text/html; charset=utf-8"));
        site.Start(0);

        var sandbox = Path.Combine(Path.GetTempPath(), "newkewi-ext-" + Guid.NewGuid().ToString("n")[..8]);
        var paths = new AppPaths(sandbox);
        paths.EnsureCreated();
        LinkChromium(repo.Chromium, paths.Chromium);

        try
        {
            var browser = new ChromiumBrowser(paths, new BrowserIdentity(paths),
                new BrowserOptions { AdBlockExtensionPath = extension });

            // เอาเมาส์ไปวางบนวิดีโอแล้วดูว่ามีแผงโผล่ไหม
            const string Probe = """
                (function () {
                  var marker = document.documentElement.dataset.newkewi || 'none';
                  var v = document.querySelector('video');
                  if (!v) return 'marker=' + marker + ';no-video';
                  v.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
                  var host = document.querySelector('.newkewi-panel-host');
                  return 'marker=' + marker + ';panel=' + (host ? host.style.display : 'none');
                })()
                """;

            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            var page = await browser.OpenAsync(
                $"http://127.0.0.1:{site.Port}/", BrowseMode.Silent, 25, Probe, cts.Token);

            Assert.Contains("marker=1", page.ProbeResult);     // content script ทำงานบนหน้านี้
            Assert.Contains("panel=block", page.ProbeResult);  // แผงโผล่จริงและแสดงอยู่
        }
        finally
        {
            TryDeleteTree(sandbox);
        }
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
