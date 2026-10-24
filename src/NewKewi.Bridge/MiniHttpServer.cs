using System.Net;
using System.Net.Sockets;
using System.Text;

namespace NewKewi.Bridge;

public sealed record HttpRequestLine(string Method, string Path, IReadOnlyDictionary<string, string> Headers, string Body);

public sealed record HttpReply(int Status, string Body, string ContentType = "application/json; charset=utf-8")
{
    public static HttpReply Json(string body) => new(200, body);
    public static HttpReply Text(int status, string message) => new(status, message, "text/plain; charset=utf-8");
}

/// <summary>
/// เซิร์ฟเวอร์ HTTP จิ๋วบน loopback
///
/// เขียนเองบน <see cref="TcpListener"/> แทนที่จะใช้ <c>HttpListener</c> เพราะ HttpListener
/// บน Windows ต้องจอง URL ACL ในบางเครื่อง ซึ่งเด้งขอสิทธิ์ผู้ดูแลระบบ
/// เราต้องการแค่ 3 เส้นทางสั้นๆ จึงคุ้มกว่าที่จะคุมเอง
///
/// ทุก response ปิดการเชื่อมต่อทันที (ไม่มี keep-alive) ให้เรื่องง่ายและคาดเดาได้
/// </summary>
public sealed class MiniHttpServer : IDisposable
{
    private readonly Func<HttpRequestLine, HttpReply> _handle;
    private TcpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _loop;

    public MiniHttpServer(Func<HttpRequestLine, HttpReply> handle) => _handle = handle;

    /// <summary>พอร์ตที่ฟังอยู่จริง · 0 ตอนยังไม่ได้เริ่ม</summary>
    public int Port { get; private set; }

    /// <summary>เริ่มฟัง · ส่ง port 0 เพื่อให้ระบบเลือกพอร์ตว่างให้ (ใช้ในเทส)</summary>
    public void Start(int port)
    {
        if (_listener is not null) return;

        // ผูกกับ loopback เท่านั้น — เครื่องอื่นในวงแลนต่อเข้ามาไม่ได้เลย
        _listener = new TcpListener(IPAddress.Loopback, port);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;

        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => AcceptLoopAsync(_cts.Token), CancellationToken.None);
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await _listener!.AcceptTcpClientAsync(ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }
            catch (SocketException) { return; }
            catch (ObjectDisposedException) { return; }

            // แต่ละ connection แยกกัน · ตัวหนึ่งพังไม่ทำให้ตัวรับหยุดฟัง
            _ = Task.Run(() => ServeAsync(client, ct), CancellationToken.None);
        }
    }

    private async Task ServeAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = 5000;
                client.SendTimeout = 5000;

                await using var stream = client.GetStream();
                var request = await ReadRequestAsync(stream, ct).ConfigureAwait(false);
                if (request is null) return;

                HttpReply reply;
                try { reply = _handle(request); }
                catch (Exception ex)
                {
                    reply = HttpReply.Text(500, "ตัวแอปเกิดข้อผิดพลาด: " + ex.Message.Split('\n')[0]);
                }

                await WriteReplyAsync(stream, reply, ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException)
            {
                // ฝั่งเบราว์เซอร์ตัดการเชื่อมต่อไปก่อน — เรื่องปกติ
            }
        }
    }

    private static async Task<HttpRequestLine?> ReadRequestAsync(NetworkStream stream, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        var received = new MemoryStream();
        int headerEnd;

        // อ่านจนจบส่วนหัว
        while (true)
        {
            var read = await stream.ReadAsync(buffer, ct).ConfigureAwait(false);
            if (read <= 0) return null;

            received.Write(buffer, 0, read);
            if (received.Length > 1_000_000) return null;   // กันคนยัดข้อมูลใหญ่ๆ เข้ามา

            headerEnd = FindHeaderEnd(received.GetBuffer(), (int)received.Length);
            if (headerEnd >= 0) break;
        }

        var all = received.GetBuffer();
        var headerText = Encoding.UTF8.GetString(all, 0, headerEnd);
        var lines = headerText.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0) return null;

        var parts = lines[0].Split(' ');
        if (parts.Length < 2) return null;

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            var colon = line.IndexOf(':');
            if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
        }

        // อ่านเนื้อหาให้ครบตาม Content-Length
        var bodyStart = headerEnd + 4;
        var have = (int)received.Length - bodyStart;
        var want = headers.TryGetValue("Content-Length", out var cl) && int.TryParse(cl, out var n) ? n : 0;

        while (have < want)
        {
            var read = await stream.ReadAsync(buffer, ct).ConfigureAwait(false);
            if (read <= 0) break;
            received.Write(buffer, 0, read);
            have += read;
            all = received.GetBuffer();
        }

        var body = want > 0
            ? Encoding.UTF8.GetString(all, bodyStart, Math.Min(want, (int)received.Length - bodyStart))
            : "";

        return new HttpRequestLine(parts[0].ToUpperInvariant(), parts[1], headers, body);
    }

    private static int FindHeaderEnd(byte[] data, int length)
    {
        for (var i = 0; i + 3 < length; i++)
        {
            if (data[i] == '\r' && data[i + 1] == '\n' && data[i + 2] == '\r' && data[i + 3] == '\n')
                return i;
        }
        return -1;
    }

    private static async Task WriteReplyAsync(NetworkStream stream, HttpReply reply, CancellationToken ct)
    {
        var body = Encoding.UTF8.GetBytes(reply.Body);
        var head = new StringBuilder()
            .Append("HTTP/1.1 ").Append(reply.Status).Append(' ').Append(Reason(reply.Status)).Append("\r\n")
            .Append("Content-Type: ").Append(reply.ContentType).Append("\r\n")
            .Append("Content-Length: ").Append(body.Length).Append("\r\n")
            // ส่วนขยายของเบราว์เซอร์ยิงมาข้าม origin จึงต้องตอบ CORS ให้ครบ
            .Append("Access-Control-Allow-Origin: *\r\n")
            .Append("Access-Control-Allow-Headers: Content-Type, X-NewKewi, X-NewKewi-Token\r\n")
            .Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
            .Append("Access-Control-Max-Age: 600\r\n")
            .Append("Cache-Control: no-store\r\n")
            .Append("Connection: close\r\n\r\n")
            .ToString();

        await stream.WriteAsync(Encoding.UTF8.GetBytes(head), ct).ConfigureAwait(false);
        if (body.Length > 0) await stream.WriteAsync(body, ct).ConfigureAwait(false);
        await stream.FlushAsync(ct).ConfigureAwait(false);
    }

    private static string Reason(int status) => status switch
    {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        _ => "OK",
    };

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { /* ปิดไปแล้ว */ }
        try { _listener?.Stop(); } catch { /* ปิดไปแล้ว */ }

        if (_loop is not null)
        {
            try { _loop.Wait(TimeSpan.FromSeconds(2)); } catch { /* จบแล้ว */ }
        }

        _cts?.Dispose();
        _listener = null;
        _cts = null;
        _loop = null;
    }
}
