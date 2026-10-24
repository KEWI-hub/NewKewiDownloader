using NewKewi.Core.Models;

namespace NewKewi.Sites;

/// <summary>
/// ตัวแกะลิงก์ที่แอปใช้จริง · รวม 2 ทางเข้าด้วยกัน
///
/// <list type="bullet">
/// <item><c>Resolve</c> — มี Lua module ของเว็บนี้ไหม (เรียกก่อนยิง yt-dlp)</item>
/// <item><c>ResolveFallback</c> — ไม่มี แล้ว yt-dlp ก็ไปต่อไม่ได้ ค่อยอ่านหน้าเว็บเอง</item>
/// </list>
/// </summary>
public sealed class SiteResolver(LuaResolver lua, GenericResolver generic) : IStreamResolver
{
    public ResolveOutcome Resolve(string url, CancellationToken ct)
    {
        var r = lua.Resolve(url, ct);
        return new ResolveOutcome(r.Handled, r.ModuleName, r.Title, r.Streams, r.Error);
    }

    public ResolveOutcome ResolveFallback(string url, CancellationToken ct)
        => generic.Resolve(url, ct);
}
