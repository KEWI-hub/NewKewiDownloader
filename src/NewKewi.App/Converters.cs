using System.Globalization;
using System.Windows.Data;
using NewKewi.Core.Models;

namespace NewKewi.App;

public sealed class ByteSizeConverter : IValueConverter
{
    public static string Format(double bytes)
    {
        if (bytes <= 0) return "—";
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        var i = 0;
        while (bytes >= 1024 && i < units.Length - 1) { bytes /= 1024; i++; }
        return $"{bytes:0.#} {units[i]}";
    }

    public object Convert(object? v, Type t, object? p, CultureInfo c)
        => Format(System.Convert.ToDouble(v ?? 0));

    public object ConvertBack(object? v, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

public sealed class SpeedConverter : IValueConverter
{
    public object Convert(object? v, Type t, object? p, CultureInfo c)
    {
        var bps = System.Convert.ToDouble(v ?? 0);
        return bps <= 0 ? "—" : ByteSizeConverter.Format(bps) + "/s";
    }

    public object ConvertBack(object? v, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

public sealed class EtaConverter : IValueConverter
{
    public object Convert(object? v, Type t, object? p, CultureInfo c)
    {
        var s = System.Convert.ToInt32(v ?? 0);
        if (s <= 0) return "—";
        var ts = TimeSpan.FromSeconds(s);
        return ts.TotalHours >= 1 ? $"{(int)ts.TotalHours}:{ts.Minutes:00}:{ts.Seconds:00}"
                                  : $"{ts.Minutes}:{ts.Seconds:00}";
    }

    public object ConvertBack(object? v, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

public sealed class PercentConverter : IValueConverter
{
    public object Convert(object? v, Type t, object? p, CultureInfo c)
    {
        var d = System.Convert.ToDouble(v ?? 0);
        return d <= 0 ? "—" : $"{d:0.#}%";
    }

    public object ConvertBack(object? v, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}

public sealed class StatusTextConverter : IValueConverter
{
    public object Convert(object? v, Type t, object? p, CultureInfo c) => v switch
    {
        DownloadStatus.Queued => "รอคิว",
        DownloadStatus.Resolving => "กำลังหาลิงก์",
        DownloadStatus.Downloading => "กำลังโหลด",
        DownloadStatus.Remuxing => "กำลังทำเป็น mp4",
        DownloadStatus.Done => "เสร็จแล้ว",
        DownloadStatus.Failed => "ล้มเหลว",
        DownloadStatus.Paused => "หยุดพัก",
        DownloadStatus.Skipped => "ข้าม (มีอยู่แล้ว)",
        _ => "—",
    };

    public object ConvertBack(object? v, Type t, object? p, CultureInfo c) => Binding.DoNothing;
}
