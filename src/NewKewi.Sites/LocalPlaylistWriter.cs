using System.Text;
using NewKewi.Core.Models;

namespace NewKewi.Sites;

/// <summary>
/// ดึง HLS playlist มาเขียนลงเครื่อง แล้วชี้ไฟล์ย่อยเป็น URL เต็ม
///
/// **ทำไมต้องมีขั้นนี้** — เว็บตระกูล FirePlayer บังคับ header คนละชุดสองขั้น:
/// ตอนขอ playlist ต้องมี <c>Origin</c> กับ <c>Sec-Fetch-*</c> ไม่งั้นได้ <c>security error</c>
/// แต่ตอนโหลดไฟล์ย่อย **ห้ามมี** ไม่งั้นได้ HTTP 500
///
/// yt-dlp ส่ง header ชุดเดียวทั้งงาน จึงไม่มีทางผ่านทั้งสองขั้นด้วยคำสั่งเดียว
/// เราเลยดึง playlist เองด้วยชุดเข้ม เขียนลงเครื่อง แล้วส่ง <c>file:///…</c> ให้ yt-dlp
/// พร้อม referer อย่างเดียว ตอนนั้น yt-dlp จะเห็นแต่ URL เต็มของไฟล์ย่อยและโหลดด้วย header เปล่า
/// </summary>
public sealed class LocalPlaylistWriter(IWebClient web)
{
    /// <summary>คืนสตรีมใหม่ที่ชี้ไฟล์ในเครื่อง · ทำไม่ได้ก็คืนตัวเดิมให้ไปลองทางปกติ</summary>
    public MediaStream Prepare(MediaStream stream, string workDir, CancellationToken ct)
    {
        if (!stream.NeedsSplitHeaders) return stream;

        try
        {
            var master = web.Get(stream.Url, stream.PlaylistHeaders, ct);
            if (!master.Ok || string.IsNullOrWhiteSpace(master.Body)) return stream;

            Directory.CreateDirectory(workDir);
            var stem = Path.Combine(workDir, "hls");

            var written = MasterPlaylist.LooksLikeMaster(master.Body)
                ? WriteMaster(master.Body, stream, stem, ct)
                : WriteSingle(master.Body, stream.Url, stem + "-0.m3u8");

            if (written is null) return stream;

            return new MediaStream
            {
                Url = "file:///" + written.Replace('\\', '/'),
                Kind = StreamKind.Hls,
                Height = stream.Height,
                Label = stream.Label,
                Container = stream.Container,
                Expires = stream.Expires,
                // เหลือแต่ referer · header ชุดเข้มใช้ไปแล้วตอนดึง playlist
                // ถ้าส่งต่อไปให้ yt-dlp ไฟล์ย่อยจะโดน HTTP 500
                Referer = stream.Referer,
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return stream;   // เตรียมไม่ได้ก็ให้ไปลองทางปกติ ดีกว่าทำให้ทั้งงานล้ม
        }
    }

    /// <summary>master ที่มีหลายความชัด · ดึงทุกความชัดมาเขียนเป็นไฟล์ของตัวเอง</summary>
    private string? WriteMaster(string body, MediaStream stream, string stem, CancellationToken ct)
    {
        var lines = body.Split('\n').Select(l => l.TrimEnd('\r')).ToList();
        var output = new List<string>();
        var count = 0;

        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];

            if (!line.StartsWith("#EXT-X-STREAM-INF", StringComparison.Ordinal))
            {
                // ข้ามบรรทัด url ของความชัด เพราะเราเขียนชื่อไฟล์ในเครื่องแทนไปแล้ว
                var previous = i > 0 ? lines[i - 1] : "";
                if (!previous.StartsWith("#EXT-X-STREAM-INF", StringComparison.Ordinal))
                    output.Add(line);
                continue;
            }

            var target = NextUri(lines, i);
            if (target.Length == 0) continue;

            var variantUrl = Lua.LuaSandbox.UrlJoin(stream.Url, target);
            var variant = web.Get(variantUrl, stream.PlaylistHeaders, ct);
            if (!variant.Ok || string.IsNullOrWhiteSpace(variant.Body)) continue;

            count++;
            var file = $"{stem}-{count}.m3u8";
            WriteSingle(variant.Body, variantUrl, file);

            output.Add(line);
            output.Add(Path.GetFileName(file));
        }

        if (count == 0) return null;

        var masterFile = stem + "-master.m3u8";
        File.WriteAllText(masterFile, string.Join('\n', output) + "\n", new UTF8Encoding(false));
        return masterFile;
    }

    /// <summary>playlist เดี่ยว · เขียนไฟล์ย่อยเป็น URL เต็มเพราะ playlist ย้ายมาอยู่ในเครื่องแล้ว</summary>
    private static string WriteSingle(string body, string sourceUrl, string targetFile)
    {
        var lines = body.Split('\n')
            .Select(l => l.TrimEnd('\r'))
            .Select(l => l.Length == 0 || l.StartsWith('#')
                ? RewriteKeyIfAny(l, sourceUrl)
                : Lua.LuaSandbox.UrlJoin(sourceUrl, l));

        Directory.CreateDirectory(Path.GetDirectoryName(targetFile)!);
        File.WriteAllText(targetFile, string.Join('\n', lines) + "\n", new UTF8Encoding(false));
        return targetFile;
    }

    /// <summary>คีย์ของ playlist ที่เข้ารหัสไว้ก็เป็น path เหมือนกัน ต้องทำให้เป็น URL เต็มด้วย</summary>
    private static string RewriteKeyIfAny(string line, string sourceUrl)
    {
        const string Mark = "URI=\"";
        var at = line.IndexOf(Mark, StringComparison.Ordinal);
        if (at < 0) return line;

        var start = at + Mark.Length;
        var end = line.IndexOf('"', start);
        if (end < 0) return line;

        var uri = line[start..end];
        if (uri.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return line;

        return line[..start] + Lua.LuaSandbox.UrlJoin(sourceUrl, uri) + line[end..];
    }

    private static string NextUri(List<string> lines, int from)
    {
        for (var j = from + 1; j < lines.Count; j++)
        {
            var candidate = lines[j].Trim();
            if (candidate.Length == 0 || candidate.StartsWith('#')) continue;
            return candidate;
        }
        return "";
    }
}
