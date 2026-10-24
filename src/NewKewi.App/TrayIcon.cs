using System.IO;
using System.Windows;

namespace NewKewi.App;

/// <summary>
/// ไอคอนในถาดระบบ · ย่อแอปลงไปแล้วยังโหลดต่อได้
///
/// ใช้ <c>NotifyIcon</c> ของ WinForms เพราะ WPF ไม่มีของแบบนี้ในตัว
/// สำคัญ: ต้อง <see cref="Dispose"/> ตอนปิดแอป ไม่งั้นจะเหลือไอคอนผีค้างในถาด
/// (ของเดิมเจอปัญหานี้ตอนถูก force kill)
/// </summary>
public sealed class TrayIcon : IDisposable
{
    private readonly System.Windows.Forms.NotifyIcon _icon;
    private readonly Window _window;
    private bool _disposed;

    public TrayIcon(Window window, string iconPath)
    {
        _window = window;

        _icon = new System.Windows.Forms.NotifyIcon
        {
            Text = "New Kewi Video Downloader",
            Visible = true,
            Icon = LoadIcon(iconPath),
        };

        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Items.Add("เปิดหน้าต่าง", null, (_, _) => Restore());
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        menu.Items.Add("ออกจากโปรแกรม", null, (_, _) =>
            _window.Dispatcher.Invoke(() => Application.Current.Shutdown()));
        _icon.ContextMenuStrip = menu;

        _icon.DoubleClick += (_, _) => Restore();

        _window.StateChanged += (_, _) =>
        {
            if (_window.WindowState == WindowState.Minimized) _window.Hide();
        };
    }

    /// <summary>ขึ้นข้อความสั้นๆ เหนือถาด เช่น ตอนคิวจบ</summary>
    public void Notify(string title, string message)
    {
        if (_disposed) return;
        _icon.BalloonTipTitle = title;
        _icon.BalloonTipText = message;
        _icon.ShowBalloonTip(4000);
    }

    private void Restore() => _window.Dispatcher.Invoke(() =>
    {
        _window.Show();
        _window.WindowState = WindowState.Normal;
        _window.Activate();
    });

    private static System.Drawing.Icon LoadIcon(string path)
    {
        try
        {
            if (File.Exists(path)) return new System.Drawing.Icon(path);
        }
        catch (Exception ex) when (ex is ArgumentException or IOException)
        {
            // ไฟล์ไอคอนเสีย — ใช้ไอคอนของระบบแทน ดีกว่าแอปเปิดไม่ขึ้น
        }
        return System.Drawing.SystemIcons.Application;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _icon.Visible = false;     // ต้องซ่อนก่อน Dispose ไม่งั้นไอคอนค้างในถาด
        _icon.Dispose();
    }
}
