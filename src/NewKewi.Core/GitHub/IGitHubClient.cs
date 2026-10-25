namespace NewKewi.Core.GitHub;

public sealed record GitHubResult(bool Ok, string? Error = null);

/// <summary>
/// ส่วนที่แอปคุยกับ GitHub · เป็น interface เพื่อให้เทสสวมตัวปลอมได้
/// เทสจะได้ไม่ต้องมี token และไม่ไปแตะ repo จริง
/// </summary>
public interface IGitHubClient
{
    /// <summary>sha ล่าสุดของ branch · null = ถามไม่ได้ (ไม่มี repo / ไม่มีเน็ต / ไม่มีสิทธิ์)</summary>
    Task<string?> GetBranchShaAsync(string repo, string branch, CancellationToken ct);

    /// <summary>โหลด tarball ของ ref นั้นมาเป็นไฟล์ · คืน path หรือ null</summary>
    Task<string?> DownloadTarballAsync(string repo, string reference, string targetFile, CancellationToken ct);

    /// <summary>สร้างหรือทับไฟล์ใน repo</summary>
    Task<GitHubResult> PutFileAsync(
        string repo, string path, string content, string commitMessage, CancellationToken ct);
}
