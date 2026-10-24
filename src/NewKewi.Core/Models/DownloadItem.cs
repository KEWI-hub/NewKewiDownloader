using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;

namespace NewKewi.Core.Models;

public enum DownloadStatus
{
    Queued,
    Resolving,
    Downloading,
    Remuxing,
    Done,
    Failed,
    Paused,
    Skipped,
}

/// <summary>
/// งานหนึ่งชิ้นในคิว
/// ตัวนี้ถูกเซฟลง queue.json **พร้อมสถานะ** — ของเดิมเก็บแค่รายการ
/// ปิดแอปแล้วเปิดใหม่งานที่ fail กลับมาเป็น "รอโหลด" เองจนไล่ปัญหาไม่ได้
/// </summary>
public sealed class DownloadItem : INotifyPropertyChanged
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n")[..12];

    /// <summary>ลิงก์ที่ผู้ใช้ใส่มา</summary>
    public string SourceUrl { get; set; } = "";

    private string _title = "";
    public string Title { get => _title; set => Set(ref _title, value); }

    /// <summary>ชื่อ Lua module ที่แกะลิงก์นี้ · ว่าง = ไปทางทั่วไป (generic)</summary>
    public string? ModuleName { get; set; }

    /// <summary>สตรีมที่ผู้ใช้เลือก · null = ยังไม่ได้แกะ ให้ส่งหน้าเว็บให้ yt-dlp ลองเอง</summary>
    public MediaStream? Stream { get; set; }

    public string OutputDirectory { get; set; } = "";

    private string? _outputFile;
    /// <summary>ไฟล์ที่ได้จริงหลังโหลดเสร็จ (เต็ม path)</summary>
    public string? OutputFile { get => _outputFile; set => Set(ref _outputFile, value); }

    private DownloadStatus _status = DownloadStatus.Queued;
    public DownloadStatus Status { get => _status; set => Set(ref _status, value); }

    /// <summary>เหตุผลที่ล้มเหลว — ต้องอ่านรู้เรื่อง เพราะไม่มี retry ผู้ใช้ต้องตัดสินใจเอง</summary>
    private string? _failureReason;
    public string? FailureReason { get => _failureReason; set => Set(ref _failureReason, value); }

    private double _progress;
    /// <summary>0–100</summary>
    public double Progress { get => _progress; set => Set(ref _progress, value); }

    private long _downloadedBytes;
    public long DownloadedBytes { get => _downloadedBytes; set => Set(ref _downloadedBytes, value); }

    private long _totalBytes;
    public long TotalBytes { get => _totalBytes; set => Set(ref _totalBytes, value); }

    private double _speedBytesPerSecond;
    [JsonIgnore]
    public double SpeedBytesPerSecond { get => _speedBytesPerSecond; set => Set(ref _speedBytesPerSecond, value); }

    private int _etaSeconds;
    [JsonIgnore]
    public int EtaSeconds { get => _etaSeconds; set => Set(ref _etaSeconds, value); }

    public DateTimeOffset AddedAt { get; set; } = DateTimeOffset.Now;
    public DateTimeOffset? FinishedAt { get; set; }

    /// <summary>โหลดทับแม้มีไฟล์ชื่อเดียวกันอยู่แล้ว</summary>
    public bool Force { get; set; }

    [JsonIgnore]
    public bool IsFinished => Status is DownloadStatus.Done or DownloadStatus.Failed or DownloadStatus.Skipped;

    public event PropertyChangedEventHandler? PropertyChanged;

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }

    /// <summary>ตั้งสถานะล้มเหลว · ไม่มี retry อัตโนมัติ ผู้ใช้กดลองใหม่เองเท่านั้น</summary>
    public void Fail(string reason)
    {
        FailureReason = reason;
        Status = DownloadStatus.Failed;
        FinishedAt = DateTimeOffset.Now;
        SpeedBytesPerSecond = 0;
        EtaSeconds = 0;
    }
}
