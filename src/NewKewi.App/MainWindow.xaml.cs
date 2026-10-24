using System.Collections.ObjectModel;
using System.Reflection;
using System.Windows;

namespace NewKewi.App;

/// <summary>แถวในตารางคิว — เฟส 1 ยังเป็นโครงเปล่า เฟส 2 จะผูกกับ DownloadItem จริง</summary>
public sealed class QueueRow
{
    public string Title { get; init; } = "";
    public string Size { get; init; } = "";
    public string Status { get; init; } = "";
    public string Progress { get; init; } = "";
    public string Speed { get; init; } = "";
    public string Eta { get; init; } = "";
}

public partial class MainWindow : Window
{
    public ObservableCollection<QueueRow> Rows { get; } = new();

    public MainWindow()
    {
        InitializeComponent();

        var v = Assembly.GetExecutingAssembly().GetName().Version;
        Title = $"New Kewi Video Downloader v{v?.Major}.{v?.Minor}.{v?.Build}";

        QueueGrid.ItemsSource = Rows;
        StatusText.Text = "คิวว่าง — กด \"เพิ่มลิงก์\" เพื่อเริ่ม";
    }

    private void OnAddUrl(object sender, RoutedEventArgs e)
    {
        // เฟส 2: เปิดหน้าต่างใส่ลิงก์ → resolver → เลือกความชัด → เข้าคิว
        MessageBox.Show(this,
            "ยังไม่ได้ทำในเฟสนี้ — เฟส 2 จะต่อกับคิวและ yt-dlp",
            "New Kewi Video Downloader",
            MessageBoxButton.OK, MessageBoxImage.Information);
    }
}
