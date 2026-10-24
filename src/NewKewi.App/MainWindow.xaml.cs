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
using NewKewi.Sites;
using NewKewi.Sites.Browser;
using WebClient = NewKewi.Sites.WebClient;

namespace NewKewi.App;

public partial class MainWindow : Window
{
    private readonly AppPaths _paths;
    private readonly AppSettings _settings;
    private readonly SiteRegistry _registry;
    private readonly BrowserIdentity _identity;
    private readonly WebClient _web;
    private readonly ChromiumBrowser _browser;
    private readonly DownloadQueue _queue;
    private readonly ICollectionView _view;
    private readonly DispatcherTimer _tick;
    private readonly TrayIcon _tray;

    public MainWindow()
    {
        InitializeComponent();

        var v = Assembly.GetExecutingAssembly().GetName().Version;
        Title = $"New Kewi Video Downloader v{v?.Major}.{v?.Minor}.{v?.Build}";

        _paths = AppPaths.ForRunningApp();
        _paths.EnsureCreated();
        _settings = new SettingsStore(_paths).Load();
        Directory.CreateDirectory(_settings.DownloadDirectory);

        // ชั้นแกะลิงก์: Lua module ของเว็บก่อน ไม่มีค่อยถอยไปอ่านหน้าเว็บเอง
        _registry = new SiteRegistry(new AppPathsView(_paths.LuaModules, _paths.LocalModules));
        _registry.Load();

        // UA ของเบราว์เซอร์ต้องใช้ร่วมกันทุกชั้น ไม่งั้น cookie ที่ฝ่าด่านมาได้จะใช้ไม่ได้
        _identity = new BrowserIdentity(_paths);

        _web = new WebClient(
            TimeSpan.FromSeconds(_settings.SocketTimeoutSeconds > 0 ? _settings.SocketTimeoutSeconds : 30),
            _paths.CookieJar, _identity);

        _browser = new ChromiumBrowser(_paths, _identity, new BrowserOptions
        {
            AdBlockExtensionPath = ResolveAdBlockPath(),
            BotWallWaitSeconds = _settings.BotWallWaitSeconds,
        })
        {
            OnNotice = message => Dispatcher.Invoke(() => StatusText.Text = message),
        };

        var generic = new GenericResolver(new PageFetcher(_web, _browser), _web, _browser)
        {
            AllowInteractiveBotWall = _settings.AllowInteractiveBotWall,
        };

        var resolver = new SiteResolver(new LuaResolver(_registry, _web, _browser), generic);

        _queue = new DownloadQueue(_paths, _settings,
            new DownloadEngine(_paths, _settings, new ProcessRunner(), resolver, _identity));
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

        _tray = new TrayIcon(this, Path.Combine(_paths.Root, "assets", "app.ico"));
        _queue.ItemFinished += OnItemFinished;

        RefreshStatus();
        WarnIfToolsMissing();
    }

    /// <summary>คิวจบแล้วบอกผ่านถาดระบบ · ผู้ใช้จะได้ไม่ต้องนั่งเฝ้าหน้าต่าง</summary>
    private void OnItemFinished(object? sender, DownloadItem item)
    {
        Dispatcher.BeginInvoke(() =>
        {
            RefreshStatus();
            if (_queue.Items.Any(i => !i.IsFinished)) return;

            var done = _queue.Items.Count(i => i.Status == DownloadStatus.Done);
            var failed = _queue.Items.Count(i => i.Status == DownloadStatus.Failed);
            _tray.Notify("คิวจบแล้ว",
                failed > 0 ? $"เสร็จ {done} · ล้มเหลว {failed}" : $"เสร็จครบ {done} รายการ");
        });
    }

    /// <summary>
    /// หาโฟลเดอร์ส่วนขยายกันโฆษณา
    /// ตั้งค่าไว้ก็ใช้ตามนั้น · ไม่ได้ตั้งก็มองหา <c>extensions\ad-skipper</c> ข้างตัวแอป
    /// ไม่เจอก็ไม่เป็นไร แค่ไม่โหลดส่วนขยาย
    /// </summary>
    private string? ResolveAdBlockPath()
    {
        var configured = _settings.AdBlockExtensionPath;
        if (!string.IsNullOrWhiteSpace(configured))
            return Directory.Exists(configured) ? configured : null;

        var beside = Path.Combine(_paths.Root, "extensions", "ad-skipper");
        return Directory.Exists(beside) ? beside : null;
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
            ? $"คิวว่าง — กด \"เพิ่มลิงก์\" เพื่อเริ่ม · มี config ของเว็บ {_registry.Modules.Count} เว็บ" +
              (_registry.LoadErrors.Count > 0 ? $" ({_registry.LoadErrors.Count} ไฟล์โหลดไม่ขึ้น)" : "")
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
        var item = Selected().FirstOrDefault();
        if (item is null) return;
        new JobDetailWindow(item, _settings) { Owner = this }.Show();
    }

    private void OnShowSites(object sender, RoutedEventArgs e)
        => new SitesWindow(_registry) { Owner = this }.ShowDialog();

    private void OnOpenSettings(object sender, RoutedEventArgs e)
    {
        var dlg = new SettingsWindow(_settings) { Owner = this };
        if (dlg.ShowDialog() != true) return;

        new SettingsStore(_paths).Save(_settings);
        MessageBox.Show(this,
            "บันทึกแล้ว · บางอย่าง (จำนวนช่อง, ส่วนขยาย, เบราว์เซอร์) จะมีผลเต็มที่เมื่อเปิดแอปใหม่",
            "ตั้งค่า", MessageBoxButton.OK, MessageBoxImage.Information);
        RefreshStatus();
    }

    /// <summary>
    /// เปิดเบราว์เซอร์จริงให้ผู้ใช้กดผ่านด่านกันบอทของเว็บนั้นเอง แล้วเก็บ cookie ไว้ใช้ต่อ
    ///
    /// แอปไม่ได้แก้โจทย์ให้ — มันแค่เปิดหน้าต่างค้างไว้แล้วรอดูว่าหน้าเปลี่ยนหรือยัง
    /// จากการสำรวจจริง pornavhd.com และ supjav.com ต้องมาทางนี้ Chromium แบบเงียบผ่านเองไม่ได้
    /// </summary>
    private async void OnPassBotWall(object sender, RoutedEventArgs e)
    {
        if (!_browser.IsReady)
        {
            MessageBox.Show(this,
                "ยังไม่ได้ติดตั้ง Chromium พกพา — กด \"เพิ่มลิงก์\" แล้วลองโหลดสักครั้ง " +
                "แอปจะโหลด Chromium มาให้เอง",
                "ผ่านด่านเว็บ", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var seed = Selected().FirstOrDefault()?.SourceUrl ?? "";
        var dlg = new AddUrlWindow { Owner = this, Title = "เปิดเว็บเพื่อกดผ่านด่าน" };
        if (seed.Length > 0) dlg.SetUrl(seed);
        if (dlg.ShowDialog() != true) return;

        var url = dlg.Urls.FirstOrDefault();
        if (url is null) return;

        BotWallButton.IsEnabled = false;
        StatusText.Text = "กำลังเปิดเบราว์เซอร์…";
        try
        {
            var page = await Task.Run(() => _browser.OpenAsync(
                url, BrowseMode.Visible, 30, CancellationToken.None));

            var stillWalled = BotWall.Detect(page.Html, 200);
            StatusText.Text = stillWalled
                ? "ยังผ่านด่านไม่ได้ — ลองใหม่อีกครั้งหรือรอสักพัก"
                : $"ผ่านแล้ว · เก็บ cookie ของ {new Uri(url).Host} ไว้ใช้กับการโหลดแล้ว";
        }
        catch (Exception ex)
        {
            StatusText.Text = "เปิดเบราว์เซอร์ไม่สำเร็จ: " + ex.Message.Split('\n')[0];
        }
        finally
        {
            BotWallButton.IsEnabled = true;
        }
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
        _tray.Dispose();   // ไม่ทำแล้วจะเหลือไอคอนผีค้างในถาดระบบ
        base.OnClosing(e);
    }
}
