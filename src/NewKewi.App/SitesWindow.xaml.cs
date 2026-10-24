using System.Diagnostics;
using System.IO;
using System.Windows;
using NewKewi.Sites;

namespace NewKewi.App;

public sealed record SiteRow(string Name, string Domains, int Version, string Source);

/// <summary>รายชื่อเว็บที่มี config อยู่ · บอกด้วยว่าไฟล์ไหนโหลดไม่ขึ้นเพราะอะไร</summary>
public partial class SitesWindow : Window
{
    private readonly SiteRegistry _registry;

    public SitesWindow(SiteRegistry registry)
    {
        InitializeComponent();
        _registry = registry;

        Grid.ItemsSource = registry.Modules
            .Select(m => new SiteRow(
                m.Name,
                string.Join(", ", m.Domains),
                m.Version,
                m.IsLocal ? "ของคุณเอง" : "ซิงก์จาก repo"))
            .OrderBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        var domains = registry.Modules.Sum(m => m.Domains.Count);
        SummaryText.Text =
            $"มี config ของเว็บ {registry.Modules.Count} ตัว ครอบคลุม {domains} โดเมน · " +
            "เว็บที่ไม่อยู่ในรายการนี้แอปจะลองทางทั่วไปให้เอง (ยิง yt-dlp ก่อน แล้วค่อยอ่านหน้าเว็บ)";

        if (registry.LoadErrors.Count > 0)
        {
            ErrorPanel.Visibility = Visibility.Visible;
            ErrorList.ItemsSource = registry.LoadErrors
                .Select(e => $"{Path.GetFileName(e.File)} — {e.Error}")
                .ToList();
        }
    }

    private void OnOpenFolder(object sender, RoutedEventArgs e)
    {
        var folder = _registry.ModuleSearchPaths.FirstOrDefault(Directory.Exists);
        if (folder is null) return;
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = true });
    }
}
