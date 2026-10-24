using System.Globalization;
using System.IO;
using System.Windows;
using Microsoft.Win32;
using NewKewi.Core;
using NewKewi.Core.Settings;

namespace NewKewi.App;

/// <summary>
/// หน้าตั้งค่า · แก้ค่าใน <see cref="AppSettings"/> ที่ส่งเข้ามาโดยตรง
/// ผู้เรียกเป็นคนเซฟลงดิสก์เองหลังกดบันทึก
/// </summary>
public partial class SettingsWindow : Window
{
    private readonly AppSettings _settings;

    public SettingsWindow(AppSettings settings)
    {
        InitializeComponent();
        _settings = settings;

        DirBox.Text = settings.DownloadDirectory;
        ParallelBox.Text = settings.MaxParallelDownloads.ToString(CultureInfo.InvariantCulture);
        ChannelBox.Text = settings.ChannelsPerDownload.ToString(CultureInfo.InvariantCulture);
        FragRetryBox.Text = settings.FragmentRetries.ToString(CultureInfo.InvariantCulture);
        BotWaitBox.Text = settings.BotWallWaitSeconds.ToString(CultureInfo.InvariantCulture);
        AdBlockBox.Text = settings.AdBlockExtensionPath;

        SkipExistingBox.IsChecked = settings.SkipExisting;
        AlwaysMp4Box.IsChecked = settings.AlwaysMp4;
        ReencodeBox.IsChecked = settings.AllowReencodeForMp4;
        InteractiveBox.IsChecked = settings.AllowInteractiveBotWall;
        AutoUploadBox.IsChecked = settings.AutoUploadDiagnostics;
    }

    private void OnPickFolder(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFolderDialog { Title = "เลือกโฟลเดอร์ปลายทาง" };
        if (Directory.Exists(DirBox.Text)) dlg.InitialDirectory = DirBox.Text;
        if (dlg.ShowDialog(this) == true) DirBox.Text = dlg.FolderName;
    }

    private void OnPickExtension(object sender, RoutedEventArgs e)
    {
        var dlg = new OpenFolderDialog { Title = "เลือกโฟลเดอร์ส่วนขยาย (ที่มี manifest.json)" };
        if (Directory.Exists(AdBlockBox.Text)) dlg.InitialDirectory = AdBlockBox.Text;
        if (dlg.ShowDialog(this) != true) return;

        if (!File.Exists(Path.Combine(dlg.FolderName, "manifest.json")))
        {
            MessageBox.Show(this, "โฟลเดอร์นี้ไม่มี manifest.json — ไม่ใช่ส่วนขยาย",
                "ตั้งค่า", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        AdBlockBox.Text = dlg.FolderName;
    }

    /// <summary>ลบ cookie กับ profile ของแอปทิ้งทั้งหมด · ของเบราว์เซอร์ผู้ใช้ไม่ถูกแตะ</summary>
    private void OnClearCookies(object sender, RoutedEventArgs e)
    {
        var answer = MessageBox.Show(this,
            "ลบ cookie และ profile ของแอปทิ้งทั้งหมด?\n" +
            "เว็บที่เคยกดผ่านด่านไว้จะต้องกดใหม่ · cookie ของเบราว์เซอร์ที่คุณใช้อยู่ไม่ถูกแตะ",
            "ล้างข้อมูลเบราว์เซอร์ของแอป", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (answer != MessageBoxResult.Yes) return;

        var paths = AppPaths.ForRunningApp();
        var removed = 0;

        if (File.Exists(paths.CookieJar))
        {
            try { File.Delete(paths.CookieJar); removed++; } catch { /* ถูกจับอยู่ */ }
        }
        // ลบรากของ profile ทีเดียว ครอบทั้งโหมดเงียบและโหมดมีหน้าต่าง
        try
        {
            if (Directory.Exists(paths.BrowserProfile))
            {
                Directory.Delete(paths.BrowserProfile, recursive: true);
                removed++;
            }
        }
        catch { /* ถูกจับอยู่ */ }

        MessageBox.Show(this,
            removed > 0 ? "ล้างแล้ว" : "ไม่มีอะไรให้ล้าง หรือไฟล์ถูกใช้งานอยู่ (ปิดแอปแล้วลองใหม่)",
            "ล้างข้อมูลเบราว์เซอร์ของแอป", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private void OnSave(object sender, RoutedEventArgs e)
    {
        _settings.DownloadDirectory = DirBox.Text.Trim();
        _settings.MaxParallelDownloads = Int(ParallelBox.Text, _settings.MaxParallelDownloads);
        _settings.ChannelsPerDownload = Int(ChannelBox.Text, _settings.ChannelsPerDownload);
        _settings.FragmentRetries = Int(FragRetryBox.Text, _settings.FragmentRetries);
        _settings.BotWallWaitSeconds = Int(BotWaitBox.Text, _settings.BotWallWaitSeconds);
        _settings.AdBlockExtensionPath = AdBlockBox.Text.Trim();

        _settings.SkipExisting = SkipExistingBox.IsChecked == true;
        _settings.AlwaysMp4 = AlwaysMp4Box.IsChecked == true;
        _settings.AllowReencodeForMp4 = ReencodeBox.IsChecked == true;
        _settings.AllowInteractiveBotWall = InteractiveBox.IsChecked == true;
        _settings.AutoUploadDiagnostics = AutoUploadBox.IsChecked == true;

        _settings.Normalized();
        DialogResult = true;
    }

    private static int Int(string text, int fallback)
        => int.TryParse(text.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v)
            ? v : fallback;
}
