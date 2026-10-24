using NewKewi.Sites.Lua;

namespace NewKewi.Sites;

public sealed record SiteModuleInfo(
    string Name,
    string FilePath,
    IReadOnlyList<string> Domains,
    int Priority,
    int Version,
    bool Adult,
    bool IsLocal)
{
    /// <summary>module ของผู้ใช้เองชนะเสมอ แล้วค่อยดู Priority ที่ module ประกาศไว้</summary>
    public int SortKey => (IsLocal ? -1_000_000 : 0) + Priority;
}

/// <summary>
/// ตารางว่าเว็บไหนใช้ module ไหน
///
/// ตอนเปิดแอปรันแค่ <c>Register()</c> ของทุกไฟล์ (เร็ว ไม่ยิงเน็ต)
/// ส่วน <c>GetInfo</c>/<c>GetStreams</c> รันตอนจะโหลดจริงเท่านั้น
/// </summary>
public sealed class SiteRegistry(AppPathsView paths)
{
    private readonly List<SiteModuleInfo> _modules = [];

    public IReadOnlyList<SiteModuleInfo> Modules => _modules;

    /// <summary>โฟลเดอร์ที่ <c>require</c> ของ Lua หาไฟล์ฐานร่วมได้ — ออกนอกนี้ไม่ได้</summary>
    public IReadOnlyList<string> ModuleSearchPaths => [paths.LocalModules, paths.LuaModules];

    /// <summary>ไฟล์ที่โหลดไม่ผ่าน พร้อมเหตุผล — โชว์ในหน้า "เว็บที่รองรับ" ได้</summary>
    public List<(string File, string Error)> LoadErrors { get; } = [];

    public void Load()
    {
        _modules.Clear();
        LoadErrors.Clear();

        // โฟลเดอร์ซิงก์จาก repo ก่อน แล้วทับด้วยของผู้ใช้เอง
        Scan(paths.LuaModules, isLocal: false);
        Scan(paths.LocalModules, isLocal: true);

        _modules.Sort((a, b) => a.SortKey.CompareTo(b.SortKey));
    }

    private void Scan(string dir, bool isLocal)
    {
        if (!Directory.Exists(dir)) return;

        foreach (var file in Directory.EnumerateFiles(dir, "*.lua", SearchOption.TopDirectoryOnly).Order())
        {
            // ไฟล์ขึ้นต้นด้วย _ คือไฟล์ตัวอย่าง/ฐานร่วม ไม่ใช่ module ของเว็บ
            if (Path.GetFileName(file).StartsWith('_')) continue;

            try
            {
                var box = new LuaSandbox(NullWebClient.Instance, [dir, paths.LuaModules], CancellationToken.None);
                box.LoadFile(file);

                if (!box.HasFunction("Register"))
                {
                    LoadErrors.Add((file, "ไม่มีฟังก์ชัน Register()"));
                    continue;
                }
                box.Call("Register");

                if (box.Domains.Count == 0)
                {
                    LoadErrors.Add((file, "Register() ไม่ได้ประกาศ Domains ไว้เลย"));
                    continue;
                }

                _modules.Add(new SiteModuleInfo(
                    Name: Str(box.Module.Get("Name"), Path.GetFileNameWithoutExtension(file)),
                    FilePath: file,
                    Domains: box.Domains.ToList(),
                    Priority: Int(box.Module.Get("Priority"), 0),
                    Version: Int(box.Module.Get("Version"), 1),
                    Adult: box.Module.Get("Adult").CastToBool(),
                    IsLocal: isLocal));
            }
            catch (Exception ex)
            {
                // module เดียวพังต้องไม่ทำให้ทั้งแอปเปิดไม่ขึ้น
                LoadErrors.Add((file, ex.Message));
            }
        }
    }

    /// <summary>module ที่รับโดเมนของ url นี้ เรียงตัวที่ควรลองก่อนไว้หน้า</summary>
    public IReadOnlyList<SiteModuleInfo> FindCandidates(string url)
    {
        var host = HostOf(url);
        if (host is null) return [];

        return _modules
            .Where(m => m.Domains.Any(d => Matches(host, d)))
            .OrderBy(m => m.SortKey)
            // โดเมนที่เจาะจงกว่าชนะ: player.example.com ชนะ example.com
            .ThenByDescending(m => m.Domains.Where(d => Matches(host, d)).Max(d => d.Length))
            .ToList();
    }

    public SiteModuleInfo? Find(string url) => FindCandidates(url).FirstOrDefault();

    public static string? HostOf(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u)) return null;
        var host = u.Host.ToLowerInvariant();
        return host.StartsWith("www.", StringComparison.Ordinal) ? host[4..] : host;
    }

    private static bool Matches(string host, string domain)
        => host == domain || host.EndsWith("." + domain, StringComparison.Ordinal);

    private static string Str(MoonSharp.Interpreter.DynValue v, string fallback)
        => v.Type == MoonSharp.Interpreter.DataType.String && v.String.Length > 0 ? v.String : fallback;

    private static int Int(MoonSharp.Interpreter.DynValue v, int fallback)
        => v.Type == MoonSharp.Interpreter.DataType.Number ? (int)v.Number : fallback;
}

/// <summary>ตอนอ่าน Register() ยังไม่ควรมี module ไหนยิงเน็ตได้</summary>
internal sealed class NullWebClient : IWebClient
{
    public static readonly NullWebClient Instance = new();

    public WebResponse Get(string url, IReadOnlyDictionary<string, string> headers, CancellationToken ct)
        => throw new InvalidOperationException("Register() ห้ามยิงเน็ต");

    public WebResponse Post(string url, IReadOnlyDictionary<string, string> headers,
        IReadOnlyDictionary<string, string> form, CancellationToken ct)
        => throw new InvalidOperationException("Register() ห้ามยิงเน็ต");
}

/// <summary>ที่อยู่โฟลเดอร์ module ที่ชั้นนี้ต้องใช้ · แยกไว้เพื่อให้เทสชี้ไปโฟลเดอร์ชั่วคราวได้</summary>
public sealed record AppPathsView(string LuaModules, string LocalModules);
