namespace NewKewi.Core.Models;

public enum StreamKind
{
    /// <summary>ไฟล์เดียวโหลดตรงๆ (mp4/mkv/webm) — ใช้ aria2c แตกหลายช่องได้</summary>
    File,

    /// <summary>playlist HLS (m3u8) — ใช้ตัวโหลดในตัว yt-dlp เท่านั้น ห้ามใช้ aria2c</summary>
    Hls,

    /// <summary>playlist DASH (mpd) — เหมือน Hls</summary>
    Dash,

    /// <summary>ส่งหน้าเว็บให้ yt-dlp จัดการเอง (ยังไม่ได้แกะลิงก์)</summary>
    Page,
}

/// <summary>
/// สตรีมหนึ่งตัวที่เลือกโหลดได้
/// มี header แยก 2 ขั้น เพราะบางเว็บ (FirePlayer) playlist ต้องมี Origin
/// แต่ไฟล์ย่อย **ห้ามมี** ไม่งั้นได้ HTTP 500 — yt-dlp ส่ง header ชุดเดียวทั้งงาน
/// จึงต้องรู้ตั้งแต่ชั้นนี้ว่าต้องแยกไหม
/// </summary>
public sealed class MediaStream
{
    public string Url { get; set; } = "";
    public StreamKind Kind { get; set; } = StreamKind.Page;

    /// <summary>ความสูงของภาพ เช่น 1080 · 0 = ไม่รู้</summary>
    public int Height { get; set; }

    /// <summary>ป้ายที่โชว์ให้ผู้ใช้เลือก เช่น "1080p"</summary>
    public string Label { get; set; } = "";

    public string? Referer { get; set; }

    /// <summary>นามสกุลที่คาดว่าจะได้ เช่น "mp4" — ใช้ตัดสินใจเรื่อง remux ล่วงหน้า</summary>
    public string? Container { get; set; }

    /// <summary>ลิงก์หมดอายุ → ห้าม cache ต้องให้ resolver ขอใหม่ทุกครั้งที่เริ่มโหลด</summary>
    public bool Expires { get; set; }

    public Dictionary<string, string> PlaylistHeaders { get; set; } = new();
    public Dictionary<string, string> SegmentHeaders { get; set; } = new();

    /// <summary>header 2 ขั้นต่างกันไหม — ถ้าต่าง engine ต้องดึง playlist เองแล้วส่งเป็นไฟล์ให้ yt-dlp</summary>
    public bool NeedsSplitHeaders =>
        Kind is StreamKind.Hls or StreamKind.Dash &&
        !PlaylistHeaders.OrderBy(p => p.Key, StringComparer.OrdinalIgnoreCase)
            .SequenceEqual(SegmentHeaders.OrderBy(p => p.Key, StringComparer.OrdinalIgnoreCase));

    /// <summary>header ที่ใช้ตอนส่งให้ yt-dlp ปกติ (ขั้นที่ไม่ได้แยก)</summary>
    public IReadOnlyDictionary<string, string> EffectiveHeaders =>
        PlaylistHeaders.Count > 0 ? PlaylistHeaders : SegmentHeaders;

    public bool IsPlaylist => Kind is StreamKind.Hls or StreamKind.Dash;
}
