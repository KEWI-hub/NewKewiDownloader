using System.Diagnostics;
using System.Text;

namespace NewKewi.Core.GitHub;

/// <summary>
/// ขอ token ของ GitHub จาก Git Credential Manager ของเครื่อง
///
/// **ห้าม hardcode token ลงโค้ดเด็ดขาด และห้ามเขียนลงไฟล์ของแอป**
/// ตัวนี้ถาม `git credential fill` ตอนที่ต้องใช้เท่านั้น แล้วถือไว้ในหน่วยความจำ
/// (เคยมีเหตุการณ์จริงที่ไฟล์ข้อมูลหลุดขึ้น repo สาธารณะมาแล้ว — token ยิ่งต้องระวังกว่านั้น)
/// </summary>
public static class GitCredentials
{
    /// <summary>คืน token ของ github.com · ไม่มีก็คืน null</summary>
    public static string? TryGetGitHubToken(TimeSpan? timeout = null)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "git",
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
            };
            psi.ArgumentList.Add("credential");
            psi.ArgumentList.Add("fill");

            using var proc = Process.Start(psi);
            if (proc is null) return null;

            proc.StandardInput.NewLine = "\n";
            proc.StandardInput.WriteLine("protocol=https");
            proc.StandardInput.WriteLine("host=github.com");
            proc.StandardInput.WriteLine();
            proc.StandardInput.Flush();
            proc.StandardInput.Close();

            var output = proc.StandardOutput.ReadToEnd();
            if (!proc.WaitForExit((int)(timeout ?? TimeSpan.FromSeconds(20)).TotalMilliseconds))
            {
                TryKill(proc);
                return null;
            }

            foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                var trimmed = line.Trim();
                if (trimmed.StartsWith("password=", StringComparison.Ordinal))
                {
                    var token = trimmed["password=".Length..].Trim();
                    return token.Length > 0 ? token : null;
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // ไม่มี git ในเครื่อง หรือยังไม่เคยล็อกอิน — ไม่ใช่เรื่องที่ต้องทำให้แอปพัง
        }
        return null;
    }

    private static void TryKill(Process p)
    {
        try { if (!p.HasExited) p.Kill(entireProcessTree: true); }
        catch { /* ตายไปแล้วก็ดี */ }
    }
}
