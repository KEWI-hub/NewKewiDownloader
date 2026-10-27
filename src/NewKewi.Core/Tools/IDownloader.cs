namespace NewKewi.Core.Tools;

/// <summary>
/// โหลดไฟล์จากเน็ตลงดิสก์
///
/// แยกเป็น interface เพื่อให้เทสสวมตัวปลอมได้ — ไม่งั้นเทสตัวติดตั้งต้องโหลดของจริงหลายร้อยเมกฯ
/// ทุกครั้งที่รัน ซึ่งจะกลายเป็นเทสที่ไม่มีใครกล้ารัน
/// </summary>
public interface IDownloader
{
    /// <summary>คืน true เมื่อได้ไฟล์ครบ · ล้มเหลวต้องไม่ทิ้งไฟล์ครึ่งๆ ไว้</summary>
    Task<bool> GetFileAsync(string url, string targetFile, IProgress<string>? progress, CancellationToken ct);
}

/// <summary>ตัวจริง · โหลดลงไฟล์ชั่วคราวก่อนแล้วค่อยย้าย ไฟล์ครึ่งๆ จึงไม่มีทางถูกใช้งาน</summary>
public sealed class HttpDownloader : IDownloader, IDisposable
{
    private readonly HttpClient _http = new() { Timeout = Timeout.InfiniteTimeSpan };

    public async Task<bool> GetFileAsync(
        string url, string targetFile, IProgress<string>? progress, CancellationToken ct)
    {
        var partial = targetFile + ".part";

        try
        {
            using var res = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct)
                .ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return false;

            Directory.CreateDirectory(Path.GetDirectoryName(targetFile)!);

            var total = res.Content.Headers.ContentLength ?? 0;
            await using (var src = await res.Content.ReadAsStreamAsync(ct).ConfigureAwait(false))
            await using (var dst = File.Create(partial))
            {
                var buffer = new byte[256 * 1024];
                long done = 0;
                var lastPercent = 0;
                int read;

                while ((read = await src.ReadAsync(buffer, ct).ConfigureAwait(false)) > 0)
                {
                    await dst.WriteAsync(buffer.AsMemory(0, read), ct).ConfigureAwait(false);
                    done += read;

                    if (total <= 0 || progress is null) continue;
                    var percent = (int)(done * 100 / total);
                    if (percent < lastPercent + 5) continue;

                    lastPercent = percent;
                    progress.Report($"{percent}%");
                }
            }

            File.Move(partial, targetFile, overwrite: true);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return false;
        }
        finally
        {
            TryDelete(partial);
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { /* ถูกจับอยู่ ปล่อยไป */ }
    }

    public void Dispose() => _http.Dispose();
}
