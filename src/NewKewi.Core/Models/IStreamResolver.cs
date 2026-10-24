namespace NewKewi.Core.Models;

/// <summary>ผลการแกะลิงก์ของเว็บหนึ่ง</summary>
public sealed record ResolveOutcome(
    bool Handled,
    string? ModuleName,
    string? Title,
    IReadOnlyList<MediaStream> Streams,
    string? Error)
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
    ResolveOutcome Resolve(string url, CancellationToken ct);
}
