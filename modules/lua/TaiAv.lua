-- หน้าเว็บ**ไม่มีลิงก์วิดีโอเลย** ทั้งใน HTML ดิบและหลังรัน JS — ต้องถาม API เท่านั้น
--
-- จุดที่พลาดง่าย 2 อย่าง:
--  1. ค่าใน <select class="hdselect"> คือ **ความกว้างของภาพ** (1280) ไม่ใช่ความสูง (720)
--     ส่ง 720 ไปเว็บจะตอบว่า "ไม่ได้ตั้งค่ากลุ่มผู้ใช้สำหรับความละเอียดนี้" ซึ่งหลอกให้คิดว่าต้องเป็น VIP
--  2. API คืน m3u8 มาเป็น **path** ไม่ใช่ url เต็ม ต้อง urljoin ก่อน

function Register()
    module.Name     = 'TaiAv'
    module.Version  = 1
    module.Adult    = true
    module.Priority = 0

    module.Domains:Add('taiav.com')
end

function Probe()
    return url:contains('/movie/')
end

function GetInfo()
    info.Title = dom.SelectValue('//h1')
    if isempty(info.Title) then
        info.Title = dom.Title:before(' - ')
    end
end

-- ความกว้าง -> ความสูง ตามอัตราส่วน 16:9 เผื่อป้ายในหน้าอ่านไม่ได้
local function heightFromWidth(width)
    local w = tonumber(width) or 0
    if w <= 0 then return 0 end
    return math.floor(w * 9 / 16 + 0.5)
end

function GetStreams()
    local id = url:regex('/movie/([0-9a-fA-F]{32})', 1)
    if isempty(id) then
        id = url:afterlast('/movie/'):before('?')
    end
    if isempty(id) then
        log.Warn('หา id ของคลิปใน url ไม่เจอ')
        return
    end

    local widths = dom.SelectValues('//select[contains(@class,"hdselect")]/option/@value')
    local labels = dom.SelectValues('//select[contains(@class,"hdselect")]/option')

    if isempty(widths) then
        log.Warn('หน้าเว็บไม่มี select ความชัด — โครงหน้าอาจเปลี่ยน')
        return
    end

    for i, width in ipairs(widths) do
        -- เว็บนี้ตอบช้ามาก บางครั้ง 504 · ถามทีละความชัด ตัวไหนพังก็ข้าม
        local answer = http.GetJson('https://' .. module.Domain ..
            '/api/getmovie?type=' .. width .. '&id=' .. id)

        if answer ~= nil and not isempty(answer.m3u8) then
            streams.Add{
                url     = UrlJoin(url, answer.m3u8),   -- API คืน path ไม่ใช่ url เต็ม
                kind    = 'hls',
                height  = heightFromWidth(width),
                label   = labels[i] or '',
                referer = 'https://' .. module.Domain .. '/',
            }
        else
            log.Warn('ความชัด ' .. width .. ' ขอไม่ได้ ข้ามไป')
        end
    end
end
