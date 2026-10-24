-- ไฟล์ตัวอย่าง · ชื่อขึ้นต้นด้วย _ แปลว่าแอปไม่โหลดเป็น module ของเว็บ
-- ก๊อปไฟล์นี้ไปตั้งชื่อใหม่แล้วแก้ ถ้าจะเพิ่มเว็บ
--
-- วางไฟล์ที่ modules/lua/   = ของที่ซิงก์มาจาก repo (ถูกทับทุกครั้งที่ซิงก์)
-- วางไฟล์ที่ modules/local/ = ของตัวเอง (ชนะเสมอ ไม่ถูกทับ)

-- บังคับต้องมี · รันตอนเปิดแอป ห้ามยิงเน็ตในนี้
function Register()
    module.Name     = 'Example'
    module.Version  = 1
    module.Adult    = false
    module.Priority = 0          -- เลขน้อยถูกลองก่อนเมื่อหลาย module รับโดเมนเดียวกัน

    module.Domains:Add('example.com')
    module.Domains:Add('cdn.example.com')
end

-- ไม่บังคับ · คัดกรองละเอียดกว่าโดเมน คืน false แล้วแอปจะข้ามไป module ถัดไป
function Probe()
    return url:contains('/watch/')
end

-- ไม่บังคับ · ไม่เขียนก็ได้ แอปจะให้ yt-dlp ตั้งชื่อเอง
function GetInfo()
    info.Title    = dom.SelectValue('//h1')
    info.Duration = tonumber(dom.SelectValue('//meta[@itemprop="duration"]/@content')) or 0
end

-- บังคับ · เรียก streams.Add หนึ่งครั้งต่อหนึ่งความชัดที่เลือกได้
function GetStreams()
    local playerUrl = dom.SelectValue('//iframe/@src')
    local playerHtml = http.Get(playerUrl)

    local master = playerHtml:regex('"(https://[^"]+[.]m3u8[^"]*)"', 1)

    streams.Add{
        url    = master,
        kind   = 'hls',          -- 'hls' | 'dash' | 'file' · ไม่ใส่ก็เดาจากนามสกุลให้
        height = 1080,
        label  = '1080p',
        referer = 'https://' .. module.Domain .. '/',

        -- ใส่เมื่อ playlist กับไฟล์ย่อยต้องใช้ header คนละชุดเท่านั้น
        -- ใส่แค่ชุดเดียว = ใช้ชุดนั้นทั้งสองขั้น
        -- playlistHeaders = { Origin = 'https://player.example.com' },
        -- segmentHeaders  = { },     -- ว่าง = ห้ามส่งอะไรเลยตอนโหลดไฟล์ย่อย

        -- ลิงก์หมดอายุ → แอปจะขอใหม่ทุกครั้งที่เริ่มโหลด ไม่เก็บไว้ใช้ซ้ำ
        -- expires = true,
    }
end

--[[ ของที่เรียกได้ใน module

ตัวแปรพร้อมใช้
    url            ลิงก์ที่ผู้ใช้ใส่มา
    page           HTML ของหน้านั้น (แอปดึงมาให้แล้วหนึ่งครั้ง)
    dom            DOM ของ page
    module.Domain  โดเมนที่แมตช์

http
    http.Get(u)            http.Post(u)          http.GetJson(u)   http.GetStatus(u)
    http.Headers['K'] = v  http.PostData['k'] = v                  http.Reset()

dom / Dom
    dom.SelectValue(xpath)      ค่าแรก ('' ถ้าไม่เจอ) · รองรับ /@attr ท้าย xpath
    dom.SelectValues(xpath)     ตารางของทุกค่า
    dom.Exists(xpath)           dom.Title       dom.Html
    Dom.New(html)               สร้าง dom จาก HTML ก้อนอื่น

เมธอดของสตริง (เรียกด้วยโคลอน)
    s:regex(pattern, group)     s:regexall(pattern, group)
    s:contains(x)   s:before(x)  s:after(x)  s:beforelast(x)  s:afterlast(x)
    s:trim()        s:urljoin(path)

อื่นๆ
    json.Decode(s)  json.Encode(t)
    isempty(v)      UrlJoin(base, path)     RegexReplace(s, pattern, repl)
    UnpackJs(s)     แตก eval(function(p,a,c,k,e,d) ของ packer
    HexUnescape(s)  แปลง \x5a\x54 กลับเป็นตัวอักษร
    Base64.Decode(s)  Base64.Encode(s)
    log.Info(m)     log.Warn(m)     ข้อความไว้ไล่ปัญหาเวลาเว็บเปลี่ยน

**ไม่มีให้ใช้โดยตั้งใจ:** io, os.execute, debug, require ออกนอกโฟลเดอร์ module
module มาจาก repo สาธารณะ จึงแตะไฟล์ในเครื่องไม่ได้ ออกเน็ตได้ทาง http เท่านั้น
]]
