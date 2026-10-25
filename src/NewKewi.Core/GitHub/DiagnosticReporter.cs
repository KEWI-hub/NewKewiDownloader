namespace NewKewi.Core.GitHub;

/// <summary>
/// ส่ง diagnostic report ขึ้น repo log
///
/// **ถามผู้ใช้ก่อนส่งทุกครั้ง** เว้นแต่เขาติ๊ก "ส่งอัตโนมัติ" ไว้เอง
/// report มีชื่อเว็บที่ผู้ใช้เข้า จึงไม่ใช่ของที่ส่งออกเงียบๆ ได้
/// </summary>
public sealed class DiagnosticReporter(
    IGitHubClient github,
    string repo,
    string appVersion)
{
    /// <summary>repo สำหรับ log ต้องเป็น **private** เสมอ · repo โค้ดเป็น public</summary>
    public const string DefaultRepo = "KEWI-hub/NewKewi-logs";

    /// <summary>
    /// ถามก่อนส่ง · คืน true เพื่ออนุญาต
    /// ไม่มีใครรับเรื่อง = ไม่ส่ง ห้าม default เป็นส่ง
    /// </summary>
    public Func<DiagnosticReport, bool>? AskBeforeSending { get; set; }

    /// <summary>ส่งโดยไม่ถาม (ผู้ใช้ตั้งค่าไว้เอง)</summary>
    public bool SendWithoutAsking { get; set; }

    public async Task<GitHubResult> ReportAsync(
        string sourceUrl, string? reason, IReadOnlyList<string>? trail, CancellationToken ct)
    {
        var report = DiagnosticBuilder.Build(sourceUrl, reason, trail, appVersion);

        if (!SendWithoutAsking && !(AskBeforeSending?.Invoke(report) ?? false))
            return new GitHubResult(false, "ผู้ใช้ไม่ได้อนุญาตให้ส่ง");

        var json = System.Text.Json.JsonSerializer.Serialize(report, Json.Options);

        return await github.PutFileAsync(
            repo,
            report.RepoPath,
            json,
            $"Report from {report.Host}",
            ct).ConfigureAwait(false);
    }
}
