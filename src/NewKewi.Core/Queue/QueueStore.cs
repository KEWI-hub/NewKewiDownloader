using NewKewi.Core.Models;

namespace NewKewi.Core.Queue;

/// <summary>อ่าน/เขียน queue.json · ผ่าน <see cref="Json"/> จึงไม่มี BOM ให้ไปพังตอนอ่านกลับ</summary>
public sealed class QueueStore(AppPaths paths)
{
    /// <summary>ไฟล์พังหรือหาย → คิวว่าง ดีกว่าเปิดแอปไม่ขึ้น · เหตุผลอยู่ใน <paramref name="error"/></summary>
    public IReadOnlyList<DownloadItem> Load(out string? error)
        => Json.Read(paths.QueueFile, new List<DownloadItem>(), out error);

    public IReadOnlyList<DownloadItem> Load() => Load(out _);

    public void Save(IEnumerable<DownloadItem> items)
        => Json.Write(paths.QueueFile, items.ToList());
}
