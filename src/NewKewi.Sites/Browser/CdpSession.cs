using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace NewKewi.Sites.Browser;

/// <summary>
/// คุยกับ Chromium ผ่าน Chrome DevTools Protocol
///
/// เขียนเองแทนที่จะลากไลบรารีใหญ่ๆ เข้ามา เพราะเราใช้แค่ไม่กี่คำสั่ง:
/// เปิดหน้า · รอโหลด · อ่าน DOM หลังรัน JS · ดักว่าหน้าเว็บยิง request อะไรออกไปบ้าง
/// </summary>
public sealed class CdpSession : IAsyncDisposable
{
    private readonly ClientWebSocket _ws = new();
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly CancellationTokenSource _loopCts = new();
    private Task? _loop;
    private int _nextId;

    /// <summary>request ทุกตัวที่หน้าเว็บยิงออกไป — ใช้ดักลิงก์วิดีโอที่ JS สร้างขึ้นมา</summary>
    public List<CapturedRequest> Requests { get; } = [];

    private readonly object _requestsLock = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _events = new();

    public static async Task<CdpSession> ConnectAsync(string webSocketUrl, CancellationToken ct)
    {
        var s = new CdpSession();
        await s._ws.ConnectAsync(new Uri(webSocketUrl), ct).ConfigureAwait(false);
        s._loop = Task.Run(() => s.ReceiveLoopAsync(s._loopCts.Token), CancellationToken.None);
        return s;
    }

    public async Task<JsonElement> SendAsync(
        string method, object? parameters, CancellationToken ct, int timeoutSeconds = 30)
    {
        var id = Interlocked.Increment(ref _nextId);
        var tcs = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;

        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            id,
            method,
            @params = parameters ?? new { },
        });
        await _ws.SendAsync(payload, WebSocketMessageType.Text, true, ct).ConfigureAwait(false);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
        try
        {
            return await tcs.Task.WaitAsync(timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            _pending.TryRemove(id, out _);
            throw new TimeoutException($"CDP ไม่ตอบคำสั่ง {method} ภายใน {timeoutSeconds} วินาที");
        }
    }

    /// <summary>รอเหตุการณ์หนึ่งครั้ง เช่น <c>Page.loadEventFired</c> · หมดเวลาแล้วคืน false</summary>
    public async Task<bool> WaitForEventAsync(string method, int timeoutSeconds, CancellationToken ct)
    {
        var tcs = _events.GetOrAdd(method,
            _ => new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously));

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
        try
        {
            await tcs.Task.WaitAsync(timeout.Token).ConfigureAwait(false);
            return true;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            _events.TryRemove(method, out _);
            return false;   // หน้าเว็บโหลดไม่จบก็ยังอ่าน DOM เท่าที่มีได้
        }
    }

    public IReadOnlyList<CapturedRequest> Snapshot()
    {
        lock (_requestsLock) return Requests.ToList();
    }

    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        var message = new MemoryStream();

        try
        {
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                message.SetLength(0);
                WebSocketReceiveResult result;
                do
                {
                    result = await _ws.ReceiveAsync(buffer, ct).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    message.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);   // ข้อความใหญ่ (เช่น outerHTML) มาเป็นหลายท่อน

                Dispatch(Encoding.UTF8.GetString(message.ToArray()));
            }
        }
        catch (OperationCanceledException) { /* ปิดตามปกติ */ }
        catch (WebSocketException) { /* เบราว์เซอร์ปิดไปก่อน */ }
        finally
        {
            foreach (var p in _pending.Values) p.TrySetCanceled();
        }
    }

    private void Dispatch(string text)
    {
        JsonDocument doc;
        try { doc = JsonDocument.Parse(text); }
        catch (JsonException) { return; }

        using (doc)
        {
            var root = doc.RootElement;

            if (root.TryGetProperty("id", out var idEl) && idEl.TryGetInt32(out var id))
            {
                if (!_pending.TryRemove(id, out var tcs)) return;
                if (root.TryGetProperty("error", out var err))
                {
                    tcs.TrySetException(new InvalidOperationException(
                        "CDP ตอบกลับมาเป็น error: " + err.ToString()));
                    return;
                }
                tcs.TrySetResult(root.TryGetProperty("result", out var r) ? r.Clone() : default);
                return;
            }

            if (!root.TryGetProperty("method", out var methodEl)) return;
            var method = methodEl.GetString() ?? "";

            if (method == "Network.requestWillBeSent") RecordRequest(root);

            if (_events.TryRemove(method, out var waiter))
                waiter.TrySetResult(root.TryGetProperty("params", out var p) ? p.Clone() : default);
        }
    }

    private void RecordRequest(JsonElement root)
    {
        if (!root.TryGetProperty("params", out var p)) return;
        if (!p.TryGetProperty("request", out var req)) return;
        if (!req.TryGetProperty("url", out var urlEl)) return;

        var url = urlEl.GetString() ?? "";
        if (url.Length == 0 || url.StartsWith("data:", StringComparison.Ordinal)) return;

        var type = p.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (req.TryGetProperty("headers", out var h) && h.ValueKind == JsonValueKind.Object)
        {
            foreach (var item in h.EnumerateObject())
                headers[item.Name] = item.Value.ToString();
        }

        lock (_requestsLock) Requests.Add(new CapturedRequest(url, type, headers));
    }

    public async ValueTask DisposeAsync()
    {
        await _loopCts.CancelAsync().ConfigureAwait(false);
        try
        {
            if (_ws.State == WebSocketState.Open)
                await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None)
                    .ConfigureAwait(false);
        }
        catch { /* ปิดไม่ลงก็ทิ้งไปเลย */ }

        if (_loop is not null)
        {
            try { await _loop.ConfigureAwait(false); } catch { /* จบแล้ว */ }
        }

        _ws.Dispose();
        _loopCts.Dispose();
    }
}

public sealed record CapturedRequest(string Url, string ResourceType, IReadOnlyDictionary<string, string> Headers);
