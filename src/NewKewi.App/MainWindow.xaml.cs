using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Threading;
using NewKewi.Bridge;
using NewKewi.Core;
using NewKewi.Core.Engine;
using NewKewi.Core.GitHub;
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
    private readonly BridgeServer? _bridge;
    private readonly NamingRules _naming;
    private readonly GitHubClient _github = new();
    private readonly DiagnosticReporter _reporter;

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
            ExtensionPaths = ResolveExtensions(),
            BotWallWaitSeconds = _settings.BotWallWaitSeconds,
        })
        {
            OnNotice = message => Dispatcher.Invoke(() => StatusText.Text = message),
        };

        _naming = NamingRules.Load(Path.Combine(_paths.Root, "modules", "naming.json"));

        var generic = new GenericResolver(new PageFetcher(_web, _browser), _web, _browser, _naming)
        {
            AllowInteractiveBotWall = _settings.AllowInteractiveBotWall,
        };

        var resolver = new SiteResolver(
            new LuaResolver(_registry, _web, _browser), generic, new LocalPlaylistWriter(_web));

        _queue = new DownloadQueue(_paths, _settings,
            new DownloadEngine(_paths, _settings, new ProcessRunner(), resolver, _identity, _naming));
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

        _bridge = StartBridge();

        var appVersion = $"{v?.Major}.{v?.Minor}.{v?.Build}";
        _reporter = new DiagnosticReporter(_github, DiagnosticReporter.DefaultRepo, appVersion)
        {
            SendWithoutAsking = _settings.AutoUploadDiagnostics,
            AskBeforeSending = AskBeforeSendingReport,
        };

        RefreshStatus();
        WarnIfToolsMissing();
        _ = SyncConfigsAsync();
    }

    /// <summary>
    /// ดึง config ของเว็บรุ่นล่าสุดมาตอนเปิดแอป · ทำเบื้องหลัง ไม่ขวางการใช้งาน
    /// ล้มเหลวก็ไม่เป็นไร ใช้ config ที่มีอยู่ต่อได้
    /// </summary>
    private async Task SyncConfigsAsync()
    {
        try
        {
            var sync = new ConfigSync(_paths, _github);
            var result = await Task.Run(() => sync.SyncAsync(CancellationToken.None));
            if (!result.Changed) return;

            _registry.Load();   // ใช้ของใหม่ทันที ไม่ต้องรอเปิดแอปรอบหน้า
            StatusText.Text = result.Message + $" · รองรับ {_registry.Modules.Count} เว็บ";
        }
        catch (Exception ex)
        {
            StatusText.Text = "ซิงก์ config ไม่สำเร็จ: " + ex.Message.Split('\n')[0];
        }
    }

    /// <summary>
    /// ขออนุญาตก่อนส่ง log ขึ้น GitHub ทุกครั้ง
    /// โชว์ให้เห็นด้วยว่าจะส่งอะไรไปบ้าง — ไม่ใช่ขอแบบลอยๆ
    /// </summary>
    private bool AskBeforeSendingReport(DiagnosticReport report)
    {
        return Dispatcher.Invoke(() =>
        {
            var preview = string.Join("\n", report.Trail.Take(8).Select(t => "  • " + t));
            var answer = MessageBox.Show(this,
                $"โหลดเว็บ {report.Host} ไม่สำเร็จ\n\n" +
                "ส่งข้อมูลนี้ขึ้น repo ส่วนตัวเพื่อเอาไปเขียน config ของเว็บนี้ไหม?\n\n" +
                $"โดเมน: {report.Host}\n" +
                $"path ของหน้า: {report.UrlPath}\n" +
                $"สาเหตุ: {report.Reason}\n" +
                (preview.Length > 0 ? $"ทางที่เดินมา:\n{preview}\n" : "") +
                "\nไม่ส่ง: url เต็ม, query string, cookie, ชื่อไฟล์ปลายทาง",
                "ส่ง log ให้ไปทำ config?", MessageBoxButton.YesNo, MessageBoxImage.Question,
                MessageBoxResult.No);

            return answer == MessageBoxResult.Yes;
        });
    }

    /// <summary>คิวจบแล้วบอกผ่านถาดระบบ · ผู้ใช้จะได้ไม่ต้องนั่งเฝ้าหน้าต่าง</summary>
    private void OnItemFinished(object? sender, DownloadItem item)
    {
        Dispatcher.BeginInvoke(() =>
        {
            RefreshStatus();

            // เว็บที่ยังไม่มี config — เสนอส่ง log ไปให้เขียน config ต่อ
            if (item is { Status: DownloadStatus.Failed, Diagnostics.Count: > 0 })
                _ = SendReportAsync(item);

            if (_queue.Items.Any(i => !i.IsFinished)) return;

            var done = _queue.Items.Count(i => i.Status == DownloadStatus.Done);
            var failed = _queue.Items.Count(i => i.Status == DownloadStatus.Failed);
            _tray.Notify("คิวจบแล้ว",
                failed > 0 ? $"เสร็จ {done} · ล้มเหลว {failed}" : $"เสร็จครบ {done} รายการ");
        });
    }

    private async Task SendReportAsync(DownloadItem item)
    {
        var diagnostics = item.Diagnostics;
        item.Diagnostics = null;   // เสนอครั้งเดียวพอ ไม่ถามซ้ำถ้าผู้ใช้กดลองใหม่

        try
        {
            var result = await _reporter.ReportAsync(
                item.SourceUrl, item.FailureReason, diagnostics, CancellationToken.None);

            if (result.Ok) StatusText.Text = "ส่ง log แล้ว — config ของเว็บนี้จะตามมาทีหลัง";
            else if (result.Error is { } error && !error.Contains("ไม่ได้อนุญาต"))
                StatusText.Text = "ส่ง log ไม่สำเร็จ: " + error;
        }
        catch (Exception ex)
        {
            StatusText.Text = "ส่ง log ไม่สำเร็จ: " + ex.Message.Split('\n')[0];
        }
    }

    /// <summary>
    /// เปิดช่องให้ส่วนขยายในเบราว์เซอร์ส่งลิงก์เข้ามา
    /// เปิดไม่ขึ้น (พอร์ตถูกใช้อยู่) ก็ไม่ทำให้แอปพัง แค่ใช้ส่วนขยายไม่ได้
    /// </summary>
    private BridgeServer? StartBridge()
    {
        try
        {
            var version = Assembly.GetExecutingAssembly().GetName().Version;
            var bridge = new BridgeServer(_paths, $"{version?.Major}.{version?.Minor}.{version?.Build}")
            {
                PairRequested = AskUserToPair,
                LinkReceived = link => Dispatcher.Invoke(() => AcceptLink(link)),
            };
            bridge.Start();
            return bridge;
        }
        catch (Exception ex)
        {
            StatusText.Text = $"เปิดช่องรับลิงก์จากเบราว์เซอร์ไม่ได้ (พอร์ต {BridgeServer.DefaultPort}): " +
                              ex.Message.Split('\n')[0];
            return null;
        }
    }

    /// <summary>
    /// ส่วนขยายขอจับคู่ · **ต้องให้ผู้ใช้กดเองเสมอ** ห้ามอนุญาตอัตโนมัติ
    /// ถูกเรียกจาก thread ของเซิร์ฟเวอร์ จึงต้องเด้งกลับมาถามบน UI thread
    /// </summary>
    private bool AskUserToPair(string name)
    {
        return Dispatcher.Invoke(() =>
        {
            if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
            Show();
            Activate();

            var answer = MessageBox.Show(this,
                $"ส่วนขยายในเบราว์เซอร์ขอเชื่อมต่อกับแอป\n\nชื่อที่แจ้งมา: {name}\n\n" +
                "อนุญาตเฉพาะตอนที่คุณเพิ่งกดจับคู่ในเบราว์เซอร์เองเท่านั้น",
                "ขออนุญาตเชื่อมต่อ", MessageBoxButton.YesNo, MessageBoxImage.Question,
                MessageBoxResult.No);

            return answer == MessageBoxResult.Yes;
        });
    }

    /// <summary>ลิงก์ที่ส่วนขยายส่งมา · เข้าคิวแล้วเริ่มโหลดเลย</summary>
    private void AcceptLink(IncomingLink link)
    {
        var item = _queue.Add(link.Url, link.Title ?? "");
        item.PreferredHeight = link.Height;

        // ส่งลิงก์สตรีมมาตรงๆ ก็ไม่ต้องให้ resolver ไปแกะหน้าเว็บซ้ำ
        if (!string.IsNullOrEmpty(link.Kind) && link.Kind != "page")
        {
            item.Stream = new MediaStream
            {
                Url = link.Url,
                Kind = link.Kind switch
                {
                    "hls" => StreamKind.Hls,
                    "dash" => StreamKind.Dash,
                    _ => StreamKind.File,
                },
                Height = link.Height,
                Referer = link.Referer,
            };
            foreach (var (k, v) in link.Headers) item.Stream.PlaylistHeaders[k] = v;
        }

        _queue.Save();
        _queue.Start();
        RefreshStatus();
        _tray.Notify("รับลิงก์จากเบราว์เซอร์แล้ว", item.Title.Length > 0 ? item.Title : link.Url);
    }

    /// <summary>
    /// ส่วนขยายที่จะเสียบเข้า Chromium พกพา
    ///
    /// 1. ตัวของแอปเอง (<c>extension\</c>) — ทำให้เบราว์เซอร์ของแอปมีปุ่มโหลดเหนือวิดีโอด้วย
    /// 2. ตัวกันโฆษณา — จากที่ตั้งค่าไว้ หรือ <c>extensions\ad-skipper</c> ข้างตัวแอป
    ///
    /// ไม่เจอก็ไม่เป็นไร แค่ไม่โหลดตัวนั้น
    /// </summary>
    private List<string> ResolveExtensions()
    {
        var found = new List<string>();

        void TakeIfValid(string? path)
        {
            if (string.IsNullOrWhiteSpace(path)) return;
            if (!File.Exists(Path.Combine(path, "manifest.json"))) return;
            if (!found.Contains(path, StringComparer.OrdinalIgnoreCase)) found.Add(path);
        }

        TakeIfValid(Path.Combine(_paths.Root, "extension"));

        TakeIfValid(string.IsNullOrWhiteSpace(_settings.AdBlockExtensionPath)
            ? Path.Combine(_paths.Root, "extensions", "ad-skipper")
            : _settings.AdBlockExtensionPath);

        return found;
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
        _bridge?.Dispose();   // ปล่อยพอร์ตคืน ไม่งั้นเปิดแอปใหม่จะรับลิงก์จากเบราว์เซอร์ไม่ได้
        _tray.Dispose();      // ไม่ทำแล้วจะเหลือไอคอนผีค้างในถาดระบบ
        base.OnClosing(e);
    }
}
