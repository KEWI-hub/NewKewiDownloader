using System.IO.Compression;
using NewKewi.Core.Processes;

namespace NewKewi.Core.Tools;

public sealed record ToolInstallResult(bool Ok, int Installed, string Message);

/// <summary>
/// โหลดเครื่องมือใน <c>bin/</c> มาเองตอนที่ยังไม่มี
///
/// ทำแบบเดียวกับ <c>ChromiumInstaller</c> ด้วยเหตุผลเดียวกัน: ของพวกนี้ใหญ่เกินกว่าจะใส่ใน repo
/// และอัปเดตบ่อยกว่าตัวแอปมาก · ให้แอปโหลดเองแปลว่าได้ yt-dlp รุ่นใหม่โดยไม่ต้องออก release
/// (yt-dlp ออกรุ่นใหม่แทบทุกสัปดาห์เพราะเว็บเปลี่ยนตลอด)
/// </summary>
public sealed class ToolInstaller(AppPaths paths, IDownloader downloader, IProcessRunner? runner = null)
{
    /// <summary>ไฟล์หนึ่งตัวที่ต้องได้มาจากแหล่งหนึ่ง</summary>
    private sealed record Wanted(string FileName, string VersionArgument, long MinimumBytes);

    /// <summary>แหล่งหนึ่งแหล่ง · ไฟล์ zip หนึ่งไฟล์อาจให้เครื่องมือได้หลายตัว</summary>
    private sealed record Source(string Label, string Url, bool IsZip, Wanted[] Gives);

    private static readonly Source[] Sources =
    [
        new("yt-dlp", "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
            IsZip: false, [new Wanted("yt-dlp.exe", "--version", 5_000_000)]),

        // ffmpeg กับ ffprobe อยู่ในไฟล์เดียวกัน โหลดครั้งเดียวได้ทั้งคู่
        new("ffmpeg", "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
            IsZip: true,
            [
                new Wanted("ffmpeg.exe", "-version", 20_000_000),
                new Wanted("ffprobe.exe", "-version", 20_000_000),
            ]),

        new("aria2c", "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip",
            IsZip: true, [new Wanted("aria2c.exe", "--version", 1_000_000)]),
    ];

    public IReadOnlyList<string> Missing() => paths.MissingTools();

    /// <summary>ขนาดรวมคร่าวๆ ที่ต้องโหลด · เอาไว้บอกผู้ใช้ก่อนเริ่ม</summary>
    public int ApproximateMegabytes()
    {
        var missing = Missing().ToHashSet(StringComparer.OrdinalIgnoreCase);
        var total = 0;
        foreach (var source in Sources)
        {
            if (!source.Gives.Any(w => missing.Contains(w.FileName))) continue;
            total += source.Label switch { "ffmpeg" => 85, "aria2c" => 3, _ => 18 };
        }
        return total;
    }

    public async Task<ToolInstallResult> EnsureAllAsync(IProgress<string>? progress, CancellationToken ct)
    {
        var missing = Missing().ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (missing.Count == 0) return new ToolInstallResult(true, 0, "เครื่องมือครบอยู่แล้ว");

        Directory.CreateDirectory(paths.Bin);
        Directory.CreateDirectory(paths.Temp);

        var installed = 0;
        var problems = new List<string>();

        foreach (var source in Sources)
        {
            ct.ThrowIfCancellationRequested();

            var needed = source.Gives.Where(w => missing.Contains(w.FileName)).ToList();
            if (needed.Count == 0) continue;

            progress?.Report($"กำลังโหลด {source.Label}");

            var scoped = new Progress<string>(p => progress?.Report($"กำลังโหลด {source.Label} {p}"));
            var ok = source.IsZip
                ? await FromZipAsync(source, needed, scoped, ct).ConfigureAwait(false)
                : await DirectAsync(source, needed[0], scoped, ct).ConfigureAwait(false);

            if (!ok) { problems.Add(source.Label); continue; }

            foreach (var want in needed)
            {
                if (await VerifyAsync(want, ct).ConfigureAwait(false)) installed++;
                else problems.Add(want.FileName);
            }
        }

        if (problems.Count > 0)
            return new ToolInstallResult(false, installed,
                "โหลดไม่สำเร็จ: " + string.Join(", ", problems.Distinct()));

        progress?.Report("เครื่องมือพร้อมใช้งาน");
        return new ToolInstallResult(true, installed, $"โหลดเครื่องมือมาแล้ว {installed} ตัว");
    }

    private async Task<bool> DirectAsync(
        Source source, Wanted want, IProgress<string> progress, CancellationToken ct)
        => await downloader
            .GetFileAsync(source.Url, Path.Combine(paths.Bin, want.FileName), progress, ct)
            .ConfigureAwait(false);

    private async Task<bool> FromZipAsync(
        Source source, List<Wanted> needed, IProgress<string> progress, CancellationToken ct)
    {
        var archive = Path.Combine(paths.Temp, source.Label + ".zip");

        try
        {
            if (!await downloader.GetFileAsync(source.Url, archive, progress, ct).ConfigureAwait(false))
                return false;

            progress.Report("กำลังแตกไฟล์");
            return Extract(archive, needed.Select(w => w.FileName), paths.Bin) == needed.Count;
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException)
        {
            return false;
        }
        finally
        {
            TryDelete(archive);
        }
    }

    /// <summary>
    /// ดึงเฉพาะไฟล์ที่ต้องการออกจาก zip โดยดูที่ **ชื่อไฟล์** ไม่ใช่ path ในไฟล์บีบอัด
    ///
    /// สร้างปลายทางจากชื่อไฟล์ที่เราตั้งเอง และตรวจซ้ำว่าอยู่ใน bin จริง
    /// zip ที่ถูกปั้นมาให้มี <c>../</c> จึงเขียนออกนอกโฟลเดอร์ไม่ได้
    /// </summary>
    internal static int Extract(string archive, IEnumerable<string> fileNames, string targetDir)
    {
        var wanted = fileNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var fullTarget = Path.GetFullPath(targetDir);
        Directory.CreateDirectory(fullTarget);

        var written = 0;
        using var zip = ZipFile.OpenRead(archive);

        foreach (var entry in zip.Entries)
        {
            var name = entry.FullName.Replace('\\', '/');

            // รายการที่มี .. ในเส้นทาง ข้ามทิ้งทั้งอัน
            // ถึงจะประกอบปลายทางจากชื่อไฟล์อยู่แล้วจนออกนอกโฟลเดอร์ไม่ได้
            // แต่ถ้าไม่ข้าม รายการแบบนี้จะ "ชนะ" รายการปกติที่อยู่ถัดไปเพราะมาก่อน
            if (name.Split('/').Any(part => part == "..")) continue;

            var leaf = Path.GetFileName(name);
            if (leaf.Length == 0 || !wanted.Contains(leaf)) continue;

            var destination = Path.GetFullPath(Path.Combine(fullTarget, leaf));
            if (!destination.StartsWith(fullTarget, StringComparison.OrdinalIgnoreCase)) continue;

            entry.ExtractToFile(destination, overwrite: true);
            wanted.Remove(leaf);
            written++;
        }

        return written;
    }

    /// <summary>
    /// ตรวจว่าไฟล์ที่ได้มาใช้งานได้จริง ไม่ใช่แค่มีไฟล์อยู่
    ///
    /// ขนาดผิดปกติมักแปลว่าได้หน้า error ของเว็บมาแทนตัวโปรแกรม
    /// แล้วถ้ามีตัวรันโปรเซสให้ ก็สั่ง <c>--version</c> ดูให้แน่ใจอีกชั้น
    /// </summary>
    private async Task<bool> VerifyAsync(Wanted want, CancellationToken ct)
    {
        var file = Path.Combine(paths.Bin, want.FileName);
        if (!File.Exists(file)) return false;

        if (new FileInfo(file).Length < want.MinimumBytes)
        {
            TryDelete(file);
            return false;
        }

        if (runner is null) return true;

        try
        {
            var result = await runner
                .RunAsync(new ProcessRequest(file, [want.VersionArgument]), null, ct)
                .ConfigureAwait(false);

            if (result.Ok) return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // รันไม่ขึ้นเลย = ไฟล์เสีย
        }

        TryDelete(file);
        return false;
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { /* ถูกจับอยู่ ปล่อยไป */ }
    }
}
