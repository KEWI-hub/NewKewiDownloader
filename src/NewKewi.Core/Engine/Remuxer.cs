using System.Text.Json;
using NewKewi.Core.Processes;

namespace NewKewi.Core.Engine;

public sealed record MediaProbe(string FormatNames, string? VideoCodec, string? AudioCodec)
{
    public bool IsMp4Container =>
        FormatNames.Split(',').Any(f => f.Trim() is "mp4" or "mov" or "m4a" or "3gp" or "3g2" or "mj2");
}

public enum RemuxOutcome
{
    /// <summary>เป็น mp4 อยู่แล้ว ไม่ต้องทำอะไร</summary>
    AlreadyMp4,

    /// <summary>เปลี่ยนกล่องเป็น mp4 โดยไม่แตะ codec</summary>
    Copied,

    /// <summary>ต้อง encode ใหม่บางส่วนเพราะ copy ไม่ผ่าน</summary>
    Reencoded,

    Failed,
}

public sealed record RemuxResult(RemuxOutcome Outcome, string FilePath, string? Error = null)
{
    public bool Ok => Outcome != RemuxOutcome.Failed;
}

/// <summary>
/// บังคับให้ไฟล์ที่ได้เป็น .mp4 เสมอ
///
/// **ไม่มีการแปลงเป็น H.265 ทุกกรณี** ของที่เป็น hevc อยู่แล้วก็แค่ copy ไม่แตะ
/// ลำดับที่เดิน: เป็น mp4 แล้ว → จบ · ไม่ใช่ → ลอง copy ทั้งคู่ก่อน
/// copy ไม่ผ่าน → แปลงเฉพาะเสียง → ยังไม่ผ่าน → แปลงภาพเป็น h264 เป็นทางสุดท้าย
/// ลองจริงดีกว่าเดาจากรายชื่อ codec เพราะรายชื่อที่ mp4 รับได้เปลี่ยนไปตามเวอร์ชัน ffmpeg
/// </summary>
public sealed class Remuxer(AppPaths paths, IProcessRunner runner)
{
    public async Task<MediaProbe?> ProbeAsync(string file, CancellationToken ct)
    {
        var r = await runner.RunAsync(new ProcessRequest(paths.FFprobe,
        [
            "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", file,
        ]), null, ct).ConfigureAwait(false);

        if (!r.Ok || string.IsNullOrWhiteSpace(r.StdOut)) return null;

        try
        {
            using var doc = JsonDocument.Parse(r.StdOut);
            var root = doc.RootElement;

            var fmt = root.TryGetProperty("format", out var f) &&
                      f.TryGetProperty("format_name", out var fn)
                ? fn.GetString() ?? "" : "";

            string? video = null, audio = null;
            if (root.TryGetProperty("streams", out var streams))
            {
                foreach (var st in streams.EnumerateArray())
                {
                    var type = st.TryGetProperty("codec_type", out var t) ? t.GetString() : null;
                    var codec = st.TryGetProperty("codec_name", out var c) ? c.GetString() : null;
                    if (type == "video" && video is null) video = codec;
                    else if (type == "audio" && audio is null) audio = codec;
                }
            }
            return new MediaProbe(fmt, video, audio);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public async Task<RemuxResult> EnsureMp4Async(
        string file, bool allowReencode, CancellationToken ct)
    {
        if (!File.Exists(file))
            return new RemuxResult(RemuxOutcome.Failed, file, "หาไฟล์ที่โหลดมาไม่เจอ");

        var probe = await ProbeAsync(file, ct).ConfigureAwait(false);
        if (probe is null)
            return new RemuxResult(RemuxOutcome.Failed, file, "ffprobe อ่านไฟล์ไม่ได้ ไฟล์อาจเสีย");

        var isMp4Ext = Path.GetExtension(file).Equals(".mp4", StringComparison.OrdinalIgnoreCase);
        if (probe.IsMp4Container && isMp4Ext)
            return new RemuxResult(RemuxOutcome.AlreadyMp4, file);

        var target = Path.ChangeExtension(file, ".mp4");
        if (string.Equals(target, file, StringComparison.OrdinalIgnoreCase))
            target = Path.Combine(Path.GetDirectoryName(file)!,
                Path.GetFileNameWithoutExtension(file) + ".remux.mp4");

        // ขั้นที่ 1 — เปลี่ยนกล่องอย่างเดียว เร็วและไม่เสียคุณภาพ
        if (await TryAsync(file, target, ["-c", "copy"], ct).ConfigureAwait(false))
            return await FinishAsync(file, target, RemuxOutcome.Copied);

        if (!allowReencode)
            return new RemuxResult(RemuxOutcome.Failed, file,
                $"ใส่ลงกล่อง mp4 ไม่ได้ (ภาพ {probe.VideoCodec ?? "?"} / เสียง {probe.AudioCodec ?? "?"}) " +
                "และตั้งค่าไว้ไม่ให้ encode ใหม่");

        // ขั้นที่ 2 — เสียงมักเป็นตัวปัญหา (opus/vorbis) แปลงเฉพาะเสียง ภาพยัง copy
        if (await TryAsync(file, target, ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"], ct).ConfigureAwait(false))
            return await FinishAsync(file, target, RemuxOutcome.Reencoded);

        // ขั้นที่ 3 — ทางสุดท้าย แปลงภาพเป็น h264 (ไม่ใช่ h265 ตามที่เจ้าของสั่ง)
        if (await TryAsync(file, target,
                ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k"],
                ct).ConfigureAwait(false))
            return await FinishAsync(file, target, RemuxOutcome.Reencoded);

        return new RemuxResult(RemuxOutcome.Failed, file, "ffmpeg แปลงเป็น mp4 ไม่สำเร็จทั้ง 3 วิธี");
    }

    private async Task<bool> TryAsync(string input, string output, string[] codecArgs, CancellationToken ct)
    {
        var args = new List<string> { "-hide_banner", "-loglevel", "error", "-y", "-i", input };
        args.AddRange(codecArgs);
        args.AddRange(["-movflags", "+faststart", output]);

        var r = await runner.RunAsync(new ProcessRequest(paths.FFmpeg, args), null, ct).ConfigureAwait(false);
        if (r.Ok && File.Exists(output) && new FileInfo(output).Length > 0) return true;

        TryDelete(output);   // อย่าทิ้งไฟล์ครึ่งๆ ไว้ให้ขั้นถัดไปสับสน
        return false;
    }

    /// <summary>แปลงผ่านแล้วค่อยลบต้นฉบับ — ลบก่อนแล้วพังคือเสียไฟล์ฟรี</summary>
    private static Task<RemuxResult> FinishAsync(string source, string target, RemuxOutcome outcome)
    {
        if (!string.Equals(source, target, StringComparison.OrdinalIgnoreCase)) TryDelete(source);
        return Task.FromResult(new RemuxResult(outcome, target));
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { /* ลบไม่ได้ก็ปล่อยไว้ ดีกว่าทำงานล้ม */ }
    }
}
