namespace NewKewi.Core.Settings;

public sealed class AppSettings
{
    /// <summary>โหลดกี่ลิงก์พร้อมกัน</summary>
    public int MaxParallelDownloads { get; set; } = 3;

    /// <summary>หนึ่งลิงก์แตกเป็นกี่ช่อง (fragment ของ HLS / connection ของ aria2c)</summary>
    public int ChannelsPerDownload { get; set; } = 8;

    public string DownloadDirectory { get; set; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Videos", "NewKewi");

    /// <summary>ไฟล์ที่ได้ต้องเป็น mp4 เสมอ — ปิดได้แต่ไม่แนะนำ</summary>
    public bool AlwaysMp4 { get; set; } = true;

    /// <summary>ถ้า remux แบบ copy ไม่ผ่าน ยอมให้ encode ใหม่ไหม (ช้าและเสียคุณภาพ)</summary>
    public bool AllowReencodeForMp4 { get; set; } = true;

    /// <summary>มีไฟล์ชื่อเดียวกันอยู่แล้วให้ข้าม</summary>
    public bool SkipExisting { get; set; } = true;

    /// <summary>วินาที · 0 = ไม่จำกัด</summary>
    public int SocketTimeoutSeconds { get; set; } = 30;

    /// <summary>
    /// ลองชิ้นส่วน (fragment) ซ้ำกี่ครั้ง **ภายในความพยายามเดียวกัน**
    /// ไม่ใช่ retry ระดับงาน — งานที่ fail จะไม่ถูกเริ่มใหม่อัตโนมัติเลยไม่ว่าค่านี้เป็นเท่าไร
    /// ตั้ง 0 ได้ถ้าอยากให้ชิ้นส่วนพลาดครั้งเดียวแล้วล้มทั้งงาน
    /// </summary>
    public int FragmentRetries { get; set; } = 3;

    /// <summary>ส่ง diagnostic log ขึ้น GitHub อัตโนมัติเมื่อเว็บไม่มี config (ค่าเริ่มคือถามก่อนทุกครั้ง)</summary>
    public bool AutoUploadDiagnostics { get; set; } = false;

    public string Language { get; set; } = "th";

    /// <summary>
    /// โฟลเดอร์ส่วนขยายกันโฆษณาที่จะเสียบเข้า Chromium พกพา · ว่าง = ไม่โหลด
    /// ทำให้หน้าเว็บที่เต็มไปด้วย popup แกะลิงก์ได้สะอาดกว่า และตอนกดผ่านด่านกันบอทจะไม่มีโฆษณาเด้งทับ
    /// </summary>
    public string AdBlockExtensionPath { get; set; } = "";

    /// <summary>
    /// ยอมให้เปิดหน้าต่างเบราว์เซอร์ให้ผู้ใช้กดผ่านด่านกันบอทเองไหม
    /// ปิดไว้ถ้าปล่อยแอปโหลดทิ้งไว้โดยไม่มีคนเฝ้า จะได้ไม่มีหน้าต่างค้างรอ
    /// </summary>
    public bool AllowInteractiveBotWall { get; set; } = true;

    /// <summary>รอให้ผู้ใช้กดผ่านด่านกันบอทนานสุดกี่วินาที</summary>
    public int BotWallWaitSeconds { get; set; } = 180;

    /// <summary>ปรับค่าที่ไม่สมเหตุสมผลให้เข้าช่วง — กันคนแก้ไฟล์ settings เองแล้วแอปพัง</summary>
    public AppSettings Normalized()
    {
        MaxParallelDownloads = Math.Clamp(MaxParallelDownloads, 1, 16);
        ChannelsPerDownload = Math.Clamp(ChannelsPerDownload, 1, 32);
        SocketTimeoutSeconds = Math.Clamp(SocketTimeoutSeconds, 0, 600);
        BotWallWaitSeconds = Math.Clamp(BotWallWaitSeconds, 15, 900);
        FragmentRetries = Math.Clamp(FragmentRetries, 0, 20);
        if (string.IsNullOrWhiteSpace(DownloadDirectory))
            DownloadDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Videos", "NewKewi");
        return this;
    }
}

public sealed class SettingsStore(AppPaths paths)
{
    public AppSettings Load() => Json.Read(paths.SettingsFile, new AppSettings()).Normalized();

    public void Save(AppSettings s) => Json.Write(paths.SettingsFile, s.Normalized());
}
