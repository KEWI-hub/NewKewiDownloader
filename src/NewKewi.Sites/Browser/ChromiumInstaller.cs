using System.IO.Compression;
using System.Text.Json;
using NewKewi.Core;

namespace NewKewi.Sites.Browser;

/// <summary>
/// โหลด Chromium พกพามาไว้ใน <c>_chromium/</c> ตอนที่ต้องใช้ครั้งแรก
///
/// ทำไมต้องพกพา: จะได้ไม่พึ่งเบราว์เซอร์ที่ผู้ใช้ติดตั้งไว้ และที่สำคัญกว่าคือ
/// **ไม่ไปแตะ profile หรือ cookie จริงของเขาเลย** แอปมี profile ของตัวเองใน <c>_profile/</c>
/// </summary>
public sealed class ChromiumInstaller(AppPaths paths)
{
    private const string VersionsUrl =
        "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";

    public bool IsInstalled => File.Exists(paths.ChromeExe);

    /// <summary>ติดตั้งแล้วคืน path ของ chrome.exe · มีอยู่แล้วก็คืนเลยไม่โหลดซ้ำ</summary>
    public async Task<string> EnsureAsync(IProgress<string>? progress, CancellationToken ct)
    {
        if (IsInstalled) return paths.ChromeExe;

        progress?.Report("กำลังหาเวอร์ชันล่าสุดของ Chrome for Testing");
        var zipUrl = await FindWin64ZipAsync(ct).ConfigureAwait(false)
            ?? throw new InvalidOperationException(
                "หาลิงก์ดาวน์โหลด Chrome for Testing (win64) ไม่เจอ");

        Directory.CreateDirectory(paths.Temp);
        var zipPath = Path.Combine(paths.Temp, "chromium.zip");

        progress?.Report("กำลังโหลด Chromium (ประมาณ 150 MB) ครั้งเดียวจบ");
        await DownloadAsync(zipUrl, zipPath, progress, ct).ConfigureAwait(false);

        progress?.Report("กำลังแตกไฟล์");
        // แตกลงที่ชั่วคราวก่อนแล้วค่อยย้าย — โหลดค้างกลางทางจะได้ไม่เหลือ _chromium ที่ใช้ไม่ได้
        var staging = Path.Combine(paths.Temp, "chromium-staging");
        if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true);
        ZipFile.ExtractToDirectory(zipPath, staging);

        Directory.CreateDirectory(paths.Chromium);
        foreach (var dir in Directory.EnumerateDirectories(staging))
        {
            var target = Path.Combine(paths.Chromium, Path.GetFileName(dir));
            if (Directory.Exists(target)) Directory.Delete(target, recursive: true);
            Directory.Move(dir, target);
        }

        TryDelete(zipPath);
        try { Directory.Delete(staging, recursive: true); } catch { /* ช่างมัน */ }

        if (!IsInstalled)
            throw new InvalidOperationException($"แตกไฟล์แล้วแต่ไม่เจอ {paths.ChromeExe}");

        progress?.Report("Chromium พร้อมใช้งาน");
        return paths.ChromeExe;
    }

    private static async Task<string?> FindWin64ZipAsync(CancellationToken ct)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        var json = await http.GetStringAsync(VersionsUrl, ct).ConfigureAwait(false);

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("channels", out var channels)) return null;
        if (!channels.TryGetProperty("Stable", out var stable)) return null;
        if (!stable.TryGetProperty("downloads", out var downloads)) return null;
        if (!downloads.TryGetProperty("chrome", out var chrome)) return null;

        foreach (var entry in chrome.EnumerateArray())
        {
            if (entry.TryGetProperty("platform", out var p) && p.GetString() == "win64" &&
                entry.TryGetProperty("url", out var u))
                return u.GetString();
        }
        return null;
    }

    private static async Task DownloadAsync(
        string url, string target, IProgress<string>? progress, CancellationToken ct)
    {
        using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        using var res = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct)
            .ConfigureAwait(false);
        res.EnsureSuccessStatusCode();

        var total = res.Content.Headers.ContentLength ?? 0;
        await using var src = await res.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        await using var dst = File.Create(target);

        var buffer = new byte[256 * 1024];
        long done = 0;
        var lastReport = 0;
        int read;
        while ((read = await src.ReadAsync(buffer, ct).ConfigureAwait(false)) > 0)
        {
            await dst.WriteAsync(buffer.AsMemory(0, read), ct).ConfigureAwait(false);
            done += read;

            if (total <= 0) continue;
            var percent = (int)(done * 100 / total);
            if (percent >= lastReport + 5)
            {
                lastReport = percent;
                progress?.Report($"กำลังโหลด Chromium {percent}%");
            }
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { /* ไฟล์ถูกจับอยู่ ปล่อยไป */ }
    }
}
