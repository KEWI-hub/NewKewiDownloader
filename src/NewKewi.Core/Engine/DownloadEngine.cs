using System.Text;
using NewKewi.Core.Models;
using NewKewi.Core.Processes;
using NewKewi.Core.Settings;

namespace NewKewi.Core.Engine;

/// <summary>
/// ตัวโหลดงานหนึ่งชิ้นตั้งแต่ต้นจนจบ
///
/// **นี่คือทางเดียวที่งานเดินจริง** เทสต้องเรียก <see cref="RunAsync"/> เท่านั้น
/// ห้ามเทสเรียกตัวปั้น args หรือ remuxer ตรงๆ แล้วสรุปว่าใช้ได้
/// (บทเรียน v1.6.1 ของแอปเก่า: เทส 23 ข้อผ่านหมดแต่ของจริงพัง
///  เพราะเทสไม่เคยเดินทางเดียวกับตอนผู้ใช้กดโหลด)
/// </summary>
public sealed class DownloadEngine(
    AppPaths paths,
    AppSettings settings,
    IProcessRunner runner)
{
    private readonly Remuxer _remuxer = new(paths, runner);

    public async Task RunAsync(DownloadItem item, CancellationToken ct)
    {
        try
        {
            await RunCoreAsync(item, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            item.Status = DownloadStatus.Paused;
            item.SpeedBytesPerSecond = 0;
            throw;
        }
        catch (Exception ex)
        {
            // ไม่มี retry — พังแล้วจบ บันทึกเหตุผลไว้ให้ผู้ใช้ตัดสินใจเอง
            item.Fail($"เกิดข้อผิดพลาดในแอป: {ex.Message}");
        }
    }

    private async Task RunCoreAsync(DownloadItem item, CancellationToken ct)
    {
        var missing = paths.MissingTools();
        if (missing.Count > 0)
        {
            item.Fail($"ไม่พบเครื่องมือใน bin\\: {string.Join(", ", missing)}");
            return;
        }

        if (string.IsNullOrWhiteSpace(item.OutputDirectory))
            item.OutputDirectory = settings.DownloadDirectory;
        Directory.CreateDirectory(item.OutputDirectory);

        if (ShouldSkip(item))
        {
            item.Status = DownloadStatus.Skipped;
            item.FailureReason = "มีไฟล์ชื่อนี้อยู่แล้ว";
            item.FinishedAt = DateTimeOffset.Now;
            return;
        }

        var tempDir = paths.TempFor(item.Id);
        SweepLeftovers(tempDir);   // กัน HTTP 416 จากซากไฟล์รอบก่อน
        Directory.CreateDirectory(tempDir);

        var resultPathFile = Path.Combine(tempDir, "result-path.txt");
        TryDelete(resultPathFile);

        item.Status = DownloadStatus.Downloading;
        item.Progress = 0;
        item.FailureReason = null;

        var ctx = new YtDlpArgs.Context(
            paths, settings, tempDir, resultPathFile,
            File.Exists(paths.CookieJar) ? paths.CookieJar : null);

        var args = YtDlpArgs.Build(item, ctx);

        var result = await runner.RunAsync(
            new ProcessRequest(paths.YtDlp, args, paths.Bin),
            line => ApplyProgress(item, line),
            ct).ConfigureAwait(false);

        if (!result.Ok)
        {
            var failure = ErrorClassifier.Classify(result.StdErr, result.StdOut, result.ExitCode);
            item.Fail(failure.Message);
            return;
        }

        var file = ReadResultPath(resultPathFile);
        if (file is null || !File.Exists(file))
        {
            item.Fail("yt-dlp บอกว่าสำเร็จ แต่หาไฟล์ปลายทางไม่เจอ");
            return;
        }

        item.OutputFile = file;
        item.Progress = 100;
        item.SpeedBytesPerSecond = 0;
        item.EtaSeconds = 0;

        if (settings.AlwaysMp4)
        {
            item.Status = DownloadStatus.Remuxing;
            var remux = await _remuxer
                .EnsureMp4Async(file, settings.AllowReencodeForMp4, ct)
                .ConfigureAwait(false);

            if (!remux.Ok)
            {
                // ไฟล์ยังอยู่ แค่ไม่ใช่ mp4 — บอกตรงๆ ว่าได้อะไรมา
                item.Fail($"โหลดได้แต่ทำเป็น mp4 ไม่สำเร็จ: {remux.Error}");
                return;
            }
            item.OutputFile = remux.FilePath;
        }

        item.Status = DownloadStatus.Done;
        item.FinishedAt = DateTimeOffset.Now;
        CleanTemp(tempDir);
    }

    private static void ApplyProgress(DownloadItem item, string line)
    {
        if (!ProgressParser.TryParse(line, out var p)) return;
        item.DownloadedBytes = p.DownloadedBytes;
        item.TotalBytes = p.TotalBytes;
        item.SpeedBytesPerSecond = p.SpeedBytesPerSecond;
        item.EtaSeconds = p.EtaSeconds;
        if (p.TotalBytes > 0) item.Progress = p.Percent;
    }

    private bool ShouldSkip(DownloadItem item)
    {
        if (item.Force || !settings.SkipExisting) return false;
        if (string.IsNullOrWhiteSpace(item.Title)) return false;

        var name = YtDlpArgs.SanitizeTemplate(item.Title);
        return Directory
            .EnumerateFiles(item.OutputDirectory, name + ".*")
            .Any(f => !f.EndsWith(".part", StringComparison.OrdinalIgnoreCase) &&
                      !f.EndsWith(".ytdl", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// ลบซากไฟล์ของรอบก่อน
    /// ของเดิมเจอ HTTP 416 แล้ววนไม่จบ เพราะ yt-dlp ไปต่อจากซากที่เก่าเกินใช้ได้
    /// ที่นี่ไม่มี retry อยู่แล้ว แต่ลบไว้กันผู้ใช้กด "ลองใหม่" แล้วเจอปัญหาเดิมซ้ำ
    /// </summary>
    private static void SweepLeftovers(string tempDir)
    {
        if (!Directory.Exists(tempDir)) return;
        foreach (var f in Directory.EnumerateFiles(tempDir, "*", SearchOption.AllDirectories))
        {
            var ext = Path.GetExtension(f);
            if (ext is ".part" or ".ytdl" or ".temp" or ".frag" || f.Contains(".part-Frag", StringComparison.Ordinal))
                TryDelete(f);
        }
    }

    private static void CleanTemp(string tempDir)
    {
        try { if (Directory.Exists(tempDir)) Directory.Delete(tempDir, recursive: true); }
        catch { /* ลบไม่ได้ก็ไม่เป็นไร รอบหน้ากวาดเอง */ }
    }

    private static string? ReadResultPath(string file)
    {
        try
        {
            if (!File.Exists(file)) return null;
            var line = File.ReadAllText(file, Encoding.UTF8)
                .TrimStart('﻿')
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .LastOrDefault();
            return string.IsNullOrWhiteSpace(line) ? null : line;
        }
        catch { return null; }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { /* ไฟล์ถูกจับอยู่ ปล่อยไป */ }
    }
}
