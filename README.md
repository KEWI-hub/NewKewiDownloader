# New Kewi Video Downloader

A Windows video downloader with an IDM-style interface, per-site Lua config modules,
parallel multi-channel downloads, and a browser extension that puts a download panel
over any video player.

**Status: phase 5 of 8 — usable.** Paste links and they download in parallel as mp4, per-site Lua
configs resolve the real stream, the portable Chromium gets past bot walls with one click from you,
and the interface has the queue, a per-job detail window, settings and a tray icon. The browser
extension that puts a download button over a video player is still to come.
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

Tests come in two sets. The normal set never touches the network:

```bash
dotnet test
```

The live set really downloads files and really launches the portable Chromium, so run it
deliberately rather than on every change:

```bash
dotnet test --settings tests/NewKewi.Tests/live.runsettings
```

## Layout

## Repositories

| Repo | What |
|---|---|
| [NewKewiDownloader](https://github.com/KEWI-hub/NewKewiDownloader) | this one — code and releases |
| [NewKewi-configs](https://github.com/KEWI-hub/NewKewi-configs) | per-site Lua modules, synced by the app on startup |
| NewKewi-logs (private) | diagnostic reports for sites that still need a config |

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

เทสมี 2 ชุด · ชุดปกติไม่ยิงเน็ตเลย

```bash
dotnet test
```

ชุดของจริงโหลดไฟล์จริงและเปิด Chromium จริง ให้สั่งเองเมื่อต้องการ ไม่ใช่รันทุกครั้งที่แก้โค้ด

```bash
dotnet test --settings tests/NewKewi.Tests/live.runsettings
```

---

## Changelog

### v0.7.0 — 2026-10-25
- **ส่ง log ของเว็บที่โหลดไม่ได้ขึ้น GitHub** — `DiagnosticReport` เก็บแค่โดเมน, path ของหน้า,
  sha256 ของ url และร่องรอยที่ตัวแกะลิงก์เดินมา · **ถามก่อนส่งทุกครั้งและโชว์ให้เห็นว่าจะส่งอะไร**
  · `DiagnosticBuilder.Scrub` ตัด query string และค่าที่หน้าตาเป็นความลับออกทุกบรรทัด
  · ไม่ส่ง url เต็ม ไม่ส่ง cookie ไม่ส่งชื่อไฟล์ปลายทาง
- **token จาก Git Credential Manager เท่านั้น** (`git credential fill`) ไม่ hardcode ไม่เขียนลงไฟล์
- **ซิงก์ config จาก repo** — เทียบ sha ของ branch ก่อน เหมือนเดิมก็ไม่โหลดซ้ำ
  · แตกเฉพาะไฟล์ `.lua` ใต้ `modules/lua/` และ **ตรวจ path ทุกตัวเอง**
  ไฟล์ tar ที่ปั้นมาให้มี `../` เขียนออกนอกโฟลเดอร์ไม่ได้ (มีเทสยืนยัน)
  · `modules/local/` ไม่ถูกแตะ ของที่คุณเขียนเองชนะเสมอ
  · ซิงก์เสร็จแล้วโหลด config ใหม่ทันที ไม่ต้องเปิดแอปรอบหน้า
- **กฎตั้งชื่อไฟล์ต่อเว็บ** (`modules/naming.json`) — `{title}` `{host}` `{quality}` `{date}` `{id}`
  · `titleFrom` เป็น XPath ชุดเดียวกับทั้งแอป · `folder` แยกโฟลเดอร์ย่อยได้
  · `replace` ทำกับ `{title}` ก่อนประกอบ ไม่ใช่หลัง
- เทส 139 ข้อผ่านหมด

### v0.6.0 — 2026-10-25
- **ส่วนขยายเบราว์เซอร์** (`extension/`) — เอาเมาส์วางบนตัวเล่นวิดีโอแล้วมีแผงโผล่มุมบนขวา
  พร้อม dropdown ความชัด กดแล้วส่งเข้าคิวทันที แบบที่ IDM ทำ
  · แผงอยู่ใน **shadow root** CSS ของเว็บเจ้าบ้านจึงทับไม่ได้
  · เมนูบน toolbar แสดงวิดีโอทั้งหมดที่ดักได้ในแท็บนั้น
  · ดักอะไรไม่เจอก็ยังมี "ส่งทั้งหน้าให้แอปแกะเอง"
- **`NewKewi.Bridge`** — เซิร์ฟเวอร์ HTTP จิ๋วบน `127.0.0.1:47800` เขียนเองบน `TcpListener`
  (ไม่ใช้ `HttpListener` ที่ต้องจอง URL ACL จนเด้งขอสิทธิ์ผู้ดูแลระบบ)
- **ความปลอดภัย 4 ชั้น** — loopback เท่านั้น · token สุ่มเทียบแบบเวลาคงที่ ·
  ต้องมีหัว `X-NewKewi: 1` ที่ฟอร์ม HTML ส่งไม่ได้ (กัน CSRF) ·
  **ขอ token ครั้งแรกผู้ใช้ต้องกดอนุญาตในแอปเอง** และไม่มีคนรับเรื่อง = ปฏิเสธเสมอ
  · ขอจับคู่ถี่เกิน 10 วินาทีต่อครั้งถูกปัดทิ้ง
- **ไม่รับ cookie จากส่วนขยาย** — ฝั่งแอปตัดหัว `Cookie` ทิ้งเสมอ
- Chromium พกพาของแอปโหลดส่วนขยายได้หลายตัวพร้อมกัน (ตัวของแอปเอง + ตัวกันโฆษณา)
- เทส 118 ข้อผ่านหมด (เพิ่ม Bridge 19 ข้อ ยิงเข้าทางซ็อกเก็ตจริงด้วยพอร์ตชั่วคราว)
  · เทส live เพิ่มข้อที่เปิด Chromium จริงแล้วยืนยันว่าแผงโผล่เหนือวิดีโอจริง

### v0.5.0 — 2026-10-25
- **ฝ่าด่านกันบอทได้จริง** — ชั้นที่ 3 เปิดหน้าต่างเบราว์เซอร์ค้างไว้ คอยดูจนหน้าเปลี่ยน
  แล้วเก็บ cookie ไปใช้ต่อ · แอปไม่ได้แก้โจทย์ให้ คนเป็นคนกดเอง
- **UA ตัวเดียวกันทุกชั้น** (`BrowserIdentity`) — Chromium, HttpClient และ yt-dlp ใช้ UA เดียวกัน
  เพราะ `cf_clearance` ผูกกับ UA ที่ใช้ตอนได้มันมา · ไม่ตรงกันคือเจอด่านซ้ำทั้งที่เพิ่งกดผ่าน
- `WebClient` โหลด `cookies.txt` ใหม่เองเมื่อไฟล์เปลี่ยน ไม่ต้องรีสตาร์ตหลังผ่านด่าน
- **ปุ่ม "ผ่านด่านเว็บ"** บน toolbar · เปิดเว็บให้กดผ่านล่วงหน้าได้โดยไม่ต้องรอให้งานล้มเหลวก่อน
- **เสียบส่วนขยายกันโฆษณาเข้า Chromium พกพา** (`AdBlockExtensionPath`)
  และตรวจว่ามันทำงานจริงบนหน้าเว็บ ไม่ใช่แค่ส่งธงไปแล้วเชื่อว่าโหลดขึ้น
- **หน้าต่างรายละเอียดงาน** (ดับเบิลคลิกที่แถว) — แถบรวม, แถบแบ่งชิ้นส่วนของ HLS,
  ความเร็ว, เวลาที่เหลือ, เวลาที่ใช้ไป, ลิงก์สตรีมจริง, config ที่ใช้
- **หน้าตั้งค่า** และ **หน้าเว็บที่รองรับ** (โชว์ไฟล์ config ที่โหลดไม่ขึ้นพร้อมเหตุผลด้วย)
- **ไอคอนถาดระบบ** · ย่อลงถาดได้ คิวจบแล้วเด้งบอก · ปิดแอปแล้วไอคอนหายไม่ค้าง
- ปุ่มล้าง cookie และ profile ของแอปในหน้าตั้งค่า
- ความคืบหน้าอ่าน `fragment_index` / `fragment_count` เพิ่ม — playlist ที่บอกขนาดรวมไม่ได้
  ก็ยังรู้เปอร์เซ็นต์จากจำนวนชิ้นส่วน

### v0.4.0 — 2026-10-25
- **ชั้นดึงหน้าเว็บ 3 ชั้น** — `PageFetcher` ไล่จาก HttpClient → Chromium เงียบ → Chromium มีหน้าต่าง
  ขยับขึ้นชั้นถัดไปเฉพาะตอนเจอด่านกันบอทเท่านั้น หน้าปกติจบที่ชั้นแรกไม่เปลืองเวลาเปิดเบราว์เซอร์
- **Chromium พกพา** — `ChromiumInstaller` โหลด Chrome for Testing มาไว้ `_chromium/` ตอนต้องใช้ครั้งแรก
  · `ChromiumBrowser` คุยผ่าน CDP ที่เขียนเอง (`CdpSession`) · profile อยู่ที่ `_profile/` ของแอป
  **ไม่แตะเบราว์เซอร์หรือ cookie ของผู้ใช้เลย**
- **cookie ของแอปเอง** — cookie ที่ได้จากเบราว์เซอร์ของแอปถูกเขียนเป็น `data/cookies.txt`
  แบบ Netscape ให้ yt-dlp ใช้ต่อ ลบทิ้งได้ทั้งก้อน
- **`GenericResolver`** สำหรับเว็บที่ยังไม่มี module — สแกนหน้า → ตาม iframe ไม่เกิน 3 ชั้น
  (จำ player ที่ตายแล้ว ไม่ลองซ้ำในรอบเดียว) → เปิดเบราว์เซอร์ดัก request → ยอมแพ้พร้อม**บันทึกทางที่เดินมา**
- **`MasterPlaylist`** แตก master m3u8 เป็นรายการความชัด ทำให้เลือก 720p ได้แทนที่จะโดนยัดตัวใหญ่สุด
- **ทางถอยกลับใน engine** — yt-dlp ไปต่อไม่ได้ด้วยเหตุที่ถอยแล้วมีหวัง (ไม่รู้จักเว็บ / กันบอท / ลิงก์หมดอายุ)
  → อ่านหน้าเว็บเองแล้วยิงใหม่ **ครั้งเดียว** · ยังไม่ใช่ retry และเทสยืนยันว่าเรียก yt-dlp 2 ครั้งพอดี
- **`browser.GetHtml` / `browser.Capture` ใช้ได้แล้วใน Lua module**
- แอปต่อ resolver จริงเข้ากับคิวแล้ว
- เทส 99 ข้อผ่านหมด · เทส live เพิ่มเป็น 5 ข้อ (ติดตั้ง Chromium, เปิดหน้าเว็บจริง, generic resolver)

### v0.3.0 — 2026-10-25
- **Config ต่อเว็บเป็น Lua ใช้งานได้แล้ว** — `SiteRegistry` อ่าน `Register()` ของทุกไฟล์ตอนเปิดแอป
  แล้วแมปโดเมน → module · โดเมนที่เจาะจงกว่าชนะ · ของใน`modules/local/` ชนะของที่ซิงก์มา
- **Sandbox ปิดประตูแน่น** — ไม่มี `io` / `os.execute` / `debug` · `require` ออกนอกโฟลเดอร์ module ไม่ได้
  · `Register()` ยิงเน็ตไม่ได้ · มีเทสยืนยันทุกข้อ
- **API ให้ module ใช้** — `http` (Get/Post/GetJson/Headers/PostData), `dom` + `Dom.New` (XPath
  รองรับ `/@attr` ท้ายนิพจน์), `json`, เมธอดสตริง (`:regex` `:contains` `:before` `:afterlast` …),
  `UnpackJs`, `Base64`, `HexUnescape`, `UrlJoin`, `log`
- **header 2 ขั้นรองรับตั้งแต่ชั้น config** — `playlistHeaders` / `segmentHeaders` แยกกันได้
  ตามบทเรียน FirePlayer · ใส่ชุดเดียวแปลว่าใช้ชุดนั้นทั้งสองขั้น
- **`DownloadEngine` เรียก resolver ให้เอง** — ไม่มี module รับโดเมนนี้ก็ถอยไปทางทั่วไปเงียบๆ
  · ลิงก์ที่ `expires = true` ถูกขอใหม่ทุกครั้งที่เริ่มโหลด ไม่เก็บไว้ใช้ซ้ำ
- **module ตัวอย่าง 3 ไฟล์** — `_Example.lua` (เทมเพลตพร้อมคู่มือ), `StreamOrigin.lua`, `TaiAv.lua`
- `modules/local/` สำหรับ module ที่ผู้ใช้เขียนเอง ไม่ถูกทับตอนซิงก์
- เอกสารเพิ่มหัวข้อ §11 กฎตั้งชื่อไฟล์ต่อเว็บ สำหรับเว็บที่ไม่มี module (ทำจริงเฟส 7)
- เทส 73 ข้อผ่านหมด

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
