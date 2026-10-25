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
    IProcessRunner runner,
    IStreamResolver? resolver = null,
    BrowserIdentity? identity = null,
    NamingRules? naming = null)
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

        if (!TryResolve(item, ct)) return;

        ApplyNaming(item);

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

        // playlist กับไฟล์ย่อยต้องใช้ header คนละชุด → ดึง playlist มาเขียนลงเครื่องก่อน
        // ต้องทำตรงนี้ ไม่ใช่ตอนเข้าคิว เพราะลิงก์ของเว็บพวกนี้มีอายุสั้น
        if (resolver is not null && item.Stream is { NeedsSplitHeaders: true } split)
            item.Stream = resolver.Prepare(split, tempDir, ct);

        item.Status = DownloadStatus.Downloading;
        item.Progress = 0;
        item.FailureReason = null;
        item.StartedAt = DateTimeOffset.Now;

        var ctx = new YtDlpArgs.Context(
            paths, settings, tempDir, resultPathFile,
            File.Exists(paths.CookieJar) ? paths.CookieJar : null,
            identity?.UserAgent);

        var result = await RunYtDlpAsync(item, ctx, ct).ConfigureAwait(false);

        if (!result.Ok)
        {
            var failure = ErrorClassifier.Classify(result.StdErr, result.StdOut, result.ExitCode);

            // ถอยมาอ่านหน้าเว็บเอง · ทำได้ครั้งเดียวและเฉพาะตอนยังไม่เคยแกะลิงก์มาก่อน
            // ไม่ใช่ retry — เป็นขั้นถัดไปของความพยายามเดียวกัน
            if (!failure.WorthFallingBack || item.Stream is not null || resolver is null)
            {
                item.Fail(failure.Message);
                return;
            }

            item.Status = DownloadStatus.Resolving;
            var fallback = resolver.ResolveFallback(item.SourceUrl, ct);
            if (!fallback.Ok)
            {
                // เก็บร่องรอยไว้ให้แอปเอาไปทำ diagnostic bundle ต่อ (ถ้าผู้ใช้อนุญาต)
                item.Diagnostics = fallback.Trail;
                item.Fail(fallback.Error ?? failure.Message);
                return;
            }

            item.ModuleName = fallback.ModuleName;
            if (string.IsNullOrWhiteSpace(item.Title) && !string.IsNullOrWhiteSpace(fallback.Title))
                item.Title = fallback.Title!;
            item.Stream = Pick(fallback.Streams, item.PreferredHeight);

            SweepLeftovers(tempDir);
            TryDelete(resultPathFile);
            item.Status = DownloadStatus.Downloading;

            result = await RunYtDlpAsync(item, ctx, ct).ConfigureAwait(false);
            if (!result.Ok)
            {
                item.Fail(ErrorClassifier
                    .Classify(result.StdErr, result.StdOut, result.ExitCode).Message);
                return;
            }
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

    /// <summary>
    /// แกะลิงก์ด้วย config ของเว็บ (ถ้ามี) · คืน false แปลว่างานล้มเหลวไปแล้ว
    ///
    /// ไม่มี module รับโดเมนนี้ → ปล่อยให้ <c>item.Stream</c> เป็น null
    /// แล้ว yt-dlp จะได้รับหน้าเว็บไปลองเอง (ทางทั่วไป)
    /// </summary>
    private bool TryResolve(DownloadItem item, CancellationToken ct)
    {
        if (resolver is null) return true;

        // ลิงก์ที่หมดอายุต้องขอใหม่ทุกครั้งที่เริ่มโหลด ห้ามใช้ของเดิมที่เก็บไว้
        var needsFreshLink = item.Stream is { Expires: true };
        if (item.Stream is not null && !needsFreshLink) return true;

        item.Status = DownloadStatus.Resolving;
        var outcome = resolver.Resolve(item.SourceUrl, ct);

        if (!outcome.Handled) return true;          // ไม่มี config → ทางทั่วไป

        if (outcome.Error is not null)
        {
            item.Fail($"config ของเว็บแกะลิงก์ไม่ได้: {outcome.Error}");
            return false;
        }
        if (outcome.Streams.Count == 0)
        {
            item.Fail("config ของเว็บรันผ่านแต่ไม่ได้ลิงก์วิดีโอกลับมา");
            return false;
        }

        item.ModuleName = outcome.ModuleName;
        if (string.IsNullOrWhiteSpace(item.Title) && !string.IsNullOrWhiteSpace(outcome.Title))
            item.Title = outcome.Title!;
        item.Stream = Pick(outcome.Streams, item.PreferredHeight);
        return true;
    }

    /// <summary>
    /// ใช้กฎตั้งชื่อไฟล์ของเว็บนั้น (ถ้ามี)
    ///
    /// ไม่มีกฎที่ตรงโดเมน หรือผลออกมาว่างเปล่า → ใช้ชื่อเดิมต่อ
    /// กฎที่เขียนผิดต้องไม่ทำให้ไฟล์ได้ชื่อประหลาดหรือโหลดไม่ได้
    /// </summary>
    private void ApplyNaming(DownloadItem item)
    {
        if (naming is null) return;

        var host = Uri.TryCreate(item.SourceUrl, UriKind.Absolute, out var uri) ? uri.Host : "";
        var rule = naming.Match(host);

        if (!string.IsNullOrWhiteSpace(rule.Folder))
        {
            var folder = YtDlpArgs.SanitizeTemplate(rule.Folder);
            item.OutputDirectory = Path.Combine(item.OutputDirectory, folder);
            Directory.CreateDirectory(item.OutputDirectory);
        }

        if (string.IsNullOrWhiteSpace(item.Title)) return;   // ยังไม่รู้ชื่อ ปล่อยให้ yt-dlp ตั้งเอง

        var named = NamingRules.Apply(rule, new Dictionary<string, string>
        {
            ["title"] = item.Title,
            ["host"] = host,
            ["quality"] = item.Stream is { Height: > 0 } s ? s.Height + "p" : "",
            ["date"] = DateTime.Now.ToString("yyyy-MM-dd"),
            ["id"] = uri is not null ? uri.Segments.LastOrDefault()?.Trim('/') ?? "" : "",
        });

        if (named.Length > 0) item.Title = named;
    }

    /// <summary>เลือกความชัด · ผู้ใช้ระบุมาก็เอาตัวที่ใกล้ที่สุดโดยไม่เกิน ไม่งั้นเอาสูงสุด</summary>
    internal static MediaStream Pick(IReadOnlyList<MediaStream> streams, int preferredHeight)
    {
        if (preferredHeight <= 0) return streams.MaxBy(s => s.Height)!;

        var exact = streams.FirstOrDefault(s => s.Height == preferredHeight);
        if (exact is not null) return exact;

        var below = streams.Where(s => s.Height > 0 && s.Height <= preferredHeight).MaxBy(s => s.Height);
        return below ?? streams.MinBy(s => s.Height)!;
    }

    private Task<ProcessResult> RunYtDlpAsync(
        DownloadItem item, YtDlpArgs.Context ctx, CancellationToken ct)
        => runner.RunAsync(
            new ProcessRequest(paths.YtDlp, YtDlpArgs.Build(item, ctx), paths.Bin),
            line => ApplyProgress(item, line),
            ct);

    private static void ApplyProgress(DownloadItem item, string line)
    {
        if (!ProgressParser.TryParse(line, out var p)) return;
        item.DownloadedBytes = p.DownloadedBytes;
        item.TotalBytes = p.TotalBytes;
        item.SpeedBytesPerSecond = p.SpeedBytesPerSecond;
        item.EtaSeconds = p.EtaSeconds;
        item.FragmentIndex = p.FragmentIndex;
        item.FragmentCount = p.FragmentCount;
        if (p.TotalBytes > 0) item.Progress = p.Percent;

        // playlist ที่บอกขนาดรวมไม่ได้ ยังบอกความคืบหน้าจากจำนวนชิ้นส่วนได้
        else if (p.FragmentCount > 0)
            item.Progress = Math.Clamp(p.FragmentIndex * 100.0 / p.FragmentCount, 0, 100);
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
