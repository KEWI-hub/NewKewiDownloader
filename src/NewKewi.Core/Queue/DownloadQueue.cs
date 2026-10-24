using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using NewKewi.Core.Engine;
using NewKewi.Core.Models;
using NewKewi.Core.Settings;

namespace NewKewi.Core.Queue;

/// <summary>
/// คิวงาน · โหลดหลายลิงก์พร้อมกันตาม <see cref="AppSettings.MaxParallelDownloads"/>
/// (ส่วน "หลายช่องต่อหนึ่งลิงก์" อยู่ที่ <see cref="YtDlpArgs"/>)
///
/// ไม่มี retry อัตโนมัติ: งานที่ล้มเหลวค้างสถานะ Failed ไว้พร้อมเหตุผล
/// จะเริ่มใหม่ได้ก็ต่อเมื่อผู้ใช้สั่ง <see cref="Retry"/> เองเท่านั้น
/// </summary>
public sealed class DownloadQueue
{
    private readonly AppPaths _paths;
    private readonly AppSettings _settings;
    private readonly DownloadEngine _engine;
    private readonly QueueStore _store;

    private readonly ConcurrentDictionary<string, CancellationTokenSource> _running = new();
    private readonly SemaphoreSlim _slots;
    private readonly object _pumpLock = new();
    private CancellationTokenSource _lifetime = new();

    public DownloadQueue(AppPaths paths, AppSettings settings, DownloadEngine engine)
    {
        _paths = paths;
        _settings = settings;
        _engine = engine;
        _store = new QueueStore(paths);
        _slots = new SemaphoreSlim(settings.MaxParallelDownloads, 64);
    }

    /// <summary>รายการทั้งหมด · UI ผูกกับตัวนี้โดยตรง</summary>
    public ObservableCollection<DownloadItem> Items { get; } = [];

    /// <summary>คิวเดินอยู่ไหม — กด "หยุด" แล้วจะไม่หยิบงานใหม่ขึ้นมา</summary>
    public bool IsRunning { get; private set; }

    public event EventHandler<DownloadItem>? ItemFinished;

    public DownloadItem Add(string url, string? title = null)
    {
        var item = new DownloadItem
        {
            SourceUrl = url.Trim(),
            Title = title ?? "",
            OutputDirectory = _settings.DownloadDirectory,
        };
        Items.Add(item);
        Save();
        return item;
    }

    public void Remove(DownloadItem item)
    {
        Cancel(item);
        Items.Remove(item);
        Save();
    }

    /// <summary>ผู้ใช้กดลองใหม่เอง — ที่เดียวที่งานที่ fail จะกลับมาเข้าคิวได้</summary>
    public void Retry(DownloadItem item)
    {
        if (!item.IsFinished && item.Status != DownloadStatus.Paused) return;
        item.Status = DownloadStatus.Queued;
        item.FailureReason = null;
        item.Progress = 0;
        item.DownloadedBytes = 0;
        item.FinishedAt = null;
        Save();
        Pump();
    }

    public void Cancel(DownloadItem item)
    {
        if (_running.TryRemove(item.Id, out var cts)) cts.Cancel();
    }

    public void Start()
    {
        if (IsRunning) return;
        if (_lifetime.IsCancellationRequested) _lifetime = new CancellationTokenSource();
        IsRunning = true;
        Pump();
    }

    /// <summary>หยุดคิว · งานที่กำลังโหลดอยู่ถูกยกเลิกและกลับไปเป็น Paused</summary>
    public void Stop()
    {
        IsRunning = false;
        _lifetime.Cancel();
        foreach (var id in _running.Keys)
            if (_running.TryRemove(id, out var cts)) cts.Cancel();
        Save();
    }

    /// <summary>หยิบงานที่รออยู่ขึ้นมารันเท่าที่ช่องว่าง</summary>
    public void Pump()
    {
        lock (_pumpLock)
        {
            if (!IsRunning) return;

            foreach (var item in Items.Where(i => i.Status == DownloadStatus.Queued).ToList())
            {
                if (_running.Count >= _settings.MaxParallelDownloads) break;
                if (!_running.TryAdd(item.Id, new CancellationTokenSource())) continue;
                _ = RunOneAsync(item);
            }
        }
    }

    private async Task RunOneAsync(DownloadItem item)
    {
        await _slots.WaitAsync().ConfigureAwait(false);
        try
        {
            if (!_running.TryGetValue(item.Id, out var cts)) return;
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cts.Token, _lifetime.Token);

            try
            {
                await _engine.RunAsync(item, linked.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                item.Status = DownloadStatus.Paused;
            }
        }
        finally
        {
            _slots.Release();
            _running.TryRemove(item.Id, out _);
            Save();
            ItemFinished?.Invoke(this, item);
            Pump();   // ช่องว่างแล้ว หยิบงานถัดไป
        }
    }

    // ---- เก็บลงดิสก์ ----

    /// <summary>
    /// โหลดคิวกลับมา **พร้อมสถานะ** ของเดิมเก็บแค่รายการ ทำให้งานที่ fail
    /// กลับมาเป็น "รอโหลด" เองทุกครั้งที่เปิดแอป จนไล่ปัญหาไม่ได้
    /// ของที่ค้างกลางทางตอนปิดแอปเท่านั้นที่ถูกปัดเป็น Paused
    /// </summary>
    public void Load()
    {
        Items.Clear();
        foreach (var it in _store.Load())
        {
            if (it.Status is DownloadStatus.Downloading or DownloadStatus.Resolving or DownloadStatus.Remuxing)
                it.Status = DownloadStatus.Paused;
            Items.Add(it);
        }
    }

    public void Save() => _store.Save(Items);
}
