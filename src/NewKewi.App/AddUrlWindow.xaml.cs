using System.Windows;

namespace NewKewi.App;

public partial class AddUrlWindow : Window
{
    public AddUrlWindow()
    {
        InitializeComponent();
        Loaded += (_, _) =>
        {
            // คนส่วนใหญ่ก๊อปลิงก์มาก่อนแล้วค่อยเปิดหน้านี้ — เติมให้เลยถ้าคลิปบอร์ดเป็นลิงก์
            try
            {
                var clip = Clipboard.GetText()?.Trim();
                if (!string.IsNullOrEmpty(clip) &&
                    Uri.TryCreate(clip, UriKind.Absolute, out var u) &&
                    (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps))
                {
                    UrlBox.Text = clip;
                }
            }
            catch { /* คลิปบอร์ดถูกแอปอื่นจับอยู่ ไม่เป็นไร */ }

            UrlBox.Focus();
            UrlBox.SelectAll();
        };
    }

    /// <summary>ลิงก์ที่ผู้ใช้ใส่ แยกบรรทัดแล้วตัดอันที่ไม่ใช่ http(s) ทิ้ง</summary>
    public IReadOnlyList<string> Urls { get; private set; } = [];

    private void OnOk(object sender, RoutedEventArgs e)
    {
        Urls = UrlBox.Text
            .Split(['\n', '\r'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(l => Uri.TryCreate(l, UriKind.Absolute, out var u) &&
                        (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (Urls.Count == 0)
        {
            MessageBox.Show(this, "ไม่เจอลิงก์ที่ใช้ได้ — ต้องขึ้นต้นด้วย http:// หรือ https://",
                "เพิ่มลิงก์", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        DialogResult = true;
    }
}
