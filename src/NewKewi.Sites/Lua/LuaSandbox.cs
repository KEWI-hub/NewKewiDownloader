using MoonSharp.Interpreter;
using MoonSharp.Interpreter.Loaders;
using MoonSharp.Interpreter.Serialization.Json;

namespace NewKewi.Sites.Lua;

/// <summary>
/// กล่อง Lua ที่ module ของแต่ละเว็บรันอยู่ข้างใน
///
/// **ปิดประตูไว้แน่น** เพราะ module มาจาก repo สาธารณะ: ไม่มี <c>io</c>, ไม่มี <c>os.execute</c>,
/// ไม่มี <c>debug</c> · ออกไปข้างนอกได้ทางเดียวคือผ่าน <c>http</c> ที่เราคุมเอง
/// และ <c>require</c> หาไฟล์ได้เฉพาะในโฟลเดอร์ module เท่านั้น
/// </summary>
public sealed class LuaSandbox
{
    private readonly IWebClient _web;
    private readonly CancellationToken _ct;

    public LuaSandbox(IWebClient web, IEnumerable<string> moduleDirectories, CancellationToken ct)
    {
        _web = web;
        _ct = ct;

        Script = new Script(CoreModules.Preset_SoftSandbox)
        {
            Options =
            {
                ScriptLoader = new FileSystemScriptLoader
                {
                    ModulePaths = moduleDirectories
                        .Select(d => Path.Combine(d, "?.lua"))
                        .ToArray(),
                },
            },
        };

        RequestHeaders = new Table(Script);
        PostData = new Table(Script);
        Module = new Table(Script);
        Info = new Table(Script);
        Streams = [];
        Log = [];

        InstallGlobals();
    }

    public Script Script { get; }
    public Table Module { get; }
    public Table Info { get; }
    public Table RequestHeaders { get; }
    public Table PostData { get; }

    /// <summary>สตรีมที่ module เรียก <c>streams.Add{...}</c> เข้ามา</summary>
    public List<Table> Streams { get; }

    /// <summary>ข้อความที่ module เขียนผ่าน <c>log.Info</c> — ใช้ไล่ปัญหาเวลาเว็บเปลี่ยน</summary>
    public List<string> Log { get; }

    /// <summary>รายชื่อโดเมนที่ <c>Register()</c> ประกาศไว้</summary>
    public List<string> Domains { get; } = [];

    // ---- ค่าที่ module มองเห็น ----

    public void SetUrl(string url) => Script.Globals["url"] = url;

    public void SetPage(string html)
    {
        Script.Globals["page"] = html ?? "";
        Script.Globals["dom"] = DomApi.Create(Script, html ?? "");
    }

    public void SetMatchedDomain(string host) => Module["Domain"] = host;

    // ---- รัน ----

    public void LoadFile(string path) => Script.DoString(File.ReadAllText(path), null, Path.GetFileName(path));

    public void LoadCode(string code, string name = "module") => Script.DoString(code, null, name);

    public bool HasFunction(string name) => Script.Globals.Get(name).Type == DataType.Function;

    public DynValue Call(string name)
    {
        var fn = Script.Globals.Get(name);
        return fn.Type != DataType.Function ? DynValue.Nil : Script.Call(fn);
    }

    // ---- ติดตั้ง API ----

    private void InstallGlobals()
    {
        var g = Script.Globals;

        // module
        Module["Name"] = "";
        Module["Version"] = 1;
        Module["Adult"] = false;
        Module["Priority"] = 0;
        Module["Domain"] = "";
        Module["Domains"] = DomainsTable();
        g["module"] = Module;

        // info
        Info["Title"] = "";
        Info["Duration"] = 0;
        Info["Thumbnail"] = "";
        g["info"] = Info;

        // streams
        var streams = new Table(Script);
        streams["Add"] = (Action<DynValue>)(v =>
        {
            if (v.Type == DataType.Table) Streams.Add(v.Table);
        });
        streams["Count"] = (Func<int>)(() => Streams.Count);
        g["streams"] = streams;

        g["http"] = HttpTable();
        g["Dom"] = DomApi.CreateFactory(Script);
        g["json"] = JsonTable();
        g["log"] = LogTable();
        g["browser"] = BrowserTable();

        InstallHelpers(g);
        InstallStringMethods();
    }

    /// <summary>รับได้ทั้ง <c>Domains:Add(x)</c> และ <c>Domains.Add(x)</c> เหมือน HDoujinDownloader</summary>
    private Table DomainsTable()
    {
        var t = new Table(Script);
        t["Add"] = (Action<DynValue, DynValue>)((a, b) =>
        {
            foreach (var v in new[] { a, b })
            {
                if (v is null || v.IsNil() || v.Type != DataType.String) continue;
                var d = v.String.Trim().ToLowerInvariant();
                if (d.Length > 0 && !Domains.Contains(d)) Domains.Add(d);
            }
        });
        return t;
    }

    private Table HttpTable()
    {
        var t = new Table(Script);
        t["Headers"] = RequestHeaders;
        t["PostData"] = PostData;

        t["Get"] = (Func<string, string>)(u => _web.Get(u, Headers(), _ct).Body);
        t["GetStatus"] = (Func<string, int>)(u => _web.Get(u, Headers(), _ct).Status);
        t["Post"] = (Func<string, string>)(u => _web.Post(u, Headers(), Form(), _ct).Body);

        t["GetJson"] = (Func<string, DynValue>)(u =>
        {
            var body = _web.Get(u, Headers(), _ct).Body;
            return string.IsNullOrWhiteSpace(body)
                ? DynValue.Nil
                : DynValue.NewTable(JsonTableConverter.JsonToTable(body, Script));
        });

        t["Reset"] = (Action)(() =>
        {
            foreach (var k in RequestHeaders.Keys.ToList()) RequestHeaders.Remove(k);
            foreach (var k in PostData.Keys.ToList()) PostData.Remove(k);
        });

        return t;
    }

    private Table JsonTable()
    {
        var t = new Table(Script);
        t["Decode"] = (Func<string, DynValue>)(s =>
            string.IsNullOrWhiteSpace(s) ? DynValue.Nil
                                         : DynValue.NewTable(JsonTableConverter.JsonToTable(s, Script)));
        t["Encode"] = (Func<DynValue, string>)(v =>
            v.Type == DataType.Table ? JsonTableConverter.TableToJson(v.Table) : "null");
        return t;
    }

    private Table LogTable()
    {
        var t = new Table(Script);
        t["Info"] = (Action<string>)(m => Log.Add("INFO  " + m));
        t["Warn"] = (Action<string>)(m => Log.Add("WARN  " + m));
        return t;
    }

    /// <summary>
    /// เบราว์เซอร์จริงยังไม่มีในเฟสนี้ (มาเฟส 4)
    /// โยน error ที่บอกตรงๆ ดีกว่าคืนสตริงว่างแล้วให้ module เดาผิดว่าหน้าเว็บไม่มีอะไร
    /// </summary>
    private Table BrowserTable()
    {
        var t = new Table(Script);
        t["GetHtml"] = (Func<string, string>)(_ =>
            throw new ScriptRuntimeException("browser.GetHtml ยังไม่พร้อมใช้ (มาในเฟส 4 พร้อม Chromium พกพา)"));
        return t;
    }

    private void InstallHelpers(Table g)
    {
        g["isempty"] = (Func<DynValue, bool>)(v =>
            v is null || v.IsNil() ||
            (v.Type == DataType.String && string.IsNullOrWhiteSpace(v.String)) ||
            (v.Type == DataType.Table && v.Table.Length == 0 && v.Table.Keys.Count() == 0));

        g["UnpackJs"] = (Func<string, string>)TextTools.UnpackJs;
        g["HexUnescape"] = (Func<string, string>)TextTools.HexUnescape;
        g["RegexReplace"] = (Func<string, string, string, string>)TextTools.Replace;
        g["UrlJoin"] = (Func<string, string, string>)UrlJoin;

        var b64 = new Table(Script);
        b64["Decode"] = (Func<string, string>)TextTools.Base64Decode;
        b64["Encode"] = (Func<string, string>)TextTools.Base64Encode;
        g["Base64"] = b64;
    }

    /// <summary>
    /// เติมเมธอดลงตาราง <c>string</c> เพื่อให้เรียกแบบ <c>url:regex(...)</c> ได้
    /// (Lua ส่งตัวสตริงเป็นอาร์กิวเมนต์แรกให้เอง)
    /// </summary>
    private void InstallStringMethods()
    {
        var s = Script.Globals.Get("string").Table;

        // ต้องลงทะเบียนเป็น callback ดิบที่อ่านอาร์กิวเมนต์เองตามตำแหน่ง
        // ถ้าใช้ delegate ธรรมดา (Func<string,string,string>) MoonSharp จะส่งมาให้แค่ตัวแรก
        // แล้วตัวที่สองกลายเป็น null เงียบๆ — `s:contains('b')` คืน false ทั้งที่ควรเป็น true
        Add(s, "regex", a => TextTools.Match(Arg(a, 0), Arg(a, 1), ArgInt(a, 2, 1)));
        Add(s, "contains", a => Arg(a, 0).Contains(Arg(a, 1), StringComparison.Ordinal));
        Add(s, "before", a => TextTools.Before(Arg(a, 0), Arg(a, 1)));
        Add(s, "after", a => TextTools.After(Arg(a, 0), Arg(a, 1)));
        Add(s, "beforelast", a => TextTools.BeforeLast(Arg(a, 0), Arg(a, 1)));
        Add(s, "afterlast", a => TextTools.AfterLast(Arg(a, 0), Arg(a, 1)));
        Add(s, "trim", a => Arg(a, 0).Trim());
        Add(s, "urljoin", a => UrlJoin(Arg(a, 0), Arg(a, 1)));
        Add(s, "startswith", a => Arg(a, 0).StartsWith(Arg(a, 1), StringComparison.Ordinal));
        Add(s, "endswith", a => Arg(a, 0).EndsWith(Arg(a, 1), StringComparison.Ordinal));

        Add(s, "regexall", a =>
        {
            var t = new Table(Script);
            var i = 1;
            foreach (var v in TextTools.MatchAll(Arg(a, 0), Arg(a, 1), ArgInt(a, 2, 1))) t[i++] = v;
            return t;
        });
    }

    /// <summary>ลงทะเบียนฟังก์ชันที่อ่านอาร์กิวเมนต์เอง — ขาดตัวไหนก็ได้ค่าว่างแทนที่จะพัง</summary>
    private static void Add(Table target, string name, Func<CallbackArguments, object?> body)
        => target[name] = DynValue.NewCallback((_, args) => DynValue.FromObject(target.OwnerScript, body(args)));

    private static string Arg(CallbackArguments a, int i)
    {
        var v = a.RawGet(i, false);
        return v is null || v.IsNil() ? "" : v.CastToString() ?? "";
    }

    private static int ArgInt(CallbackArguments a, int i, int fallback)
    {
        var v = a.RawGet(i, false);
        return v is null || v.IsNil() ? fallback : (int)(v.CastToNumber() ?? fallback);
    }

    /// <summary>
    /// ต่อ path กับ url ฐาน — taiav คืน m3u8 มาเป็น path ไม่ใช่ url เต็ม
    /// ถ้าไม่ต่อให้ จะกลายเป็นลิงก์ที่โหลดไม่ได้
    /// </summary>
    public static string UrlJoin(string baseUrl, string relative)
    {
        if (string.IsNullOrWhiteSpace(relative)) return "";
        if (Uri.TryCreate(relative, UriKind.Absolute, out var abs)) return abs.ToString();

        // ฐานไม่ใช่ url ก็คืน relative ไปเฉยๆ — module เขียนผิดต้องไม่ทำให้ทั้งงานล้ม
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var b)) return relative;
        return Uri.TryCreate(b, relative, out var joined) ? joined.ToString() : relative;
    }

    private Dictionary<string, string> Headers() => ToDictionary(RequestHeaders);
    private Dictionary<string, string> Form() => ToDictionary(PostData);

    private static Dictionary<string, string> ToDictionary(Table t)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in t.Pairs)
        {
            if (pair.Key.Type != DataType.String) continue;
            d[pair.Key.String] = pair.Value.CastToString() ?? "";
        }
        return d;
    }
}
