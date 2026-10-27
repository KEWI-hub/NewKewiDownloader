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
public sealed class SiteResolver(
    LuaResolver lua, GenericResolver generic, LocalPlaylistWriter? playlists = null) : IStreamResolver
{
    /// <summary>
    /// เตรียมสตรีมก่อนส่งให้ yt-dlp · ตอนนี้มีกรณีเดียวคือ header สองขั้นไม่เหมือนกัน
    /// ทำตรงนี้เพราะต้องทำ**ตอนจะโหลดจริง** ลิงก์ของเว็บพวกนี้มีอายุสั้น
    /// </summary>
    public MediaStream Prepare(MediaStream stream, string workDir, CancellationToken ct)
        => playlists is null ? stream : playlists.Prepare(stream, workDir, ct);

    public ResolveOutcome Resolve(string url, CancellationToken ct)
    {
        var r = lua.Resolve(url, ct);
        // ส่ง log ของ module ต่อไปเป็น Trail ด้วย ไม่งั้นร่องรอยที่ module อุตส่าห์เขียนไว้หายหมด
        return new ResolveOutcome(r.Handled, r.ModuleName, r.Title, r.Streams, r.Error, r.Log);
    }

    public ResolveOutcome ResolveFallback(string url, CancellationToken ct)
        => generic.Resolve(url, ct);
}
