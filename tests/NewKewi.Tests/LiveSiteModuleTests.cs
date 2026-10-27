using NewKewi.Core;
using NewKewi.Sites;

namespace NewKewi.Tests;

/// <summary>
/// ยิง module ที่ส่งจริงใส่เว็บจริง
///
/// ไม่รันในชุดปกติ · ผลขึ้นกับว่าเว็บยังเหมือนเดิมไหม ณ วันนั้น
/// สั่งเองด้วยการตั้ง NEWKEWI_SITE_URL เป็นลิงก์ที่จะลอง
/// </summary>
[Trait("Category", "live")]
public class LiveSiteModuleTests
{
    [Fact]
    public void แกะลิงก์จากเว็บจริงด้วย_module_ที่ส่งจริง()
    {
        var url = Environment.GetEnvironmentVariable("NEWKEWI_SITE_URL");
        if (string.IsNullOrWhiteSpace(url)) return;   // ไม่ได้สั่งลอง ก็ไม่ต้องทำอะไร

        var repo = AppPaths.ForRunningApp();
        var registry = new SiteRegistry(new AppPathsView(repo.LuaModules, repo.LocalModules));
        registry.Load();
        Assert.Empty(registry.LoadErrors.Select(e => $"{Path.GetFileName(e.File)}: {e.Error}"));

        var identity = new BrowserIdentity(repo);
        using var web = new NewKewi.Sites.WebClient(TimeSpan.FromSeconds(40), repo.CookieJar, identity);

        var result = new LuaResolver(registry, web).Resolve(url, CancellationToken.None);

        // ให้ข้อความของ module ติดมากับความล้มเหลวด้วย ไม่งั้นไล่ปัญหาไม่ถูก
        var trace = string.Join(" | ", result.Log);
        Assert.True(result.Handled, "ไม่มี module ไหนรับโดเมนนี้");
        Assert.True(result.Ok, $"error={result.Error} · log={trace}");

        Assert.NotEmpty(result.Streams);
        Assert.StartsWith("http", result.Streams[0].Url);
    }
}
