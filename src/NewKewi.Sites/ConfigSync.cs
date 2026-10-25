using System.Formats.Tar;
using System.IO.Compression;
using NewKewi.Core;
using NewKewi.Core.GitHub;

namespace NewKewi.Sites;

public sealed record SyncResult(bool Changed, int FilesWritten, string Message);

/// <summary>
/// ดึง config ของเว็บจาก repo สาธารณะมาทับ <c>modules/lua/</c>
///
/// แยก config ออกจากโค้ดก็เพื่อข้อนี้: เพิ่มหรือแก้เว็บแล้วผู้ใช้ได้ทันทีที่เปิดแอปรอบหน้า
/// **ไม่ต้องออก release ใหม่**
///
/// <c>modules/local/</c> ไม่ถูกแตะเลย — ของที่ผู้ใช้เขียนเองชนะเสมอ
/// </summary>
public sealed class ConfigSync(AppPaths paths, IGitHubClient github)
{
    public const string DefaultRepo = "KEWI-hub/NewKewi-configs";
    private const string Branch = "main";

    private string StampFile => Path.Combine(paths.Data, "config-sync.json");

    public string Repo { get; init; } = DefaultRepo;

    public async Task<SyncResult> SyncAsync(CancellationToken ct)
    {
        var sha = await github.GetBranchShaAsync(Repo, Branch, ct).ConfigureAwait(false);
        if (sha is null)
            return new SyncResult(false, 0, "ถาม GitHub ไม่ได้ — ใช้ config ที่มีอยู่ไปก่อน");

        var stamp = Json.Read(StampFile, new Stamp());
        if (stamp.Sha == sha)
            return new SyncResult(false, 0, "config เป็นรุ่นล่าสุดอยู่แล้ว");

        var tarball = Path.Combine(paths.Temp, "configs.tar.gz");
        var downloaded = await github.DownloadTarballAsync(Repo, sha, tarball, ct).ConfigureAwait(false);
        if (downloaded is null)
            return new SyncResult(false, 0, "โหลด config ไม่สำเร็จ");

        int written;
        try
        {
            written = ExtractLuaModules(tarball, paths.LuaModules);
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException)
        {
            return new SyncResult(false, 0, "แตกไฟล์ config ไม่สำเร็จ: " + ex.Message.Split('\n')[0]);
        }
        finally
        {
            TryDelete(tarball);
        }

        Json.Write(StampFile, new Stamp { Sha = sha, When = DateTimeOffset.Now });
        return new SyncResult(true, written, $"อัปเดต config แล้ว {written} ไฟล์");
    }

    /// <summary>
    /// ดึงเฉพาะไฟล์ <c>.lua</c> ที่อยู่ใต้ <c>modules/lua/</c> ใน tarball
    ///
    /// ตรวจชื่อไฟล์เองทุกตัว **ห้ามเชื่อ path ที่มาในไฟล์บีบอัด**
    /// ไฟล์ tar ที่ถูกปั้นมาให้มี <c>../</c> สามารถเขียนทับไฟล์นอกโฟลเดอร์ได้
    /// </summary>
    private static int ExtractLuaModules(string tarball, string targetDir)
    {
        Directory.CreateDirectory(targetDir);
        var fullTarget = Path.GetFullPath(targetDir);
        var written = 0;

        using var file = File.OpenRead(tarball);
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var tar = new TarReader(gzip);

        while (tar.GetNextEntry() is { } entry)
        {
            if (entry.EntryType is not (TarEntryType.RegularFile or TarEntryType.V7RegularFile)) continue;

            var name = entry.Name.Replace('\\', '/');
            if (!name.Contains("/modules/lua/", StringComparison.OrdinalIgnoreCase)) continue;
            if (!name.EndsWith(".lua", StringComparison.OrdinalIgnoreCase)) continue;

            var leaf = Path.GetFileName(name);
            if (leaf.Length == 0) continue;

            var destination = Path.GetFullPath(Path.Combine(fullTarget, leaf));
            if (!destination.StartsWith(fullTarget, StringComparison.OrdinalIgnoreCase)) continue;

            using var output = File.Create(destination);
            entry.DataStream?.CopyTo(output);
            written++;
        }

        return written;
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { /* ช่างมัน */ }
    }

    private sealed class Stamp
    {
        public string? Sha { get; set; }
        public DateTimeOffset? When { get; set; }
    }
}
