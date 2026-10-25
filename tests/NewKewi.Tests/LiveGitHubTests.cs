using NewKewi.Core;
using NewKewi.Core.GitHub;
using NewKewi.Sites;

namespace NewKewi.Tests;

/// <summary>
/// ยิง GitHub จริงด้วย token จริงจาก Git Credential Manager
///
/// ไม่รันในชุดปกติ · ผลขึ้นกับว่า repo ตั้งค่าไว้ยังไงและเครื่องนี้ล็อกอิน git ไว้หรือยัง
/// เทสที่เขียนลง repo ใช้ path ของตัวเอง (<c>needs-config/test.example/</c>) แล้วลบทิ้งเอง
/// </summary>
[Trait("Category", "live")]
public class LiveGitHubTests
{
    private const string ConfigRepo = "KEWI-hub/NewKewi-configs";
    private const string LogRepo = "KEWI-hub/NewKewi-logs";

    private static AppPaths Sandbox()
    {
        var root = Path.Combine(Path.GetTempPath(), "newkewi-gh-" + Guid.NewGuid().ToString("n")[..8]);
        var paths = new AppPaths(root);
        paths.EnsureCreated();
        return paths;
    }

    [Fact]
    public async Task ซิงก์_config_จาก_repo_จริงได้()
    {
        var paths = Sandbox();
        using var github = new GitHubClient();

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));

            var sha = await github.GetBranchShaAsync(ConfigRepo, "main", cts.Token);
            Assert.False(string.IsNullOrEmpty(sha), "ถาม sha ของ branch ไม่ได้");

            var sync = new ConfigSync(paths, github);
            var first = await sync.SyncAsync(cts.Token);

            Assert.True(first.Changed, first.Message);

            // ไฟล์ฐานร่วมที่ชื่อขึ้นต้นด้วย _ ต้องมาด้วย ไม่งั้น module ที่ require มันจะโหลดไม่ขึ้น
            foreach (var file in new[]
                     { "StreamOrigin.lua", "TaiAv.lua", "FirePlayer.lua", "SupJav.lua", "Av123.lua", "_Players.lua" })
            {
                Assert.True(File.Exists(Path.Combine(paths.LuaModules, file)), $"ไม่ได้ {file} มา");
            }

            // module ที่ซิงก์มาต้องโหลดเข้า registry ได้จริง ไม่ใช่แค่ไฟล์มาถึง
            var registry = new SiteRegistry(new AppPathsView(paths.LuaModules, paths.LocalModules));
            registry.Load();
            Assert.Empty(registry.LoadErrors.Select(e => $"{Path.GetFileName(e.File)}: {e.Error}"));

            foreach (var (site, expected) in new[]
                     {
                         ("https://taiav.com/cn/movie/x", "TaiAv"),
                         ("https://av-th.io/video/1", "FirePlayer"),
                         ("https://supjav.com/x", "SupJav"),
                         ("https://123av.com/x", "Av123"),
                         ("https://pornavhd.com/x", "StreamOrigin"),
                     })
            {
                Assert.Equal(expected, registry.Find(site)?.Name);
            }

            // รอบสองต้องรู้ว่าเหมือนเดิมแล้วไม่โหลดซ้ำ
            var second = await sync.SyncAsync(cts.Token);
            Assert.False(second.Changed);
        }
        finally
        {
            TryDeleteTree(paths.Root);
        }
    }

    [Fact]
    public async Task ส่ง_diagnostic_report_ขึ้น_repo_private_จริงได้()
    {
        using var github = new GitHubClient();
        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));

        DiagnosticReport? sent = null;
        var reporter = new DiagnosticReporter(github, LogRepo, "0.7.0")
        {
            AskBeforeSending = r => { sent = r; return true; },
        };

        var result = await reporter.ReportAsync(
            "https://test.example/movie/liveprobe?token=ค่าลับที่ต้องไม่ถูกส่ง",
            "เทสทางเชื่อม GitHub",
            ["fetch:Simple status=403 bytes=1234", "captured matches=0"],
            cts.Token);

        Assert.True(result.Ok, result.Error);
        Assert.NotNull(sent);

        // อ่านกลับมาดูว่าของที่ขึ้นไปจริงไม่มีความลับติดไป
        var raw = await ReadBackAsync(LogRepo, sent.RepoPath, cts.Token);
        Assert.NotNull(raw);
        Assert.Contains("test.example", raw);
        Assert.DoesNotContain("ค่าลับที่ต้องไม่ถูกส่ง", raw);
        Assert.DoesNotContain("token=", raw);

        await DeleteAsync(LogRepo, sent.RepoPath, cts.Token);
    }

    /// <summary>อ่านไฟล์กลับมาด้วย gh เพื่อยืนยันว่ามันขึ้นไปจริง</summary>
    private static async Task<string?> ReadBackAsync(string repo, string path, CancellationToken ct)
    {
        var (ok, output) = await RunGhAsync(
            ["api", $"repos/{repo}/contents/{path}", "--jq", ".content"], ct);
        if (!ok || string.IsNullOrWhiteSpace(output)) return null;

        try
        {
            var base64 = output.Replace("\n", "").Replace("\r", "").Trim();
            return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(base64));
        }
        catch (FormatException) { return null; }
    }

    private static async Task DeleteAsync(string repo, string path, CancellationToken ct)
    {
        var (ok, sha) = await RunGhAsync(
            ["api", $"repos/{repo}/contents/{path}", "--jq", ".sha"], ct);
        if (!ok) return;

        await RunGhAsync(
        [
            "api", "-X", "DELETE", $"repos/{repo}/contents/{path}",
            "-f", "message=remove live test artifact",
            "-f", $"sha={sha.Trim()}",
        ], ct);
    }

    private static async Task<(bool Ok, string Output)> RunGhAsync(string[] args, CancellationToken ct)
    {
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "gh",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var proc = System.Diagnostics.Process.Start(psi);
        if (proc is null) return (false, "");

        var output = await proc.StandardOutput.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);
        return (proc.ExitCode == 0, output);
    }

    private static void TryDeleteTree(string path)
    {
        try { Directory.Delete(path, recursive: true); } catch { /* ช่างมัน */ }
    }
}
