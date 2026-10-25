using System.Formats.Tar;
using System.IO.Compression;
using System.Text;
using NewKewi.Core;
using NewKewi.Core.Engine;
using NewKewi.Core.GitHub;
using NewKewi.Core.Models;
using NewKewi.Sites;

namespace NewKewi.Tests;

/// <summary>GitHub ปลอม · เทสจะได้ไม่ต้องมี token และไม่ไปแตะ repo จริง</summary>
public sealed class FakeGitHubClient : IGitHubClient
{
    public string? BranchSha { get; set; }
    public string? TarballSource { get; set; }
    public List<(string Repo, string Path, string Content)> Written { get; } = [];
    public GitHubResult PutResult { get; set; } = new(true);

    public Task<string?> GetBranchShaAsync(string repo, string branch, CancellationToken ct)
        => Task.FromResult(BranchSha);

    public Task<string?> DownloadTarballAsync(string repo, string reference, string targetFile, CancellationToken ct)
    {
        if (TarballSource is null) return Task.FromResult<string?>(null);
        Directory.CreateDirectory(Path.GetDirectoryName(targetFile)!);
        File.Copy(TarballSource, targetFile, overwrite: true);
        return Task.FromResult<string?>(targetFile);
    }

    public Task<GitHubResult> PutFileAsync(
        string repo, string path, string content, string commitMessage, CancellationToken ct)
    {
        if (PutResult.Ok) Written.Add((repo, path, content));
        return Task.FromResult(PutResult);
    }
}

public class DiagnosticTests
{
    [Fact]
    public void ไม่ส่ง_url_เต็ม_ส่งแค่_hash_กับ_path()
    {
        var report = DiagnosticBuilder.Build(
            "https://site.example/movie/abc123?token=ลับมาก&user=42",
            "หาลิงก์ไม่เจอ", ["fetch:Simple status=403"], "1.0.0");

        Assert.Equal("site.example", report.Host);
        Assert.Equal("/movie/abc123", report.UrlPath);
        Assert.Equal(64, report.UrlHash.Length);

        var all = report.UrlPath + report.Reason + string.Join(" ", report.Trail);
        Assert.DoesNotContain("token=", all);
        Assert.DoesNotContain("ลับมาก", all);
        Assert.DoesNotContain("user=42", all);
    }

    [Theory]
    [InlineData("https://cdn/x.m3u8?key=abc123", "key=abc123")]
    [InlineData("session=เซสชันของฉัน", "เซสชันของฉัน")]
    [InlineData("Cookie=sid=12345", "12345")]
    [InlineData("signature=deadbeef", "deadbeef")]
    public void ค่าที่หน้าตาเป็นความลับถูกตัดออก(string input, string secret)
        => Assert.DoesNotContain(secret, DiagnosticBuilder.Scrub(input));

    [Fact]
    public void path_ในไฟล์ที่จะเขียนบน_repo_ถูกรูปแบบ()
    {
        var report = DiagnosticBuilder.Build("https://site.example/a/b", null, null, "1.0.0");

        Assert.StartsWith("needs-config/site.example/", report.RepoPath);
        Assert.EndsWith(".json", report.RepoPath);
    }

    [Fact]
    public void โฮสต์ที่มีตัวอักษรแปลกไม่ทำให้ได้_path_ที่ใช้ไม่ได้()
    {
        var report = DiagnosticBuilder.Build("https://ไทย.example/a", null, null, "1.0.0");
        Assert.DoesNotContain("..", report.RepoPath);
        Assert.DoesNotContain("//", report.RepoPath.Replace("needs-config/", ""));
    }

    [Fact]
    public async Task ไม่ถามแล้วไม่ส่ง_ห้าม_default_เป็นส่ง()
    {
        var github = new FakeGitHubClient();
        var reporter = new DiagnosticReporter(github, "KEWI-hub/ทดสอบ", "1.0.0");

        var result = await reporter.ReportAsync("https://x.example/a", "พัง", ["step"], CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Empty(github.Written);
    }

    [Fact]
    public async Task ผู้ใช้ปฏิเสธแล้วไม่ส่ง()
    {
        var github = new FakeGitHubClient();
        var reporter = new DiagnosticReporter(github, "KEWI-hub/ทดสอบ", "1.0.0")
        {
            AskBeforeSending = _ => false,
        };

        await reporter.ReportAsync("https://x.example/a", "พัง", ["step"], CancellationToken.None);
        Assert.Empty(github.Written);
    }

    [Fact]
    public async Task ผู้ใช้อนุญาตแล้วส่งขึ้น_repo_ที่ถูกต้อง()
    {
        var github = new FakeGitHubClient();
        DiagnosticReport? shown = null;
        var reporter = new DiagnosticReporter(github, "KEWI-hub/NewKewi-logs", "1.2.3")
        {
            AskBeforeSending = r => { shown = r; return true; },
        };

        var result = await reporter.ReportAsync(
            "https://site.example/movie/x", "หาลิงก์ไม่เจอ", ["fetch:Simple status=403"],
            CancellationToken.None);

        Assert.True(result.Ok);
        var written = Assert.Single(github.Written);
        Assert.Equal("KEWI-hub/NewKewi-logs", written.Repo);
        Assert.StartsWith("needs-config/site.example/", written.Path);
        Assert.Contains("site.example", written.Content);

        // ผู้ใช้ต้องได้เห็นของที่จะส่งก่อนตัดสินใจ
        Assert.NotNull(shown);
        Assert.Equal("site.example", shown.Host);
    }
}

public class NamingRulesTests
{
    private static NamingRules Rules() => new()
    {
        Default = new NamingRule { Template = "{title}", MaxLength = 50 },
        Rules =
        [
            new NamingRule
            {
                Host = "site.example",
                Template = "[{host}] {title} ({quality})",
                Folder = "เว็บตัวอย่าง",
                Replace = [new NamingReplace { From = @"\s*-\s*site\.example\s*$", To = "" }],
            },
        ],
    };

    [Fact]
    public void เลือกกฎตามโดเมน_รวมโดเมนย่อยและ_www()
    {
        var rules = Rules();
        Assert.Equal("site.example", rules.Match("site.example").Host);
        Assert.Equal("site.example", rules.Match("www.site.example").Host);
        Assert.Equal("site.example", rules.Match("cdn.site.example").Host);
        Assert.Equal("", rules.Match("other.example").Host);
    }

    [Fact]
    public void แทนค่าในรูปแบบได้ครบ()
    {
        var name = NamingRules.Apply(Rules().Match("site.example"), new Dictionary<string, string>
        {
            ["title"] = "คลิปทดสอบ - site.example",
            ["host"] = "site.example",
            ["quality"] = "1080p",
        });

        Assert.Equal("[site.example] คลิปทดสอบ (1080p)", name);
    }

    [Fact]
    public void ตัวแปรที่ไม่มีค่าไม่ติดไปในชื่อไฟล์()
    {
        var rule = new NamingRule { Template = "{title} ({quality}) [{id}]" };
        var name = NamingRules.Apply(rule, new Dictionary<string, string> { ["title"] = "คลิป" });

        Assert.Equal("คลิป", name);
        Assert.DoesNotContain("{", name);
        Assert.DoesNotContain("(", name);
    }

    [Fact]
    public void regex_ที่ผู้ใช้เขียนผิดไม่ทำให้พัง()
    {
        var rule = new NamingRule
        {
            Template = "{title}",
            Replace = [new NamingReplace { From = "[ยังไม่ปิดวงเล็บ", To = "x" }],
        };

        Assert.Equal("คลิป", NamingRules.Apply(rule, new Dictionary<string, string> { ["title"] = "คลิป" }));
    }

    [Fact]
    public void ชื่อยาวเกินถูกตัดตาม_maxLength()
    {
        var rule = new NamingRule { Template = "{title}", MaxLength = 10 };
        var name = NamingRules.Apply(rule, new Dictionary<string, string>
        {
            ["title"] = new string('ก', 50),
        });

        Assert.Equal(10, name.Length);
    }
}

public class NamingInEngineTests
{
    [Fact]
    public async Task กฎของเว็บเปลี่ยนชื่อไฟล์และแยกโฟลเดอร์จริง()
    {
        using var app = new TempApp();
        var naming = new NamingRules
        {
            Rules =
            [
                new NamingRule
                {
                    Host = "site.example",
                    Template = "{title} ({quality})",
                    Folder = "หนังจากเว็บนี้",
                },
            ],
        };

        var resolver = new FakeResolver
        {
            Primary = new ResolveOutcome(true, "M", "ชื่อจาก module",
                [new MediaStream { Url = "https://cdn/x.m3u8", Kind = StreamKind.Hls, Height = 720 }],
                null),
        };

        var item = new DownloadItem
        {
            SourceUrl = "https://site.example/watch/1",
            OutputDirectory = app.Output,
            Force = true,
        };

        var expected = Path.Combine(app.Output, "หนังจากเว็บนี้");
        app.Runner.ProducedFile = Path.Combine(expected, "ชื่อจาก module (720p).mp4");

        await new DownloadEngine(app.Paths, app.Settings, app.Runner, resolver, null, naming)
            .RunAsync(item, CancellationToken.None);

        Assert.Equal(DownloadStatus.Done, item.Status);
        Assert.Equal("ชื่อจาก module (720p)", item.Title);
        Assert.Equal(expected, item.OutputDirectory);
    }

    [Fact]
    public async Task เว็บที่ไม่มีกฎใช้ชื่อเดิม()
    {
        using var app = new TempApp();
        var naming = new NamingRules();   // มีแต่ default = {title}

        var resolver = new FakeResolver
        {
            Primary = new ResolveOutcome(true, "M", "ชื่อเดิม",
                [new MediaStream { Url = "https://cdn/x.m3u8", Kind = StreamKind.Hls }], null),
        };

        var item = new DownloadItem
        {
            SourceUrl = "https://other.example/watch/1",
            OutputDirectory = app.Output,
            Force = true,
        };
        app.Runner.ProducedFile = Path.Combine(app.Output, "ชื่อเดิม.mp4");

        await new DownloadEngine(app.Paths, app.Settings, app.Runner, resolver, null, naming)
            .RunAsync(item, CancellationToken.None);

        Assert.Equal("ชื่อเดิม", item.Title);
        Assert.Equal(app.Output, item.OutputDirectory);
    }
}

public class ConfigSyncTests
{
    /// <summary>ปั้น tarball แบบที่ GitHub ส่งมา (มีโฟลเดอร์ชั้นนอกครอบอยู่)</summary>
    private static string MakeTarball(string file, IEnumerable<(string Path, string Body)> entries)
    {
        using var output = File.Create(file);
        using var gzip = new GZipStream(output, CompressionLevel.Fastest);
        using var tar = new TarWriter(gzip, TarEntryFormat.Pax);

        foreach (var (path, body) in entries)
        {
            var entry = new PaxTarEntry(TarEntryType.RegularFile, path)
            {
                DataStream = new MemoryStream(Encoding.UTF8.GetBytes(body)),
            };
            tar.WriteEntry(entry);
        }
        return file;
    }

    private static (TempModules mods, AppPaths paths, string temp) Setup()
    {
        var root = Path.Combine(Path.GetTempPath(), "newkewi-sync-" + Guid.NewGuid().ToString("n")[..8]);
        var paths = new AppPaths(root);
        paths.EnsureCreated();
        return (new TempModules(), paths, root);
    }

    [Fact]
    public async Task ดึง_lua_จาก_repo_มาลงโฟลเดอร์ที่ถูก()
    {
        var (mods, paths, root) = Setup();
        using var _ = mods;

        var tarball = MakeTarball(Path.Combine(root, "src.tar.gz"),
        [
            ("KEWI-hub-configs-abc123/modules/lua/SiteOne.lua", "function Register() end"),
            ("KEWI-hub-configs-abc123/modules/lua/SiteTwo.lua", "function Register() end"),
            ("KEWI-hub-configs-abc123/README.md", "ไม่ใช่ module"),
        ]);

        var github = new FakeGitHubClient { BranchSha = "abc123", TarballSource = tarball };
        var result = await new ConfigSync(paths, github).SyncAsync(CancellationToken.None);

        Assert.True(result.Changed, result.Message);
        Assert.Equal(2, result.FilesWritten);
        Assert.True(File.Exists(Path.Combine(paths.LuaModules, "SiteOne.lua")));
        Assert.False(File.Exists(Path.Combine(paths.LuaModules, "README.md")));

        Directory.Delete(root, recursive: true);
    }

    [Fact]
    public async Task ไฟล์ที่พยายามเขียนออกนอกโฟลเดอร์ถูกปัดทิ้ง()
    {
        var (mods, paths, root) = Setup();
        using var _ = mods;

        var tarball = MakeTarball(Path.Combine(root, "evil.tar.gz"),
        [
            ("x/modules/lua/../../../โดนแฮก.lua", "ไม่ควรถูกเขียน"),
            ("x/modules/lua/ปกติ.lua", "function Register() end"),
        ]);

        var github = new FakeGitHubClient { BranchSha = "sha1", TarballSource = tarball };
        await new ConfigSync(paths, github).SyncAsync(CancellationToken.None);

        Assert.False(File.Exists(Path.Combine(paths.Root, "โดนแฮก.lua")));
        Assert.False(File.Exists(Path.Combine(paths.Root, "modules", "โดนแฮก.lua")));
        Assert.True(File.Exists(Path.Combine(paths.LuaModules, "ปกติ.lua")));

        Directory.Delete(root, recursive: true);
    }

    [Fact]
    public async Task sha_เดิมแปลว่าไม่ต้องโหลดซ้ำ()
    {
        var (mods, paths, root) = Setup();
        using var _ = mods;

        var tarball = MakeTarball(Path.Combine(root, "src.tar.gz"),
            [("x/modules/lua/A.lua", "function Register() end")]);

        var github = new FakeGitHubClient { BranchSha = "same", TarballSource = tarball };
        var sync = new ConfigSync(paths, github);

        Assert.True((await sync.SyncAsync(CancellationToken.None)).Changed);
        var second = await sync.SyncAsync(CancellationToken.None);

        Assert.False(second.Changed);
        Assert.Contains("ล่าสุด", second.Message);

        Directory.Delete(root, recursive: true);
    }

    [Fact]
    public async Task ถาม_github_ไม่ได้ก็ใช้ของเดิมต่อ_ไม่พัง()
    {
        var (mods, paths, root) = Setup();
        using var _ = mods;

        var result = await new ConfigSync(paths, new FakeGitHubClient { BranchSha = null })
            .SyncAsync(CancellationToken.None);

        Assert.False(result.Changed);
        Assert.Contains("ใช้ config ที่มีอยู่", result.Message);

        Directory.Delete(root, recursive: true);
    }
}
