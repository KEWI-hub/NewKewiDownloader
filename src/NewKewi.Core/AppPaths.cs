namespace NewKewi.Core;

/// <summary>
/// ที่อยู่ของทุกอย่างที่แอปใช้ · แบบพกพา — ทุกอย่างอยู่ใต้โฟลเดอร์แอป ไม่เขียนลง AppData
/// เทสสร้างตัวนี้ชี้ไปโฟลเดอร์ชั่วคราวได้ จึงไม่มีทางไปแตะข้อมูลจริงของผู้ใช้
/// </summary>
public sealed class AppPaths
{
    public AppPaths(string root)
    {
        Root = Path.GetFullPath(root);
    }

    /// <summary>ที่อยู่จริงตอนรัน — ขึ้นจาก bin\Debug\netX ไปหารากโปรเจกต์ให้ตอนพัฒนา</summary>
    public static AppPaths ForRunningApp()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var d = dir; d is not null; d = d.Parent)
        {
            if (File.Exists(Path.Combine(d.FullName, "NewKewi.slnx")))
                return new AppPaths(d.FullName);
        }
        return new AppPaths(AppContext.BaseDirectory);
    }

    public string Root { get; }

    public string Bin => Path.Combine(Root, "bin");
    public string Data => Path.Combine(Root, "data");
    public string Logs => Path.Combine(Root, "logs");
    public string Temp => Path.Combine(Root, "_tmp");
    public string LuaModules => Path.Combine(Root, "modules", "lua");
    public string LocalModules => Path.Combine(Root, "modules", "local");

    /// <summary>Chromium พกพา — โหลดมาเองตอนต้องใช้ ไม่พึ่งเบราว์เซอร์ที่ติดตั้งในเครื่อง</summary>
    public string Chromium => Path.Combine(Root, "_chromium");

    public string ChromeExe => Path.Combine(Chromium, "chrome-win64", "chrome.exe");

    /// <summary>
    /// รากของ profile เบราว์เซอร์แอป · แยกจากของผู้ใช้ 100% ลบทิ้งได้ทั้งก้อน
    ///
    /// โหมดเงียบกับโหมดมีหน้าต่างต้องใช้คนละ profile (Chromium ล็อกโฟลเดอร์ไว้ เปิดพร้อมกันไม่ได้)
    /// แต่ทั้งคู่ต้องอยู่**ใต้โฟลเดอร์เดียวกัน** ไม่ใช่วางเป็น <c>_profile-silent</c> ข้างๆ
    /// เพราะข้างในมี History / Cookies / Login Data ของเบราว์เซอร์แอป
    /// กฎ <c>.gitignore</c> บรรทัดเดียวต้องครอบได้หมด ไม่งั้นมีวันหลุดขึ้น repo
    /// </summary>
    public string BrowserProfile => Path.Combine(Root, "_profile");

    public string SilentProfile => Path.Combine(BrowserProfile, "silent");

    public string VisibleProfile => Path.Combine(BrowserProfile, "visible");

    public string YtDlp => Path.Combine(Bin, "yt-dlp.exe");
    public string FFmpeg => Path.Combine(Bin, "ffmpeg.exe");
    public string FFprobe => Path.Combine(Bin, "ffprobe.exe");
    public string Aria2c => Path.Combine(Bin, "aria2c.exe");

    public string SettingsFile => Path.Combine(Data, "settings.json");
    public string QueueFile => Path.Combine(Data, "queue.json");
    public string CookieJar => Path.Combine(Data, "cookies.txt");

    /// <summary>โฟลเดอร์ชั่วคราวของงานหนึ่ง — ใช้เก็บ playlist ที่เขียนเองและซากไฟล์ระหว่างโหลด</summary>
    public string TempFor(string itemId) => Path.Combine(Temp, itemId);

    public void EnsureCreated()
    {
        foreach (var p in new[] { Data, Logs, Temp, LuaModules, LocalModules })
            Directory.CreateDirectory(p);
    }

    /// <summary>มีเครื่องมือครบไหม — คืนรายชื่อที่ขาด</summary>
    public IReadOnlyList<string> MissingTools()
    {
        var missing = new List<string>();
        foreach (var (path, name) in new[]
                 {
                     (YtDlp, "yt-dlp.exe"), (FFmpeg, "ffmpeg.exe"),
                     (FFprobe, "ffprobe.exe"), (Aria2c, "aria2c.exe"),
                 })
        {
            if (!File.Exists(path)) missing.Add(name);
        }
        return missing;
    }
}
