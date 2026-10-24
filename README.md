# New Kewi Video Downloader

A Windows video downloader with an IDM-style interface, per-site Lua config modules,
parallel multi-channel downloads, and a browser extension that puts a download panel
over any video player.

**Status: phase 2 of 8 — the queue and the download engine work.** Paste links, they download in
parallel and come out as mp4. Per-site Lua configs and the browser extension are still to come.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Highlights

- **IDM-style UI** — big-icon toolbar, category sidebar, queue grid, per-job progress window
  with one bar per download channel
- **Per-site config in Lua** — a module per site, synced from a public repo, so new sites
  are added without shipping a new release
- **No retry** — a failed job stays failed with a readable reason and a button the user presses
- **Always mp4** — anything else is remuxed with ffmpeg (stream copy where possible).
  Never transcodes to H.265
- **Parallel** — several links at once, and several channels per link
  (`--concurrent-fragments` for HLS, aria2c for single files)
- **Own cookies only** — the app keeps its own jar and its own portable Chromium profile.
  It never reads the user's browser cookies
- **Unknown site?** — it tries the generic path first; if that fails it offers to upload a
  diagnostic bundle so a config can be written

## Build

Requires the .NET 10 SDK.

```bash
dotnet build
dotnet run --project src/NewKewi.App
```

## Layout

| Path | What |
|---|---|
| `src/NewKewi.App` | WPF interface |
| `src/NewKewi.Core` | queue, download engine, settings, remux, watchdog |
| `src/NewKewi.Sites` | site registry, Lua host, generic resolver |
| `src/NewKewi.Bridge` | local endpoint the browser extension talks to |
| `modules/lua` | per-site modules |
| `extension` | Chrome MV3 extension |
| `bin` | yt-dlp, ffmpeg, ffprobe, aria2c (downloaded, not in git) |

---

# New Kewi Video Downloader (ไทย)

โปรแกรมโหลดวิดีโอบน Windows หน้าตาแบบ IDM · มี config ต่อเว็บเป็นไฟล์ Lua ·
โหลดหลายลิงก์พร้อมกันและหลาย channel ต่อลิงก์ · มี extension แปะปุ่มโหลดเหนือ video player

**สถานะ: เฟส 1 จาก 8 — วางโครง** หน้าต่างเปิดได้แล้ว แต่ยังไม่ได้ต่อกับตัวโหลด
รายละเอียดการออกแบบทั้งหมดอยู่ใน [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## ของที่ตั้งใจให้มี

- **หน้าตาแบบ IDM** — toolbar ไอคอนใหญ่, หมวดฝั่งซ้าย, ตารางคิว,
  ดับเบิลคลิกแล้วเห็นแถบ progress ของแต่ละ channel
- **Config ต่อเว็บเป็น Lua** — ไฟล์ละเว็บ ซิงก์จาก repo สาธารณะ เพิ่มเว็บใหม่ได้โดยไม่ต้องออก release
- **ไม่มี retry** — fail แล้วค้างไว้พร้อมเหตุผล ให้ผู้ใช้กดลองใหม่เอง
- **ต้องเป็น mp4 เสมอ** — ถ้าไม่ใช่ ให้ ffmpeg remux (copy ถ้าทำได้) **ไม่แปลงเป็น H.265**
- **โหลดขนาน** — หลายลิงก์พร้อมกัน และหลาย channel ต่อลิงก์
- **ไม่แตะ cookie ของผู้ใช้** — แอปมี jar ของตัวเองกับ Chromium พกพา profile แยก
- **เว็บที่ยังไม่มี config** — ลองทางทั่วไปก่อน ถ้าไม่ได้จะขออนุญาตอัป log ไว้ให้เขียน config

## วิธี build

ต้องมี .NET 10 SDK

```bash
dotnet build
dotnet run --project src/NewKewi.App
```

---

## Changelog

### v0.2.0 — 2026-10-24
- **คิวใช้งานได้จริง** — `DownloadQueue` โหลดหลายลิงก์พร้อมกันตามค่า `MaxParallelDownloads`
  เซฟลง `queue.json` **พร้อมสถานะ** งานที่ fail ยังเป็น fail หลังปิดเปิดแอป
- **ตัวโหลด** — `DownloadEngine.RunAsync()` คือทางเดียวที่งานเดิน ตั้งแต่กวาดซากไฟล์
  จนถึงทำเป็น mp4 · playlist ใช้ `--concurrent-fragments` ส่วนไฟล์เดี่ยวใช้ aria2c แตกหลายช่อง
- **ไม่มี retry** — fail แล้วค้างพร้อมเหตุผลภาษาไทย กลับเข้าคิวได้ทางปุ่ม "ลองใหม่" ของผู้ใช้เท่านั้น
- **ต้องเป็น mp4 เสมอ** — `Remuxer` ลอง copy ก่อน ไม่ผ่านค่อยแปลงเฉพาะเสียง
  ทางสุดท้ายค่อยแปลงภาพเป็น h264 · **ไม่มีการแปลงเป็น H.265 ทุกกรณี**
- **`ErrorClassifier`** — ตารางเดียวแปลผลของ yt-dlp เป็นสาเหตุที่คนอ่านรู้เรื่อง
  แทนการกระจายเงื่อนไขเช็คข้อความอังกฤษไว้ทั่วโค้ด
- **ความคืบหน้าอ่านจากรูปแบบที่เราสั่งให้พิมพ์เอง** (`--progress-template`) ไม่ parse ข้อความอิสระ
- UI ต่อกับคิวแล้ว: เพิ่มลิงก์ / เริ่ม / หยุด / ลองใหม่ / ลบ / เปิดโฟลเดอร์ · กรองตามหมวด · แถบคืบหน้าในตาราง
- เทส 46 ข้อผ่านหมด + เทสยิงเน็ตจริงอีก 2 ข้อ (`Category=live`) โหลด mp4 ตรงและ HLS ได้จริง

### v0.1.0 — 2026-10-24
- วางโครง solution: `NewKewi.App` (WPF), `NewKewi.Core`, `NewKewi.Sites`, `NewKewi.Bridge`, `NewKewi.Tests`
- เขียน `docs/ARCHITECTURE.md` — ออกแบบครบทั้ง 11 หัวข้อ จากบทเรียนของ YtdlpGUI v1.4–v1.6.4
- ทำไอคอนแอป: นกขาววงกลม + วงแหวนกำลังโหลด + ป้ายลูกศรลง (`assets/app.ico`)
- หน้าต่างหลักแบบ IDM (toolbar, หมวด, ตารางคิว) เปิดได้ ยังไม่ต่อกับตัวโหลด
- `.gitignore` กันข้อมูลผู้ใช้ตั้งแต่คอมมิตแรก (`data/`, `logs/`, `cookies.txt`, `_chromium/`, …)
