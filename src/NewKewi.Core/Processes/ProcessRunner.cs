using System.Diagnostics;
using System.Text;

namespace NewKewi.Core.Processes;

/// <summary>ตัวเรียกจริง · อ่าน stdout ทีละบรรทัดเพื่อรายงานความคืบหน้าแบบสด</summary>
public sealed class ProcessRunner : IProcessRunner
{
    public async Task<ProcessResult> RunAsync(
        ProcessRequest request,
        Action<string>? onStdOutLine,
        CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName = request.FileName,
            WorkingDirectory = request.WorkingDirectory ?? Path.GetDirectoryName(request.FileName) ?? ".",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in request.Arguments) psi.ArgumentList.Add(a);

        // yt-dlp บน Windows พิมพ์ไทย/ยูนิโคดพังถ้าไม่บอก encoding ให้ชัด
        psi.Environment["PYTHONIOENCODING"] = "utf-8";

        using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };

        var stdout = new StringBuilder();
        var stderr = new StringBuilder();
        var outDone = new TaskCompletionSource();
        var errDone = new TaskCompletionSource();

        proc.OutputDataReceived += (_, e) =>
        {
            if (e.Data is null) { outDone.TrySetResult(); return; }
            stdout.AppendLine(e.Data);
            onStdOutLine?.Invoke(e.Data);
        };
        proc.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is null) { errDone.TrySetResult(); return; }
            stderr.AppendLine(e.Data);
        };

        if (!proc.Start())
            return new ProcessResult(-1, "", $"เริ่มโปรเซสไม่ได้: {request.FileName}");

        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        try
        {
            await proc.WaitForExitAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            TryKill(proc);
            throw;
        }

        // รอให้สายอ่าน stdout/stderr ปิดจริง ไม่งั้นบรรทัดท้ายๆ หายได้
        await Task.WhenAny(Task.WhenAll(outDone.Task, errDone.Task), Task.Delay(2000, CancellationToken.None))
                  .ConfigureAwait(false);

        return new ProcessResult(proc.ExitCode, stdout.ToString(), stderr.ToString());
    }

    private static void TryKill(Process p)
    {
        try { if (!p.HasExited) p.Kill(entireProcessTree: true); }
        catch { /* ตายไปแล้วก็ดีอยู่ */ }
    }
}
