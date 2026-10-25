using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace NewKewi.Core.GitHub;

/// <summary>
/// ตัวจริงที่คุยกับ GitHub REST API
///
/// token มาจาก <see cref="GitCredentials"/> เท่านั้น · ขอตอนจะใช้ ไม่เก็บลงไฟล์
/// ไม่มี token ก็ยังอ่าน repo สาธารณะได้ (ใช้ซิงก์ config) แต่เขียนไม่ได้
/// </summary>
public sealed class GitHubClient : IGitHubClient, IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(3) };
    private readonly Func<string?> _tokenSource;
    private string? _token;
    private bool _askedForToken;

    public GitHubClient(Func<string?>? tokenSource = null)
        => _tokenSource = tokenSource ?? (() => GitCredentials.TryGetGitHubToken());

    public async Task<string?> GetBranchShaAsync(string repo, string branch, CancellationToken ct)
    {
        using var req = Request(HttpMethod.Get, $"repos/{repo}/commits/{branch}");
        try
        {
            using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;

            var json = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("sha", out var sha) ? sha.GetString() : null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            return null;
        }
    }

    public async Task<string?> DownloadTarballAsync(
        string repo, string reference, string targetFile, CancellationToken ct)
    {
        using var req = Request(HttpMethod.Get, $"repos/{repo}/tarball/{reference}");
        try
        {
            using var res = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct)
                .ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;

            Directory.CreateDirectory(Path.GetDirectoryName(targetFile)!);
            await using (var dst = File.Create(targetFile))
            {
                await res.Content.CopyToAsync(dst, ct).ConfigureAwait(false);
            }
            return targetFile;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            return null;
        }
    }

    public async Task<GitHubResult> PutFileAsync(
        string repo, string path, string content, string commitMessage, CancellationToken ct)
    {
        if (Token() is null)
            return new GitHubResult(false, "ไม่มี token ของ GitHub — ล็อกอิน git ไว้หรือยัง");

        // มีไฟล์เดิมอยู่ต้องแนบ sha มาด้วย ไม่งั้น GitHub ตอบ 422
        var existing = await GetFileShaAsync(repo, path, ct).ConfigureAwait(false);

        var payload = JsonSerializer.Serialize(new Dictionary<string, string?>
        {
            ["message"] = commitMessage,
            ["content"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(content)),
            ["sha"] = existing,
        }.Where(p => p.Value is not null).ToDictionary(p => p.Key, p => p.Value!));

        using var req = Request(HttpMethod.Put, $"repos/{repo}/contents/{path}");
        req.Content = new StringContent(payload, Encoding.UTF8, "application/json");

        try
        {
            using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (res.IsSuccessStatusCode) return new GitHubResult(true);

            var reason = res.StatusCode switch
            {
                HttpStatusCode.NotFound => "ไม่เจอ repo นี้ หรือ token ไม่มีสิทธิ์เข้าถึง",
                HttpStatusCode.Unauthorized => "token ใช้ไม่ได้",
                HttpStatusCode.Forbidden => "token ไม่มีสิทธิ์เขียน repo นี้",
                _ => $"GitHub ตอบ {(int)res.StatusCode}",
            };
            return new GitHubResult(false, reason);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new GitHubResult(false, "ติดต่อ GitHub ไม่ได้");
        }
    }

    private async Task<string?> GetFileShaAsync(string repo, string path, CancellationToken ct)
    {
        using var req = Request(HttpMethod.Get, $"repos/{repo}/contents/{path}");
        try
        {
            using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;

            var json = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("sha", out var sha) ? sha.GetString() : null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            return null;
        }
    }

    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var req = new HttpRequestMessage(method, "https://api.github.com/" + path);
        req.Headers.UserAgent.Add(new ProductInfoHeaderValue("NewKewiDownloader", "1.0"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        req.Headers.TryAddWithoutValidation("X-GitHub-Api-Version", "2022-11-28");

        if (Token() is { } token)
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return req;
    }

    /// <summary>ถาม Credential Manager ครั้งเดียวต่อการรันหนึ่งรอบ · ไม่มีก็ไม่ถามซ้ำ</summary>
    private string? Token()
    {
        if (_askedForToken) return _token;
        _askedForToken = true;
        _token = _tokenSource();
        return _token;
    }

    public void Dispose() => _http.Dispose();
}
