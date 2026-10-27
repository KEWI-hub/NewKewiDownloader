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
| [`KEWI-hub/NewKewiDownloader`](https://github.com/KEWI-hub/NewKewiDownloader) | public | โค้ด + release |
| [`KEWI-hub/NewKewi-configs`](https://github.com/KEWI-hub/NewKewi-configs) | public | `modules/lua/` ของจริง แอปซิงก์มาเองทุกครั้งที่เปิด |
| `KEWI-hub/NewKewi-logs` | **private** | log ของเว็บที่โหลดไม่ได้ ไว้ให้เอามาทำ config |

**เช็คทุกครั้งว่า public/private ไม่สลับกัน** — repo log เป็น private เสมอ เพราะข้างในมีชื่อเว็บที่ผู้ใช้เข้า
ตรวจด้วย `gh repo view KEWI-hub/NewKewi-logs --json isPrivate`

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

> **ไม่เปิด `CoreModules.LoadMethods` ของ MoonSharp** ทั้งที่มันให้ `require` มาฟรีๆ
> เพราะมันพ่วง `dofile` กับ `loadfile` มาด้วย ซึ่งรับ path ตรงๆ แล้วอ่านไฟล์ไหนในเครื่องก็ได้
> — รูรั่วใหญ่พอๆ กับการเปิด `io` ทิ้งไว้
>
> `require` จึงเขียนเอง: รับเฉพาะ**ชื่อ module เปล่าๆ** (ตัวอักษร เลข `_` `-` เท่านั้น)
> และหาไฟล์เฉพาะในโฟลเดอร์ module · มีเทสยิง `dofile`, `loadfile`, `require('../..')`,
> `require('C:/…')` และ `require('a/b')` ยืนยันว่าถูกปิดหมด

> **กับดักของ `json.Decode`:** ตัวแปลง JSON ของ MoonSharp ทำงานโดยปั้นเป็นโค้ด Lua แล้วแปลซ้ำ
> ทำให้ `\/` ที่ถูกต้องตามมาตรฐาน JSON กลายเป็น escape ที่ Lua ไม่รู้จัก แล้วพังทั้งก้อน
> เว็บวิดีโอหนีสแลชแบบนี้แทบทุกเจ้า (`"videoSource":"https:\/\/cdn\/x"`)
> ชั้น host จึงคลายให้ก่อนเสมอ — ถ้าปล่อยให้ module ไปคลายเองจะลืมกันทุกตัว

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

### ผลสำรวจจริง (2026-10-25)

วัดด้วย `LiveBotWallProbe` ยิงจากเครื่องจริง — ตัวเลขนี้เปลี่ยนได้ตามที่เว็บตั้งค่าไว้ ณ วันนั้น

| เว็บ | ชั้น 1 | ชั้น 2 | สรุป |
|---|---|---|---|
| taiav.com | 200 · ผ่าน | — | ชั้น 1 พอ |
| av-th.io | 200 · ผ่าน | — | ชั้น 1 พอ |
| 123av.com | 200 · ผ่าน | — | ชั้น 1 พอ |
| **pornavhd.com** | 403 · ติดด่าน | ยังติดด่าน | **ต้องให้คนกดเอง** |
| **supjav.com** | 403 · ติดด่าน | ยังติดด่าน | **ต้องให้คนกดเอง** |

สรุปที่ได้: ชั้น 3 **ไม่ใช่ของเผื่อไว้ แต่จำเป็นจริง** กับสองเว็บนี้
Chromium แบบ headless ผ่าน Cloudflare เองไม่ได้ ต่อให้รัน JS ครบแล้วก็ตาม

### ข้อสำคัญที่ทำให้การฝ่าด่านมีผลจริง

ผ่านด่านแล้วได้ cookie `cf_clearance` มา แต่ cookie ตัวนี้**ผูกกับ User-Agent ที่ใช้ตอนได้มันมา**
ถ้าเอาไปใช้กับ UA คนละตัว Cloudflare จะไม่ยอม แล้วจะเจอด่านซ้ำทั้งที่เพิ่งกดผ่านไป

แอปจึงต้องใช้ UA ตัวเดียวกันทุกชั้น · เก็บไว้ที่ `BrowserIdentity` (`data/identity.json`):

```
Chromium พกพา  ──จด UA──▶  BrowserIdentity  ──▶  HttpClient (header User-Agent)
                                   └──────────▶  yt-dlp (--user-agent)
cookie ที่ได้  ──▶ data/cookies.txt ──▶ HttpClient (CookieContainer) + yt-dlp (--cookies)
```

`WebClient` โหลด `cookies.txt` ใหม่เองเมื่อไฟล์ถูกเขียนทับ (ดูจากเวลาแก้ไขล่าสุด)
จึงไม่ต้องรีสตาร์ตอะไรหลังผู้ใช้กดผ่านด่าน

**สิ่งที่แอปไม่ทำ:** ไม่แก้โจทย์ CAPTCHA หรือ challenge ให้ · มันแค่เปิดเบราว์เซอร์จริงค้างไว้
แล้วคอยดูว่าหน้าเปลี่ยนไปหรือยัง คนเป็นคนกดเอง

### ส่วนขยายกันโฆษณา

Chromium พกพาโหลดส่วนขยายจากโฟลเดอร์ที่ตั้งไว้ (`AdBlockExtensionPath`) ด้วย
`--load-extension` + `--disable-extensions-except` · ค่าเริ่มคือมองหา `extensions/ad-skipper` ข้างตัวแอป

ช่วย 2 อย่าง: หน้าเว็บที่เต็มไปด้วย popup แกะลิงก์ได้สะอาดกว่า และตอนผู้ใช้ต้องกดผ่านด่านเอง
จะไม่มีโฆษณาเด้งทับหน้าต่าง

แอปเช็คว่าส่วนขยาย**ทำงานจริง**ไหม ด้วยการดูร่องรอยที่สคริปต์ของมันทิ้งไว้ในหน้าเว็บ
ไม่ใช่แค่ดูว่าส่งธงไปแล้ว — ส่วนขยายที่ manifest พังจะโหลดไม่ขึ้นโดยไม่มี error ให้เห็น

### 4.2 ไม่มี retry

ข้อกำหนดของเจ้าของ: **fail แล้วจบ** ไม่วนซ้ำ

แยกให้ชัดว่า "retry" ที่ตัดทิ้งคืออันไหน:

| ชั้น | ค่าที่ตั้ง | เหตุผล |
|---|---|---|
| **retry ระดับงาน** (เอาคลิปเดิมกลับเข้าคิวใหม่) | **ไม่มีเลย** | นี่คือตัวที่เคยทำให้คลิปเดิมวน 8–9 รอบไม่หยุด |
| `--retries` / `--extractor-retries` ของ yt-dlp | `0` | เท่ากับลองครั้งเดียวจริงๆ |
| `--fragment-retries` | `3` (ตั้งเป็น `0` ได้ในตั้งค่า) | ชิ้นส่วนสะดุดหนึ่งชิ้นใน**ความพยายามเดียวกัน** ไม่ใช่การลองงานใหม่ · ตั้ง 0 แล้ว HLS ยาวๆ จะล้มบ่อยมาก |

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
2. เป็น mp4 อยู่แล้ว → จบ ไม่แตะ
3. ไม่ใช่ → `ffmpeg -c copy -movflags +faststart` **เปลี่ยนกล่องอย่างเดียว ไม่ encode**
4. ขั้น 3 ไม่ผ่าน → `-c:v copy -c:a aac` แปลงเฉพาะเสียง (opus/vorbis มักเป็นตัวปัญหา)
5. ยังไม่ผ่าน → `-c:v libx264 -c:a aac` เป็นทางสุดท้าย
6. **ไม่มีการแปลงเป็น H.265 ทุกกรณี** — ของเดิมที่เป็น hevc อยู่แล้วก็ copy เฉยๆ
7. สำเร็จแล้วค่อยลบไฟล์ต้นทาง · ขั้นที่ล้มเหลวลบไฟล์ครึ่งๆ ทิ้งก่อนไปขั้นถัดไป

> **ต่างจากที่ร่างไว้ตอนแรก:** ร่างเดิมจะดูรายชื่อ codec แล้วตัดสินใจว่าจะ copy หรือ encode
> แต่รายชื่อที่ mp4 รับได้เปลี่ยนไปตามเวอร์ชัน ffmpeg (เช่น av1/vp9 ใส่ mp4 ได้แล้ว)
> การ**ลอง copy จริงแล้วค่อยถอย**จึงแม่นกว่าและไม่ไป encode ของที่ copy ได้อยู่แล้วทิ้งเปล่าๆ

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

- **ดับเบิลคลิก → หน้าต่างรายละเอียดงาน**: แถบรวม + **แถบแบ่งชิ้นส่วนของ HLS** + ตัวเลข
  (ขนาด, โหลดแล้ว, ความเร็ว, เหลืออีก, ใช้เวลาไป) + ลิงก์ต้นทาง/สตรีม/ปลายทาง/config ที่ใช้

> **ต่างจาก IDM ตรงนี้ และเป็นข้อจำกัดจริงที่แก้ไม่ได้ด้วยการเขียนโค้ดเพิ่ม:**
> IDM วาดแถบแยกต่อ connection ได้เพราะมัน**ยิง HTTP range เอง** จึงรู้ว่าแต่ละเส้นโหลดถึงไบต์ไหน
> ของเราใช้ yt-dlp เป็นตัวโหลด ซึ่งรายงานความคืบหน้า**รวม**ก้อนเดียว ไม่แยกรายช่อง
>
> หน้าต่างรายละเอียดจึงแสดงเฉพาะของที่เป็นข้อมูลจริง: แถบรวม, `fragment_index / fragment_count`
> ของ HLS (วาดเป็นแถบแบ่งช่วงได้สวยพอกัน) และจำนวนช่องที่ตั้งไว้พร้อมคำอธิบายว่าทำไมไม่มีตัวเลขรายช่อง
> **ไม่วาดแถบต่อช่องแบบเดาเอา** เพราะมันจะเป็นภาพหลอกที่ดูเหมือนข้อมูลจริง
>
> ถ้าอยากได้แถบรายช่องจริงๆ ทางเดียวคือเลิกใช้ yt-dlp เป็นตัวโหลดไฟล์เดี่ยวแล้วเขียนตัวโหลด
> HTTP range เอง (หรือ parse stdout ของ aria2c ซึ่งรายงานรายการเชื่อมต่อ) — ยังไม่ทำ
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
  "app": "0.7.0",
  "when": "2026-10-25T13:20:00Z",
  "host": "example.com",
  "urlHash": "sha256 ของ url เต็ม",
  "urlPath": "/movie/abc123",
  "reason": "หาลิงก์วิดีโอในหน้านี้ไม่เจอ — ต้องเขียน config ของเว็บนี้",
  "trail": [
    "fetch:Simple status=403 bytes=5584",
    "browser:silent bytes=28665 requests=12",
    "frame depth=1 status=200 player.example.com",
    "captured matches=0"
  ]
}
```

ร่องรอย (`trail`) มาจาก `GenericResolver` ซึ่งบันทึกไว้ระหว่างเดินอยู่แล้ว
ทุกบรรทัดผ่าน `DiagnosticBuilder.Scrub` ก่อนเสมอ ซึ่ง:

- ตัด **query string** ของทุก url ที่โผล่ในข้อความ (ในนั้นมักมี token กับ id ของผู้ใช้)
- ตัดค่าที่หน้าตาเป็นความลับ (`token=` `key=` `session=` `signature=` …) เหลือ `***`
- ตัดความยาวเกิน 300 ตัวอักษรต่อบรรทัด และเก็บไม่เกิน 40 บรรทัด

คัดกรองที่เดียวใน `DiagnosticBuilder` ไม่กระจายไปทำตามจุดต่างๆ — ตรวจง่ายและเทสคลุมได้หมด

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
- เขียนเซิร์ฟเวอร์เองบน `TcpListener` (`MiniHttpServer`) ไม่ใช้ `HttpListener`
  เพราะ HttpListener บน Windows ต้องจอง URL ACL ในบางเครื่อง ซึ่งเด้งขอสิทธิ์ผู้ดูแลระบบ
- เทสยิงเข้าทางซ็อกเก็ตจริงด้วยพอร์ต **0** (ให้ระบบเลือกให้) · ห้ามแตะ 47800 ซึ่งเป็นพอร์ตของแอปจริง

### ด่านความปลอดภัย 4 ชั้นของ Bridge

ของที่เปิดพอร์ตทิ้งไว้ต้องคิดเรื่องนี้ให้ครบ ไม่งั้นหน้าเว็บที่ผู้ใช้เปิดอยู่สั่งแอปได้

| ชั้น | กันอะไร |
|---|---|
| ผูกกับ `127.0.0.1` เท่านั้น | เครื่องอื่นในวงแลนต่อเข้ามาไม่ได้เลย |
| ต้องมี token ที่สุ่มไว้ (เทียบแบบเวลาคงที่) | หน้าเว็บทั่วไปไม่มีทางรู้ และเดาทีละตัวอักษรไม่ได้ |
| ต้องมีหัว `X-NewKewi: 1` | ฟอร์ม HTML ธรรมดาส่งหัวนี้ไม่ได้ ต้องผ่าน CORS preflight ก่อน → กัน CSRF |
| ขอ token ครั้งแรก **ผู้ใช้ต้องกดอนุญาตในแอป** | ไม่มีทางได้ token มาเงียบๆ · ไม่มีคนรับเรื่อง = ปฏิเสธเสมอ ห้าม default เป็นอนุญาต |

เพิ่มอีกชั้น: ขอจับคู่ถี่กว่า 10 วินาทีต่อครั้งถูกปัดทิ้ง (429) กันการถามรัวๆ จนผู้ใช้เผลอกดอนุญาต

**ไม่รับ cookie จากส่วนขยาย** — ฝั่งแอปตัดหัว `Cookie` ทิ้งเสมอ
แอปใช้ cookie ของเบราว์เซอร์ตัวเองเท่านั้น (ดู §7)

### Chromium พกพาก็โหลดส่วนขยายนี้ด้วย

`ExtensionPaths` รับได้หลายโฟลเดอร์ แอปจึงเสียบทั้ง 2 ตัวเข้าไป:
ส่วนขยายของแอปเอง (`extension/`) กับตัวกันโฆษณา
เบราว์เซอร์ของแอปจึงมีปุ่มโหลดเหนือวิดีโอเหมือนกัน โดยผู้ใช้ไม่ต้องติดตั้งอะไรซ้ำ

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
| 7 | อัป log + ซิงก์ config + กฎตั้งชื่อไฟล์ (§11) | เว็บใหม่เพิ่ม config ได้โดยไม่ออก release |
| 8 | ย้าย module ของเว็บเดิมทั้ง 10 เว็บจาก YtdlpGUI | เทสผ่านครบ |

---

## 11. กฎตั้งชื่อไฟล์ต่อเว็บ (เฟส 7)

ไอเดียนี้ยืมแนวคิดมาจาก **Video DownloadHelper** (เว็บ `downloadhelper.net`) ซึ่งมีไฟล์กฎ
สำหรับบอกว่าแต่ละเว็บควรตั้งชื่อไฟล์อย่างไร · ตัวส่วนขยายของเขาเป็นของปิดและเป็นเชิงพาณิชย์
(ACLAP SAS) จึง**เอาแต่แนวคิด ไม่ได้เอาโค้ดหรือรูปแบบไฟล์ของเขามา**

เว็บที่**มี Lua module อยู่แล้วไม่ต้องใช้** เพราะ `GetInfo()` ตั้งชื่อได้อิสระกว่ามาก
กฎชุดนี้มีไว้สำหรับ**เว็บที่ไม่มี module** (ทางทั่วไป) ซึ่งตอนนี้ได้ชื่อตามที่ yt-dlp เดาให้
— จะได้ไม่ต้องเขียน module ทั้งไฟล์แค่เพราะอยากแก้ชื่อไฟล์

`modules/naming.json`

```json
{
  "default": { "maxLength": 120, "template": "{title}" },
  "rules": [
    {
      "host": "example.com",
      "template": "[{host}] {title} ({quality})",
      "titleFrom": "//h1[@class='video-title']",
      "folder": "example",
      "replace": [{ "from": "\\s+", "to": " " }]
    }
  ]
}
```

- ตัวแปรที่ใช้ได้: `{title}` `{host}` `{quality}` `{date}` `{id}`
- `titleFrom` เป็น **XPath** (ชุดเดียวกับที่ `dom.SelectValue` ใช้) ไม่ใช่ CSS selector
  เพราะทั้งแอปใช้ XPath อยู่แล้ว จะได้ไม่มีสองภาษาให้จำ
- กฎเรียงตามลำดับในไฟล์ ตัวบนชนะ · ไม่มีกฎไหนตรงก็ใช้ `default`
- `replace` ทำกับ **ค่าของ `{title}` ก่อน**เอาไปใส่ในรูปแบบ ไม่ใช่ทำกับชื่อที่ประกอบเสร็จแล้ว

> **ทำไมต้องเป็นลำดับนี้** — เจอตอนเขียนเทส: ขยะมาจากชื่อหน้าเว็บ (เช่นลงท้ายด้วย `- ชื่อเว็บ`)
> กฎที่คนเขียนจึงมักยึดท้ายสตริงด้วย `$` ถ้าเอาไปทำหลังประกอบเสร็จ กฎจะหยุดแมตช์ทันที
> ที่รูปแบบมีอะไรต่อท้าย เช่น `{title} ({quality})` — เงียบๆ โดยไม่มี error ให้เห็น

**ข้อจำกัดที่ต้องบอกตรงๆ:** คลิปที่ถูกคุ้มครองด้วย DRM (Widevine/PlayReady) โหลดไม่ได้
ไม่ว่าจะเขียน config ยังไง — แอปควรตรวจเจอแล้วบอกไปตรงๆ ไม่ใช่ปล่อยให้ผู้ใช้รอแล้วล้มเหลวงงๆ

## 12. ออกเวอร์ชัน

ทุกอย่างทำโดย GitHub Actions · คนทำแค่ 3 อย่าง

```bash
# 1. แก้ <Version> ใน src/NewKewi.App/NewKewi.App.csproj ให้ตรงกับ tag ที่จะ push
# 2. อัป changelog ใน README.md
# 3. tag แล้ว push
git tag v0.8.0 && git push origin v0.8.0
```

| workflow | เมื่อไหร่ | ทำอะไร |
|---|---|---|
| `ci.yml` | push / PR เข้า main | build + เทสชุดปกติ + ตรวจว่า module ทุกไฟล์โหลดขึ้น |
| `release.yml` | push tag `v*` | เทส → publish exe → ประกอบ zip → สร้าง release |

**ตัวกันเวอร์ชันเพี้ยน:** `release.yml` อ่าน `<Version>` ใน csproj มาเทียบกับ tag
ไม่ตรงกันคือหยุดทันที · ปล่อยให้เพี้ยนแล้วจะได้ exe ที่หัวหน้าต่างบอกเวอร์ชันผิด
ซึ่งเวลาผู้ใช้แจ้งปัญหาจะไล่ไม่ถูกว่าเขาใช้ตัวไหนอยู่

### ของที่แนบไปกับ release

| ไฟล์ | เนื้อใน |
|---|---|
| `NewKewiDownloader-vX.Y.Z-win-x64.zip` | **ตัวที่คนทั่วไปควรโหลด** · exe + `modules/` + `extension/` + `START-HERE.txt` |
| `NewKewiDownloader.exe` | เฉพาะตัวแอป สำหรับคนที่มีของพวกนั้นอยู่แล้ว |

exe เป็น **self-contained single file** (~67 MB) ผู้ใช้ไม่ต้องติดตั้ง .NET แยก

### ของหนักที่แอปโหลดเองตอนใช้ครั้งแรก

ทั้งสองอย่างนี้**ไม่ได้อยู่ทั้งใน repo และใน zip** · `IDownloader` เป็นตัวโหลดร่วมของทั้งคู่

| ของ | ขนาด | ตัวติดตั้ง | เมื่อไหร่ |
|---|---|---|---|
| yt-dlp · ffmpeg · ffprobe · aria2c | ~106 MB | `ToolInstaller` | ตอนเปิดแอปครั้งแรก (ถามก่อน) |
| Chromium พกพา | ~150 MB | `ChromiumInstaller` | ตอนต้องใช้เบราว์เซอร์จริงครั้งแรก (ถามก่อน) |

**ทำไมไม่แนบมาใน zip ให้จบ** — yt-dlp ออกรุ่นใหม่แทบทุกสัปดาห์เพราะเว็บเปลี่ยนตลอด
ถ้าแนบไปกับ release ผู้ใช้จะติดอยู่กับรุ่นของวันที่ปล่อย จนกว่าเราจะออก release ใหม่
ซึ่งไม่เกี่ยวกับตัวแอปเลย · ให้แอปโหลดเองแปลว่าได้รุ่นล่าสุดเสมอ และ zip เล็กลงจาก 210 MB เหลือราว 70 MB

`ToolInstaller` ตรวจของที่ได้มา 2 ชั้น: ขนาดต้องสมเหตุสมผล (กันกรณีได้หน้า error ของเว็บมาแทน)
แล้วสั่ง `--version` ดูว่ารันขึ้นจริง · ไม่ผ่านชั้นไหนก็ลบไฟล์ทิ้ง
ไม่ปล่อยไฟล์เสียไว้ให้แอปเข้าใจผิดว่ามีเครื่องมือครบแล้ว

> ผู้ใช้ที่มีไฟล์พวกนี้อยู่แล้วก๊อปลง `bin/` เองได้ แอปจะไม่โหลดซ้ำ

## 13. กฎการเทส (บทเรียนที่แพงที่สุด)

> v1.6.1 เทส 23 ข้อผ่านหมด แต่ของจริงพัง เพราะเทสเรียกตัวแกะลิงก์ตรงๆ
> ส่วน `_download_job` ไม่เคยเดินทางนั้นเลย

- **เทสต้องเข้าทางเดียวกับตอนผู้ใช้กดโหลด** คือเรียก `DownloadEngine.RunAsync(item)` แล้วตรวจ args ที่ส่งให้ yt-dlp
  ไม่ใช่ตรวจแค่ output ของ resolver
- ตัวแทน yt-dlp ปลอมต้อง **ตอบได้ทั้งสำเร็จและล้มเหลว** (ถ้าคืน 0 ตลอด ขั้น fallback จะไม่ถูกเดินเลย)
- เทสห้ามยิงพอร์ตจริง (47800) และห้ามแตะโฟลเดอร์ข้อมูลของผู้ใช้

### ตรวจก่อน commit ทุกครั้ง — ตรวจแบบ whitelist เท่านั้น

```bash
git diff --cached --name-only |
  grep -vE "^(src/|tests/|docs/|modules/|assets/|extension/|\.github/|README\.md|\.gitignore|NewKewi\.slnx)"
```

ไม่มีอะไรออกมา = ปลอดภัย · มีอะไรออกมา = หยุดแล้วดูให้ดีก่อน

> **เหตุการณ์จริงตอนทำเฟส 5 (เกือบซ้ำรอยเดิม):** `git add -A` ดูดโฟลเดอร์ `_profile-silent/`
> เข้า staging ซึ่งข้างในมี `History`, `Network/Cookies`, `Login Data` ของเบราว์เซอร์แอป
>
> สาเหตุ: `.gitignore` เขียนไว้ว่า `_profile/` แต่โค้ดสร้างโฟลเดอร์ชื่อ `_profile-silent`
> (`BrowserProfile + "-silent"`) ซึ่งเป็น**คนละชื่อ** กฎเลยไม่ครอบ
>
> ที่แย่กว่านั้นคือ **การตรวจก็พลาดด้วย** เพราะใช้ `grep -E "^_profile/"` ซึ่งไม่แมตช์
> `_profile-silent/` แล้วรายงานว่า "สะอาด" ทั้งที่ไม่สะอาด
>
> **บทเรียน 2 ข้อ:**
> 1. ตรวจด้วย **whitelist** (อะไรที่ไม่ได้อยู่ในที่ที่ควรอยู่) ไม่ใช่ blacklist
>    เพราะ blacklist พลาดสิ่งที่เราไม่ได้นึกถึง ซึ่งคือทุกกรณีที่อันตรายจริง
> 2. แก้ที่**โครงสร้าง** ไม่ใช่แค่เพิ่ม pattern — ย้าย profile ทั้งสองโหมดลงใต้ `_profile/`
>    (`_profile/silent`, `_profile/visible`) เพื่อให้กฎบรรทัดเดียวครอบได้หมดตลอดไป

### เทส 2 ชุด

| ชุด | คำสั่ง | ไฟล์ตั้งค่า |
|---|---|---|
| ปกติ (ไม่ยิงเน็ต) | `dotnet test` | `default.runsettings` — กรอง `Category != live` |
| ของจริง (ยิงเน็ต + เปิด Chromium) | `dotnet test --settings tests/NewKewi.Tests/live.runsettings` | `live.runsettings` — กรอง `Category = live` |

**ทำไมต้องมีไฟล์ตั้งค่าแยก 2 ไฟล์:** ธง `--filter` ของ `dotnet test` ถูก **"และ"** เข้ากับ
`TestCaseFilter` ใน runsettings ไม่ใช่เขียนทับ สั่ง `--filter "Category=live"` เฉยๆ จึงกลายเป็น
`Category!=live && Category=live` แล้วไม่เหลือเทสให้รันเลย — เสียเวลาไปรอบหนึ่งแล้วตอนทำเฟส 4

> **กับดักของไฟล์ `.runsettings`:** คอมเมนต์ XML ห้ามมี `--` อยู่ข้างใน
> เขียนชื่อธงบรรทัดคำสั่งลงในคอมเมนต์ตรงๆ แล้วไฟล์จะใช้ไม่ได้ทันที (เจอมาแล้ว 2 ครั้ง)

---

*ร่างเมื่อ 2026-10-24*
