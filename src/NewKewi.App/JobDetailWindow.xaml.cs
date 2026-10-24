using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using NewKewi.Core.Models;
using NewKewi.Core.Settings;

namespace NewKewi.App;

/// <summary>
/// หน้าต่างรายละเอียดงานเดียว · ดับเบิลคลิกแถวในคิวแล้วเปิดขึ้นมา
///
/// **ข้อจำกัดที่ต้องรู้:** IDM วาดแถบแยกต่อ connection ได้เพราะมันยิง HTTP range เอง
/// ของเราใช้ yt-dlp เป็นตัวโหลด ซึ่งรายงานความคืบหน้า**รวม** ไม่ได้แยกเป็นรายช่อง
/// ที่นี่จึงแสดงของที่เป็นข้อมูลจริงเท่านั้น: แถบรวม + แถบชิ้นส่วนของ HLS + จำนวนช่องที่ตั้งไว้
/// ไม่วาดแถบต่อช่องแบบเดาเอา เพราะมันจะเป็นภาพหลอก
/// </summary>
public partial class JobDetailWindow : Window
{
    private const int MaxSegments = 120;   // ชิ้นส่วนเยอะกว่านี้ก็ยุบรวมให้ ไม่งั้นวาดไม่ไหว

    private readonly DownloadItem _item;
    private readonly AppSettings _settings;
    private readonly DispatcherTimer _timer;

    private static readonly Brush SegmentDone =
        new SolidColorBrush(Color.FromRgb(0x29, 0x97, 0xFF));
    private static readonly Brush SegmentPending =
        new SolidColorBrush(Color.FromRgb(0xD6, 0xEA, 0xFF));

    public JobDetailWindow(DownloadItem item, AppSettings settings)
    {
        InitializeComponent();
        _item = item;
        _settings = settings;

        SegmentDone.Freeze();
        SegmentPending.Freeze();

        _timer = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = TimeSpan.FromMilliseconds(500),
        };
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();

        Refresh();
    }

    private void Refresh()
    {
        Title = "รายละเอียด — " + (_item.Title.Length > 0 ? _item.Title : _item.SourceUrl);
        TitleText.Text = _item.Title.Length > 0 ? _item.Title : "(ยังไม่รู้ชื่อ)";

        var status = (string)new StatusTextConverter().Convert(
            _item.Status, typeof(string), null, System.Globalization.CultureInfo.CurrentCulture);
        StatusLine.Text = status;

        OverallBar.Value = _item.Progress;
        OverallText.Text = _item.Progress > 0 ? $"{_item.Progress:0.#}%" : "";

        SizeText.Text = ByteSizeConverter.Format(_item.TotalBytes);
        DoneText.Text = ByteSizeConverter.Format(_item.DownloadedBytes);
        SpeedText.Text = _item.SpeedBytesPerSecond > 0
            ? ByteSizeConverter.Format(_item.SpeedBytesPerSecond) + "/s" : "—";
        EtaText.Text = (string)new EtaConverter().Convert(
            _item.EtaSeconds, typeof(string), null, System.Globalization.CultureInfo.CurrentCulture);

        SourceUrlText.Text = _item.SourceUrl;
        StreamUrlText.Text = _item.Stream?.Url ?? "(ยังไม่ได้แกะลิงก์ — ส่งหน้าเว็บให้ yt-dlp ลองเอง)";
        KindText.Text = DescribeKind();
        ModuleText.Text = _item.ModuleName ?? "ไม่มี config ของเว็บนี้ (ใช้ทางทั่วไป)";
        ChannelText.Text = DescribeChannels();
        OutputText.Text = _item.OutputFile ?? _item.OutputDirectory;
        ElapsedText.Text = DescribeElapsed();
        NoteText.Text = _item.FailureReason ?? "";

        UpdateSegments();

        if (_item.IsFinished) _timer.Stop();
    }

    private string DescribeKind() => _item.Stream?.Kind switch
    {
        StreamKind.Hls => "HLS (m3u8) — โหลดเป็นชิ้นส่วน",
        StreamKind.Dash => "DASH (mpd) — โหลดเป็นชิ้นส่วน",
        StreamKind.File => "ไฟล์เดี่ยว",
        StreamKind.Page => "หน้าเว็บ (ให้ yt-dlp จัดการเอง)",
        _ => "—",
    };

    /// <summary>
    /// บอกตามจริงว่าตั้งกี่ช่อง และทำไมถึงไม่มีแถบแยกต่อช่องให้ดู
    /// </summary>
    private string DescribeChannels()
    {
        var n = _settings.ChannelsPerDownload;
        var playlist = _item.Stream?.IsPlaylist ?? false;

        var how = playlist
            ? $"โหลดชิ้นส่วนพร้อมกัน {n} ชิ้น (--concurrent-fragments)"
            : $"แตกเป็น {n} การเชื่อมต่อด้วย aria2c (-x{n} -s{n})";

        return how + " · yt-dlp รายงานความคืบหน้ารวมเท่านั้น " +
               "จึงไม่มีตัวเลขรายช่องให้แสดงแยก";
    }

    private string DescribeElapsed()
    {
        if (_item.StartedAt is not { } start) return "—";
        var end = _item.FinishedAt ?? DateTimeOffset.Now;
        var span = end - start;
        return span.TotalHours >= 1
            ? $"{(int)span.TotalHours}:{span.Minutes:00}:{span.Seconds:00}"
            : $"{span.Minutes}:{span.Seconds:00}";
    }

    /// <summary>แถบแบ่งชิ้นส่วน — ข้อมูลจริงจาก fragment_index / fragment_count ของ yt-dlp</summary>
    private void UpdateSegments()
    {
        if (_item.FragmentCount <= 1)
        {
            FragmentPanel.Visibility = Visibility.Collapsed;
            return;
        }

        FragmentPanel.Visibility = Visibility.Visible;
        FragmentLabel.Text = $"ชิ้นส่วน {_item.FragmentIndex} / {_item.FragmentCount}";

        var cells = Math.Min(_item.FragmentCount, MaxSegments);
        var filled = (int)Math.Round(cells * (double)_item.FragmentIndex / _item.FragmentCount);

        var brushes = new Brush[cells];
        for (var i = 0; i < cells; i++) brushes[i] = i < filled ? SegmentDone : SegmentPending;
        SegmentStrip.ItemsSource = brushes;
    }

    private void OnOpenFolder(object sender, RoutedEventArgs e)
    {
        var target = _item.OutputFile is { } f && File.Exists(f)
            ? $"/select,\"{f}\""
            : $"\"{_item.OutputDirectory}\"";
        Process.Start(new ProcessStartInfo("explorer.exe", target) { UseShellExecute = true });
    }

    protected override void OnClosed(EventArgs e)
    {
        _timer.Stop();
        base.OnClosed(e);
    }
}
