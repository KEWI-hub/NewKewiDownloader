-- 123av — รายชื่อ server ฝังมาในหน้าเป็น JSON ใน attribute ของ Alpine.js
--
--   x-data="player(JSON.parse('[{"name":"1","url":"https://player…/e/xxxx"}]'))"
--
-- ค่าข้างในถูก escape **สองชั้น** (JSON ซ้อนอยู่ใน string ของ JS):
--   " คือเครื่องหมายคำพูด · \\/ คือ /
-- ถ้าไม่คลายก่อน json.Decode จะอ่านไม่ออก

local players = require '_Players'

function Register()
    module.Name     = 'Av123'
    module.Version  = 1
    module.Adult    = true
    module.Priority = 0

    module.Domains:Add('123av.com')
    module.Domains:Add('123av.ws')
end

function GetInfo()
    info.Title = dom.SelectValue('//h1')
    if isempty(info.Title) then
        info.Title = dom.Title:before(' - ')
    end
end

function GetStreams()
    local raw = page:regex([==[x-data=["']player\(JSON\.parse\('(.*?)'\)]==], 1)
    if isempty(raw) then
        log.Warn('หา x-data ของ player ในหน้าไม่เจอ — เว็บอาจเปลี่ยนโครง')
        return
    end

    raw = raw:gsub('\\u0022', '"'):gsub('\\\\/', '/')

    local list = json.Decode(raw)
    if list == nil then
        log.Warn('คลาย escape แล้วแต่ json ยังอ่านไม่ออก')
        return
    end

    local added = 0
    for _, entry in ipairs(list) do
        local playerUrl = entry.url
        if type(playerUrl) == 'string' and playerUrl:contains('http') then
            playerUrl = playerUrl:before('?')
            if playerUrl == '' then playerUrl = entry.url end

            local direct = players.javplayerStream(playerUrl)
            if direct ~= nil then
                streams.Add{ url = direct, referer = playerUrl }
                added = added + 1
            end
        end

        if added > 0 then break end   -- ตอนแรกที่ได้ผลก็พอ
    end

    if added == 0 then
        log.Warn('มีรายชื่อ server แต่ขอลิงก์จาก player ไม่ได้สักตัว')
    end
end
