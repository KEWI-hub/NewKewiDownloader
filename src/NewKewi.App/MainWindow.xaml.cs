using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Threading;
using NewKewi.Core;
using NewKewi.Core.Engine;
using NewKewi.Core.Models;
using NewKewi.Core.Processes;
using NewKewi.Core.Queue;
using NewKewi.Core.Settings;

namespace NewKewi.App;

public partial class MainWindow : Window
{
    private readonly AppPaths _paths;
    private readonly AppSettings _settings;
    private readonly DownloadQueue _queue;
    private readonly ICollectionView _view;
    private readonly DispatcherTimer _tick;

    public MainWindow()
    {
        InitializeComponent();

        var v = Assembly.GetExecutingAssembly().GetName().Version;
        Title = $"New Kewi Video Downloader v{v?.Major}.{v?.Minor}.{v?.Build}";

        _paths = AppPaths.ForRunningApp();
        _paths.EnsureCreated();
        _settings = new SettingsStore(_paths).Load();
        Directory.CreateDirectory(_settings.DownloadDirectory);

        _queue = new DownloadQueue(_paths, _settings,
            new DownloadEngine(_paths, _settings, new ProcessRunner()));
        _queue.Load();

        _view = CollectionViewSource.GetDefaultView(_queue.Items);
        QueueGrid.ItemsSource = _view;

        // งานรันใน thread พื้นหลัง — รวบยอดอัปเดตแถบสถานะทีเดียวต่อวินาที
        // ดีกว่าให้ทุกบรรทัดความคืบหน้าวิ่งข้ามมาที่ UI thread
        _tick = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = TimeSpan.FromMilliseconds(700),
        };
        _tick.Tick += (_, _) => RefreshStatus();
        _tick.Start();

        RefreshStatus();
        WarnIfToolsMissing();
    }

    private void WarnIfToolsMissing()
    {
        var missing = _paths.MissingTools();
        if (missing.Count == 0) return;
        StatusText.Text = $"ขาดเครื่องมือใน bin\\: {string.Join(", ", missing)} — โหลดอะไรไม่ได้จนกว่าจะมีครบ";
    }

    private void RefreshStatus()
    {
        var items = _queue.Items;
        var active = items.Count(i => i.Status is DownloadStatus.Downloading or DownloadStatus.Remuxing);
        var queued = items.Count(i => i.Status == DownloadStatus.Queued);
        var failed = items.Count(i => i.Status == DownloadStatus.Failed);
        var speed = items.Sum(i => i.SpeedBytesPerSecond);

        StatusText.Text = items.Count == 0
            ? "คิวว่าง — กด \"เพิ่มลิงก์\" เพื่อเริ่ม"
            : $"ทั้งหมด {items.Count} · กำลังโหลด {active} · รอคิว {queued} · ล้มเหลว {failed}" +
              (speed > 0 ? $" · รวม {ByteSizeConverter.Format(speed)}/s" : "");

        StartButton.IsEnabled = !_queue.IsRunning && queued > 0;
        StopButton.IsEnabled = _queue.IsRunning;
    }

    // ---- ปุ่มบน toolbar ----

    private void OnAddUrl(object sender, RoutedEventArgs e)
    {
        var dlg = new AddUrlWindow { Owner = this };
        if (dlg.ShowDialog() != true) return;

        foreach (var url in dlg.Urls) _queue.Add(url);
        _queue.Start();
        RefreshStatus();
    }

    private void OnStart(object sender, RoutedEventArgs e)
    {
        _queue.Start();
        RefreshStatus();
    }

    private void OnStop(object sender, RoutedEventArgs e)
    {
        _queue.Stop();
        RefreshStatus();
    }

    /// <summary>ลองใหม่เกิดได้จากตรงนี้ที่เดียว — ไม่มี retry อัตโนมัติในแอป</summary>
    private void OnRetry(object sender, RoutedEventArgs e)
    {
        foreach (var item in Selected()) _queue.Retry(item);
        RefreshStatus();
    }

    private void OnRemove(object sender, RoutedEventArgs e)
    {
        var picked = Selected();
        if (picked.Count == 0) return;

        var answer = MessageBox.Show(this,
            $"เอา {picked.Count} รายการออกจากคิว?\n(ไฟล์ที่โหลดเสร็จแล้วไม่ถูกลบ)",
            "ลบออกจากคิว", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (answer != MessageBoxResult.Yes) return;

        foreach (var item in picked) _queue.Remove(item);
        RefreshStatus();
    }

    private void OnOpenFolder(object sender, RoutedEventArgs e)
    {
        var item = Selected().FirstOrDefault();
        var target = item?.OutputFile is { } f && File.Exists(f)
            ? $"/select,\"{f}\""
            : $"\"{_settings.DownloadDirectory}\"";
        Process.Start(new ProcessStartInfo("explorer.exe", target) { UseShellExecute = true });
    }

    private void OnRowDoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        // เฟส 5: หน้าต่าง progress ต่องานพร้อมแถบของแต่ละ channel แบบ IDM
        var item = Selected().FirstOrDefault();
        if (item?.OutputFile is { } f && File.Exists(f))
            Process.Start(new ProcessStartInfo(f) { UseShellExecute = true });
    }

    private void OnCategoryChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_view is null) return;
        var tag = (Categories.SelectedItem as ListBoxItem)?.Tag as string ?? "all";

        _view.Filter = tag switch
        {
            "active" => o => ((DownloadItem)o).Status is DownloadStatus.Downloading or DownloadStatus.Remuxing,
            "queued" => o => ((DownloadItem)o).Status == DownloadStatus.Queued,
            "done" => o => ((DownloadItem)o).Status == DownloadStatus.Done,
            "failed" => o => ((DownloadItem)o).Status == DownloadStatus.Failed,
            _ => null,
        };
    }

    private List<DownloadItem> Selected() => QueueGrid.SelectedItems.OfType<DownloadItem>().ToList();

    protected override void OnClosing(CancelEventArgs e)
    {
        // ปิดแอปแล้วต้องเซฟคิวเสมอ — ของเดิมถ้าถูก force kill คิวหายทั้งชุด
        _tick.Stop();
        _queue.Stop();
        _queue.Save();
        base.OnClosing(e);
    }
}
