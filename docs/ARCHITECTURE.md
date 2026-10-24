# New Kewi Video Downloader — สถาปัตยกรรม

เอกสารออกแบบก่อนลงมือเขียนโค้ด · เขียนจากบทเรียนของ YtdlpGUI v1.4–v1.6.4 (ดู `YtdlpGUI-handover.md`)
และแบบอย่างจาก Internet Download Manager (หน้าตา/การดักวิดีโอ) กับ HDoujin Downloader (ระบบ config ต่อเว็บ)

---

## 0. สรุปข้อกำหนดจากเจ้าของ

| # | ข้อกำหนด | ลงที่ส่วนไหน |
|---|---|---|
| 1 | หน้าตาแบบ IDM | §6 UI |
| 2 | Config ต่อเว็บแบบ HDoujinDownloader | §3 Lua modules |
| 3 | **ไม่มี retry เมื่อ fail** | §5 Engine |
| 4 | ไม่มี config → ลองโหลดก่อน ถ้าไม่ได้ให้อัป log ขึ้น GitHub | §4 Resolver + §8 Log |
| 5 | ไม่แปลงเป็น H.265 แต่ **ต้องได้ .mp4 เสมอ** | §5.4 Remux |
| 6 | Parallel หลายลิงก์ · ต่อลิงก์หลาย channel | §5.2 |
| 7 | ไม่ใช้ cookie ผู้ใช้ — แอปสร้างเอง ลบเอง | §7 |
| 8 | popup เหนือ video player แบบ IDM + เลือกความชัด | §9 Extension |

---

## 1. เทคโนโลยี

- **C# / .NET 10 / WPF** (x64, Windows) — MVVM, ไม่ใช้ framework ภายนอกหนักๆ
- **MoonSharp** — รัน Lua module ต่อเว็บ (ตัวเดียวกับที่ HDoujinDownloader ใช้)
- **HtmlAgilityPack** — XPath บน DOM ให้ Lua เรียก
- **เครื่องมือภายนอกใน `bin/`** — `yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`, `aria2c.exe`
- **Chromium พกพา** ใน `_chromium/` (Chrome for Testing) คุยผ่าน CDP — ไม่พึ่งเบราว์เซอร์ในเครื่อง
- เทส: **xUnit** ใน `tests/NewKewi.Tests`

### โครงไฟล์

```
NewKewiDownloader/
├── NewKewi.sln
├── src/
│   ├── NewKewi.App/          WPF — View + ViewModel + ไอคอน/ธีม
│   ├── NewKewi.Core/         คิว, engine, settings, remux, watchdog
│   ├── NewKewi.Sites/        SiteRegistry + Lua host + binding + generic resolver
│   └── NewKewi.Bridge/       HTTP endpoint รับลิงก์จาก extension
├── modules/lua/              module ต่อเว็บ (ซิงก์จาก repo configs)
├── extension/                Chrome MV3 extension
├── bin/                      yt-dlp / ffmpeg / ffprobe / aria2c
├── tests/NewKewi.Tests/
├── docs/ARCHITECTURE.md
└── assets/                   ไอคอน + ภาพต้นฉบับ
```

**ไฟล์ที่แอปเขียนเอง = ข้อมูลผู้ใช้ ห้ามขึ้น git** (ใส่ `.gitignore` ตั้งแต่คอมมิตแรก):
`data/`, `logs/`, `_chromium/`, `_tmp/`, `_profile/`, `settings.json`, `queue.json`, `cookies.txt`

---

## 2. repo บน GitHub

| repo | สถานะ | หน้าที่ |
|---|---|---|
| `KEWI-hub/NewKewiDownloader` | public | โค้ด + release |
| `KEWI-hub/NewKewi-configs` | public | `modules/lua/` ของจริง แอปซิงก์มาเองทุกครั้งที่เปิด |
| `KEWI-hub/NewKewi-logs` | **private** | log ของเว็บที่โหลดไม่ได้ ไว้ให้เอามาทำ config |

แยก config ออกจากโค้ด เพื่อให้เพิ่ม/แก้เว็บได้โดยไม่ต้องออก release ใหม่
(แบบเดียวกับ `repositories.json` ของ HDoujinDownloader)

token เอาจาก `git credential fill` เท่านั้น ห้าม hardcode

---

## 3. Config ต่อเว็บ — Lua module

ไฟล์ละเว็บใน `modules/lua/<ชื่อ>.lua` โหลดตอนเปิดแอป รันแค่ `Register()` เพื่อเก็บตาราง domain → module
(เรียก `GetInfo`/`GetStreams` เฉพาะตอนจะโหลดจริง)

```lua
function Register()
    module.Name    = 'StreamOrigin'
    module.Version = 3
    module.Adult   = true
    module.Priority = 0                  -- เลขน้อยชนะเมื่อ domain ชนกัน
    module.Domains:Add('pornavhd.com')
    module.Domains:Add('video.playerrecord.cfd')
end

-- ไม่บังคับ: คัดกรองละเอียดกว่า domain (เช่นรับเฉพาะ /movie/)
function Probe()
    return url:contains('/movie/')
end

-- ไม่บังคับ: ชื่อ/ความยาว/ภาพปก — ถ้าไม่เขียน แอปจะเดาจากหน้าเว็บเอง
function GetInfo()
    info.Title    = dom.SelectValue('//h1')
    info.Duration = 0
end

-- บังคับ: คืนรายการสตรีมที่เลือกได้
function GetStreams()
    local apiBase = page:regex('https://[%w%.%-]+%.cc', 0)   -- อ่านโดเมน API จากหน้า ห้าม hardcode
    local id      = url:regex('/e/(%w{12})', 1)
    local r = json.Decode(http.Get(apiBase .. '/app/v1/play/' .. id .. '?embed=1'))

    streams.Add{
        url    = r.hls,
        kind   = 'hls',
        height = 1080,
        label  = '1080p',
        expires = true,              -- ลิงก์หมดอายุ → ห้าม cache ต้องขอใหม่ทุกครั้งที่เริ่มโหลด
        referer = 'https://' .. module.Domain .. '/',
    }
end
```

### API ที่ Lua เรียกได้

| กลุ่ม | ของ |
|---|---|
| `http` | `Get(url)`, `Post(url)`, `Headers[k]=v`, `PostData[k]=v`, `GetJson(url)`, `Head(url)` |
| `dom` | `Dom.New(html)`, `SelectValue(xpath)`, `SelectValues(xpath)`, `Select(xpath)` |
| `json` | `Decode(s)`, `Encode(t)` |
| `browser` | `GetHtml(url)` เปิด Chromium พกพารัน JS · `Capture(url, pattern)` ดัก request ที่ตรง pattern ผ่าน CDP |
| สตริง | `:regex(pat, group)`, `:before/:after/:beforelast/:afterlast`, `:contains`, `isempty()` |
| อื่น | `UnpackJs(s)` แตก `eval(function(p,a,c,k,e`, `Base64`, `HexUnescape`, `log.Info/Warn` |
| ตัวแปรพร้อมใช้ | `url` (ลิงก์ที่ผู้ใช้ใส่), `page` (HTML หน้าแรกที่ดึงมาแล้ว), `module`, `info`, `streams` |

**sandbox:** MoonSharp แบบไม่เปิด `io`/`os`/`debug` — Lua แตะไฟล์ในเครื่องไม่ได้ ออกเน็ตได้ผ่าน `http`/`browser` เท่านั้น
(module มาจาก repo สาธารณะ จึงต้องปิดประตูไว้)

### header ต่างกันคนละขั้น — ออกแบบรองรับตั้งแต่ต้น

บทเรียน FirePlayer: playlist ต้องมี `Origin`+`Sec-Fetch-*` แต่ไฟล์ย่อย **ห้ามมี** ไม่งั้น HTTP 500
yt-dlp ส่ง header ชุดเดียวทั้งงาน จึงต้องแยกตั้งแต่ชั้น config:

```lua
streams.Add{
    url = masterUrl, kind = 'hls',
    playlistHeaders = { Origin = 'https://av-th.xyz', ['Sec-Fetch-Dest'] = 'empty' },
    segmentHeaders  = {},                          -- ว่าง = ห้ามส่งอะไรเลย
    referer = 'https://av-th.io/',
}
```

ถ้า 2 ชุดไม่เท่ากัน engine จะ **ดึง playlist เองด้วยชุดแรก** เขียนลง `_tmp/<id>/master.m3u8`
โดยเขียน URL ของไฟล์ย่อยเป็น URL เต็ม แล้วส่ง `file:///...` ให้ yt-dlp พร้อม `--enable-file-urls`
(ทางนี้พิสูจน์แล้วว่าใช้ได้ใน v1.6.2)

### การซิงก์

เปิดแอป → `GET https://api.github.com/repos/KEWI-hub/NewKewi-configs/commits/main` เทียบ sha ที่เก็บไว้
ต่างกัน → ดึง tarball มาแตกทับ `modules/lua/` · module ที่ผู้ใช้เขียนเองวางใน `modules/local/` (priority ชนะเสมอ ไม่ถูกทับ)

---

## 4. Resolver — ทางเดินของ 1 ลิงก์

**หลักการที่เปลี่ยนจากของเดิม:** เลิกอ่าน "ข้อความ error ของ yt-dlp" เป็นเงื่อนไข fallback
(มันเปลี่ยนทุกเวอร์ชัน yt-dlp) ใช้ **ตารางแมป** `ErrorClassifier` ที่เทสครอบไว้แทน

```
ใส่ลิงก์
  │
  ├─ มี Lua module รับ domain นี้ไหม?
  │     ใช่ → รัน GetInfo/GetStreams ใน sandbox
  │             ├─ ได้ streams → ผู้ใช้เลือกความชัด → เข้าคิว
  │             └─ Lua โยน error → Failed + เก็บ log (§8)
  │
  └─ ไม่มี → ทางสำรองอัตโนมัติ (Generic)
        1. yt-dlp -J (แค่ถามข้อมูล ยังไม่โหลด)           ← เว็บส่วนใหญ่จบตรงนี้
        2. ไม่ได้ → ดึงหน้าเว็บ 3 ชั้น (§4.1) แล้วสแกนหา .m3u8 / .mp4 / iframe player
        3. ตาม iframe ซ้อนได้ 3 ชั้น (จำ player ที่ตายแล้ว ไม่ลองซ้ำในรอบเดียว)
        4. ยังไม่ได้ → เปิด Chromium พกพา ดัก request ผ่าน CDP 25 วิ
        5. ยังไม่ได้ → **Failed + ขออนุญาตอัป diagnostic bundle ขึ้น NewKewi-logs** (§8)
```

### 4.1 ชั้นดึงหน้าเว็บ (ยกมาจากของเดิมทั้งดุ้น — ส่วนที่คุ้มที่สุด)

1. `HttpClient` ธรรมดา + UA ของ Chrome
2. Chromium พกพาแบบ headless รัน JS
3. Chromium แบบมีหน้าต่าง ให้คนกดยืนยันเองเมื่อเจอ Cloudflare — จับ cookie ที่ได้เก็บเข้า jar ของแอป

### 4.2 ไม่มี retry

ข้อกำหนดของเจ้าของ: **fail แล้วจบ** ไม่วนซ้ำ
- งานที่ fail ค้างในคิวสถานะ `Failed` พร้อม **เหตุผลที่อ่านรู้เรื่อง** + ปุ่ม "ลองใหม่" ที่ *ผู้ใช้* กดเอง
- `queue.json` **เก็บสถานะด้วย** ปิดแอปเปิดใหม่ของที่ fail ยังเป็น fail (ของเดิมกลับมาเป็น "รอโหลด" ทำให้ไล่ปัญหายาก)
- ซากไฟล์ `.part` ถูกลบทิ้งตอนเริ่มงาน กัน HTTP 416 ที่เคยทำให้วนไม่จบ

---

## 5. Download engine

### 5.1 คิว

`DownloadQueue` เก็บ `DownloadItem` แต่ละตัวมี: url, module ที่ใช้, stream ที่เลือก, ปลายทาง,
สถานะ (`Queued/Resolving/Downloading/Remuxing/Done/Failed/Paused`), %, ความเร็ว, เวลาเหลือ, เหตุผลที่ fail

### 5.2 Parallel

- **หลายลิงก์พร้อมกัน** — `MaxParallelDownloads` (ค่าเริ่ม 3) ด้วย `SemaphoreSlim`
- **ต่อ 1 ลิงก์หลาย channel** — `ChannelsPerDownload` (ค่าเริ่ม 8)

| ชนิด | ตัวโหลด | ธงที่ใช้ |
|---|---|---|
| HLS / DASH (playlist) | ตัวโหลดในตัว yt-dlp | `--concurrent-fragments N` |
| ไฟล์เดี่ยว (mp4/mkv ตรงๆ) | aria2c | `--downloader aria2c --downloader-args "aria2c:-x N -s N -k 1M"` |

**ห้ามเด็ดขาด** (เจ็บมาแล้ว):
- aria2c กับ playlist
- `--download-sections` กับสตรีมที่ไฟล์ย่อยไม่มีนามสกุล (ffmpeg ปฏิเสธ `not in allowed_segment_extensions`)

### 5.3 คุยกับ yt-dlp

เรียกด้วย `--newline --progress-template` แล้วอ่าน stdout เป็นบรรทัดๆ แปลงเป็น % / speed / ETA
ไม่ parse ข้อความภาษาอังกฤษอิสระ

### 5.4 ต้องเป็น mp4 เสมอ

หลังโหลดเสร็จ:
1. `ffprobe` ดูคอนเทนเนอร์กับ codec
2. เป็น mp4 อยู่แล้ว → จบ
3. ไม่ใช่ mp4 แต่ codec เข้า mp4 ได้ (h264/hevc/aac/mp3) → `ffmpeg -c copy -movflags +faststart` **remux ไม่ encode**
4. codec เข้า mp4 ไม่ได้ (vp9/av1/opus/vorbis) → copy ฝั่งที่ได้ แปลงเฉพาะฝั่งที่ไม่ได้
   (เสียง → aac · ภาพ vp9/av1 → h264 เป็นทางสุดท้าย)
5. **ไม่มีการแปลงเป็น H.265 ทุกกรณี** — ของเดิมที่เป็น hevc อยู่แล้วก็ปล่อยไว้ copy เฉยๆ
6. สำเร็จแล้วค่อยลบไฟล์ต้นทาง

### 5.5 ยามเฝ้าแอปค้าง

heartbeat จาก UI thread ทุก 500ms · thread เฝ้าดู ถ้าเงียบเกิน 15 วิ dump stack ของทุก thread ลง `logs/hang-*.txt`
(ของเดิมแอปหายไปเฉยๆ เพราะ Windows สั่ง `Application Hang` ซึ่ง crash handler ธรรมดาดักไม่ได้)

---

## 6. UI — เอาแบบ IDM

```
┌─────────────────────────────────────────────────────────────┐
│ [+ เพิ่มลิงก์] [▶ เริ่ม] [⏸ หยุด] [✖ ลบ] [⚙ ตั้งค่า] [🌐 เว็บ] │  toolbar ไอคอนใหญ่
├──────────┬──────────────────────────────────────────────────┤
│ หมวด     │ ชื่อไฟล์        ขนาด  สถานะ    %   ความเร็ว  เหลือ │
│ ทั้งหมด  │ ▸ clip-a.mp4   1.2GB  กำลังโหลด 42%  8.1MB/s  2:10 │  DataGrid
│ กำลังโหลด│ ▸ clip-b.mp4   740MB  รอคิว      —      —      —   │
│ เสร็จแล้ว│ ▸ clip-c.mp4   310MB  ล้มเหลว    —  ไม่มี config   │
│ ล้มเหลว  │                                                   │
└──────────┴──────────────────────────────────────────────────┘
```

- **ดับเบิลคลิก → หน้าต่าง progress ต่องาน** แบบ IDM: แถบรวม + **แถบย่อยของแต่ละ channel**
  พร้อม url, ปลายทาง, ขนาดที่โหลดแล้ว, ปุ่มหยุด/ไปต่อ
- ไอคอนเว็บ (favicon) หน้าแถว · กรองตามหมวดฝั่งซ้าย
- **tray icon** — ย่อลง tray ได้ ปิดแอปแล้วเซฟคิวเสมอ
- ธีมเข้ม/สว่างตามระบบ
- ภาษาไทยเป็นหลัก มีอังกฤษด้วย (ไฟล์ `i18n/*.json`)

### ไอคอนแอป

นกขาวหน้ากลมจากภาพที่เจ้าของให้มา + **วงแหวนโหลดสีฟ้าและลูกศรลง** รอบตัว สื่อว่า "กำลังโหลด"
สร้างเป็น `assets/app.ico` ครบทุกขนาด (16/32/48/64/128/256)

---

## 7. Cookie — ไม่แตะของผู้ใช้

- แอปมี jar ของตัวเองที่ `data/cookies.txt` (รูปแบบ Netscape ให้ yt-dlp กินได้)
- cookie มาจาก Chromium พกพาของแอปเท่านั้น (profile แยกใน `_profile/`)
- **ไม่มี `--cookies-from-browser` ในโค้ดเลย** — ห้ามเพิ่มกลับมา
- ปุ่ม "ล้าง cookie ทั้งหมด" ในตั้งค่า ลบทั้ง `cookies.txt` และ `_profile/`
- ตอนถอนการติดตั้ง/ล้างข้อมูล ลบทิ้งทั้งหมด

---

## 8. เว็บที่ไม่มี config → อัป log

เมื่อ Generic resolver ไปไม่รอด แอปเก็บ **diagnostic bundle**:

```json
{
  "schema": 1,
  "app": "1.0.0",
  "when": "2026-10-24T13:20:00Z",
  "host": "example.com",
  "urlHash": "sha256 ของ url เต็ม",
  "urlPath": "/movie/<id>",           // เก็บ path ไม่เก็บ query ที่อาจมี token
  "steps": [
    {"stage": "ytdlp-probe", "exit": 1, "stderr": "…"},
    {"stage": "fetch-simple", "status": 403, "bytes": 1420},
    {"stage": "fetch-chrome", "status": 200, "bytes": 88210},
    {"stage": "scan", "found": []},
    {"stage": "cdp-capture", "requests": ["…/x.js", "…/api/play"]}
  ],
  "htmlSample": "2 KB แรกของหน้าหลังรัน JS",
  "capturedRequests": ["url + content-type เท่านั้น"]
}
```

- **ถามผู้ใช้ก่อนส่งทุกครั้ง** (ติ๊ก "ส่งอัตโนมัติต่อไป" ได้) — bundle มีชื่อเว็บที่ผู้ใช้เข้า จึงต้องขอก่อน
- ส่งขึ้น `KEWI-hub/NewKewi-logs` (private) path `needs-config/<host>/<วันที่>-<hash8>.json`
- ไม่ส่ง cookie, ไม่ส่ง query string, ไม่ส่ง url เต็ม (เก็บแค่ hash + path)
- ฝั่งเรา: ดูที่ repo นั้น เขียน Lua module ใหม่ push เข้า `NewKewi-configs` → ผู้ใช้ได้ทันทีที่เปิดแอปรอบหน้า **ไม่ต้องออก release**

---

## 9. Chrome extension — popup เหนือ video player

MV3 · อยู่ใน `extension/`

**ฝั่ง background (service worker)**
- `webRequest` ดัก response ที่เป็น `application/vnd.apple.mpegurl`, `video/mp4`, `.m3u8`, `.mpd`
- เก็บเป็นรายการต่อ tab พร้อม header ที่ใช้จริง (`Referer`, `Origin`, `Cookie` ของเว็บนั้น — ส่งต่อให้แอปใช้ทันทีโดยไม่แตะ cookie store)

**ฝั่ง content script**
- เฝ้า `<video>` ด้วย `MutationObserver` + `IntersectionObserver`
- เจอ → แปะ **panel ลอยมุมบนขวาของตัว player** (เหมือน IDM) ปรากฏตอน hover
  ```
  ┌───────────────────────────────┐
  │ 🐦 โหลดวิดีโอนี้        [1080p ▾]│
  └───────────────────────────────┘
  ```
- dropdown รายชื่อความชัดจาก master playlist ที่ background ดักได้ (parse `#EXT-X-STREAM-INF`)
- กดปุ่ม → `POST http://127.0.0.1:47800/add` พร้อม `X-NewKewi-Token`

**ฝั่งแอป (NewKewi.Bridge)**
- ฟัง `127.0.0.1:47800` เท่านั้น (ของเก่าใช้ 47777 — เปลี่ยนพอร์ตกันชนกับแอปเดิมที่ยังติดตั้งอยู่)
- token สุ่มตอนติดตั้ง เก็บคู่กันทั้ง 2 ฝั่ง — เว็บอื่นยิงเข้ามาไม่ได้
- เทสห้ามใช้พอร์ตจริง → ใช้ 47810–47819

---

## 10. ลำดับการสร้าง

| เฟส | ของที่ได้ | เสร็จเมื่อ |
|---|---|---|
| 1 | โครง solution + ไอคอน + หน้าต่างเปล่าเปิดได้ | `dotnet build` ผ่าน แอปเปิดขึ้น |
| 2 | คิว + engine + yt-dlp + remux mp4 | โหลด YouTube/ลิงก์ mp4 ตรงได้จริง |
| 3 | Lua host + SiteRegistry + 1 module ตัวอย่าง | เทสเรียก resolve ผ่าน module ได้ |
| 4 | Generic resolver + ชั้นดึงหน้าเว็บ + Chromium พกพา | เว็บที่ไม่มี module โหลดได้ |
| 5 | UI แบบ IDM เต็ม + หน้าต่าง progress ต่อ channel | ใช้งานจริงได้ |
| 6 | Extension + bridge | กดโหลดจากหน้าเว็บได้ |
| 7 | อัป log + ซิงก์ config | เว็บใหม่เพิ่ม config ได้โดยไม่ออก release |
| 8 | ย้าย module ของเว็บเดิมทั้ง 10 เว็บจาก YtdlpGUI | เทสผ่านครบ |

---

## 11. กฎการเทส (บทเรียนที่แพงที่สุด)

> v1.6.1 เทส 23 ข้อผ่านหมด แต่ของจริงพัง เพราะเทสเรียกตัวแกะลิงก์ตรงๆ
> ส่วน `_download_job` ไม่เคยเดินทางนั้นเลย

- **เทสต้องเข้าทางเดียวกับตอนผู้ใช้กดโหลด** คือเรียก `DownloadEngine.RunAsync(item)` แล้วตรวจ args ที่ส่งให้ yt-dlp
  ไม่ใช่ตรวจแค่ output ของ resolver
- ตัวแทน yt-dlp ปลอมต้อง **ตอบได้ทั้งสำเร็จและล้มเหลว** (ถ้าคืน 0 ตลอด ขั้น fallback จะไม่ถูกเดินเลย)
- เทสห้ามยิงพอร์ตจริง (47800) และห้ามแตะโฟลเดอร์ข้อมูลของผู้ใช้
- ก่อน commit ทุกครั้ง: `git diff --cached --name-only` แล้วมองหาไฟล์ข้อมูลผู้ใช้

---

*ร่างเมื่อ 2026-10-24*
