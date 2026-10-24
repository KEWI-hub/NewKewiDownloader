using System.Text;
using NewKewi.Core;
using NewKewi.Sites;
using NewKewi.Sites.Browser;

namespace NewKewi.Tests;

/// <summary>
/// สำรวจว่าเว็บเป้าหมายกันบอทอยู่จริงไหม และชั้นไหนผ่านได้
///
/// ไม่ใช่เทสที่ "ผ่าน/ไม่ผ่าน" — เป็นเครื่องมือสำรวจ เขียนรายงานลงไฟล์แล้วให้คนอ่านเอง
/// เพราะผลขึ้นกับว่าเว็บตั้งค่ากันบอทไว้ยังไง ณ วันนั้น จะเอามาเป็นเงื่อนไข pass/fail ไม่ได้
///
/// รายชื่อเว็บมาจากตัวแปรแวดล้อม NEWKEWI_PROBE_URLS (คั่นด้วยเครื่องหมายจุลภาค)
/// เปิดหน้าต่างให้คนกดเองไม่ได้ในโหมดนี้ เพราะไม่มีใครนั่งเฝ้า
/// </summary>
[Trait("Category", "live")]
public class LiveBotWallProbe
{
    [Fact]
    public async Task สำรวจด่านกันบอทของเว็บที่กำหนด()
    {
        var raw = Environment.GetEnvironmentVariable("NEWKEWI_PROBE_URLS");
        if (string.IsNullOrWhiteSpace(raw)) return;   // ไม่ได้สั่งสำรวจ ก็ไม่ต้องทำอะไร

        var urls = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var repo = AppPaths.ForRunningApp();
        var identity = new BrowserIdentity(repo);

        using var web = new NewKewi.Sites.WebClient(TimeSpan.FromSeconds(30), repo.CookieJar, identity);
        var browser = new ChromiumBrowser(repo, identity, new BrowserOptions
        {
            AdBlockExtensionPath = AdSkipper(repo),
        });
        var fetcher = new PageFetcher(web, browser);

        var report = new StringBuilder();
        report.AppendLine("# ผลสำรวจด่านกันบอท " + DateTime.Now.ToString("yyyy-MM-dd HH:mm"));
        report.AppendLine();
        report.AppendLine("| เว็บ | ชั้น 1 (HttpClient) | ชั้น 2 (Chromium เงียบ) | สรุป |");
        report.AppendLine("|---|---|---|---|");

        foreach (var url in urls)
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(3));
            string layer1, layer2 = "—", verdict;

            try
            {
                var simple = fetcher.Simple(url, cts.Token);
                var walled1 = BotWall.Detect(simple.Html, simple.Status);
                layer1 = $"{simple.Status} · {simple.Html.Length} ไบต์ · {(walled1 ? "**ติดด่าน**" : "ผ่าน")}";

                if (!walled1 && simple.Html.Length > 0)
                {
                    verdict = "ชั้น 1 พอ";
                }
                else if (!browser.IsReady)
                {
                    verdict = "ยังไม่ได้ติดตั้ง Chromium";
                }
                else
                {
                    var silent = await fetcher.BrowserAsync(url, BrowseMode.Silent, 30, cts.Token);
                    var walled2 = BotWall.Detect(silent.Html, 200);
                    layer2 = $"{silent.Html.Length} ไบต์ · {(walled2 ? "**ยังติดด่าน**" : "ผ่าน")}";
                    verdict = walled2 ? "ต้องให้คนกดเอง (ชั้น 3)" : "ชั้น 2 ผ่านเอง";
                }
            }
            catch (Exception ex)
            {
                layer1 = "พัง";
                verdict = ex.GetType().Name + ": " + ex.Message.Split('\n')[0];
            }

            report.AppendLine($"| {Host(url)} | {layer1} | {layer2} | {verdict} |");
        }

        var outFile = Environment.GetEnvironmentVariable("NEWKEWI_PROBE_OUT")
                      ?? Path.Combine(Path.GetTempPath(), "newkewi-botwall-probe.md");
        await File.WriteAllTextAsync(outFile, report.ToString(), new UTF8Encoding(false));
    }

    private static string? AdSkipper(AppPaths repo)
    {
        var p = Path.GetFullPath(Path.Combine(repo.Root, "..", "video-ad-skipper"));
        return File.Exists(Path.Combine(p, "manifest.json")) ? p : null;
    }

    private static string Host(string url)
        => Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host : url;
}
