namespace NewKewi.Core.Processes;

public sealed record ProcessRequest(
    string FileName,
    IReadOnlyList<string> Arguments,
    string? WorkingDirectory = null);

public sealed record ProcessResult(int ExitCode, string StdOut, string StdErr)
{
    public bool Ok => ExitCode == 0;
}

/// <summary>
/// ตัวเรียกโปรแกรมภายนอก
/// แยกเป็น interface เพื่อให้เทสสวมตัวปลอมเข้ามาได้ — แต่ตัวปลอมนั้น
/// **ต้องตอบได้ทั้งสำเร็จและล้มเหลว** ไม่งั้นขั้น fallback จะไม่เคยถูกเดินเลย
/// (บทเรียนตอนทำ v1.6.4 ของแอปเก่า)
/// </summary>
public interface IProcessRunner
{
    Task<ProcessResult> RunAsync(
        ProcessRequest request,
        Action<string>? onStdOutLine,
        CancellationToken ct);
}
