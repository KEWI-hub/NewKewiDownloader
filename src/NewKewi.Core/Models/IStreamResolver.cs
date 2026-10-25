namespace NewKewi.Core.Models;

/// <summary>ผลการแกะลิงก์ของเว็บหนึ่ง</summary>
public sealed record ResolveOutcome(
    bool Handled,
    string? ModuleName,
    string? Title,
    IReadOnlyList<MediaStream> Streams,
    string? Error,
    /// <summary>ทางที่ตัวแกะลิงก์เดินมา · เป็นวัตถุดิบของ diagnostic bundle ตอนล้มเหลว</summary>
    IReadOnlyList<string>? Trail = null)
{
    /// <summary>ไม่มี config ของเว็บนี้ — ให้ไปทางทั่วไป</summary>
    public static readonly ResolveOutcome NotHandled = new(false, null, null, [], null);

    public bool Ok => Handled && Error is null && Streams.Count > 0;
}

/// <summary>
/// ตัวแกะลิงก์ต่อเว็บ
///
/// อยู่ใน Core เป็น interface เปล่าๆ เพื่อให้ <see cref="Engine.DownloadEngine"/> เรียกได้
/// โดยที่ Core ไม่ต้องรู้จัก Lua หรือ MoonSharp เลย (ตัวจริงอยู่ใน NewKewi.Sites)
/// </summary>
public interface IStreamResolver
{
    /// <summary>แกะด้วย config ของเว็บ · เรียกก่อนส่งงานให้ yt-dlp</summary>
    ResolveOutcome Resolve(string url, CancellationToken ct);

    /// <summary>
    /// ทางสำรองเมื่อ yt-dlp เองไปต่อไม่ได้ — อ่านหน้าเว็บเอง
    ///
    /// นี่**ไม่ใช่ retry** แต่เป็นขั้นถัดไปของความพยายามเดียวกัน ตามลำดับในเอกสาร §4:
    /// ยิง yt-dlp ก่อนเพราะเว็บส่วนใหญ่มันจัดการได้ดีกว่า ค่อยถอยมาอ่านเองเมื่อไม่ไหว
    /// </summary>
    ResolveOutcome ResolveFallback(string url, CancellationToken ct) => ResolveOutcome.NotHandled;

    /// <summary>
    /// เตรียมสตรีมให้พร้อมส่งให้ yt-dlp (เรียกตอนจะโหลดจริงเท่านั้น)
    ///
    /// ใช้กับกรณีที่ playlist กับไฟล์ย่อยต้องใช้ header คนละชุด: yt-dlp ส่ง header ชุดเดียว
    /// ทั้งงาน จึงไม่มีทางผ่านทั้งสองขั้น ต้องดึง playlist มาเขียนลงเครื่องก่อน
    /// แล้วส่งเป็น <c>file://</c> ให้แทน
    ///
    /// คืนสตรีมเดิมถ้าไม่ต้องเตรียมอะไร
    /// </summary>
    MediaStream Prepare(MediaStream stream, string workDir, CancellationToken ct) => stream;
}
