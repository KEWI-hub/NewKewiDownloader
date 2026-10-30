-- supjav.com — ลิงก์ server ซ่อนอยู่ในปุ่ม และถูกเขียน**กลับหลัง**ไว้
--
-- <a class="btn-server" data-link="<สตริงกลับหลัง>">ชื่อ server</a>
-- เอามากลับด้านแล้วต่อท้าย https://lk1.supremejav.com/supjav.php?c= จะได้หน้า player
--
-- หมายเหตุ: เว็บนี้อยู่หลัง Cloudflare (สำรวจแล้วเมื่อ 2026-10-25)
-- ถ้ายังไม่เคยกดผ่านด่าน หน้าที่ดึงมาจะเป็นหน้า challenge แล้วหาปุ่มไม่เจอ

local players = require '_Players'

local JUMP = 'https://lk1.supremejav.com/supjav.php?c='

function Register()
    module.Name     = 'SupJav'
    module.Version  = 1
    module.Adult    = true
    module.Priority = 0

    module.Domains:Add('supjav.com')
end

function GetInfo()
    info.Title = dom.SelectValue('//h1')
    if isempty(info.Title) then
        info.Title = dom.Title:before(' - ')
    end
end

local function reverse(s)
    local out = {}
    for i = #s, 1, -1 do
        out[#out + 1] = s:sub(i, i)
    end
    return table.concat(out)
end

function GetStreams()
    local links = dom.SelectValues('//a[contains(@class,"btn-server")]/@data-link')

    if isempty(links) then
        log.Warn('หาปุ่ม btn-server ไม่เจอ — อาจติดด่าน Cloudflare อยู่ หรือเว็บเปลี่ยนโครง')
        return
    end

    local added = 0
    for _, encoded in ipairs(links) do
        local jump = JUMP .. reverse(encoded)

        http.Reset()
        http.Headers['Referer'] = url
        local playerHtml = http.Get(jump)

        if not isempty(playerHtml) then
            -- player เจ้านี้มักเป็นตระกูล javplayer · ลองทางนั้นก่อน
            local direct = players.javplayerStream(jump)
            if direct ~= nil then
                streams.Add{ url = direct, referer = jump }
                added = added + 1
            else
                added = added + players.addAll(players.scan(playerHtml, jump), jump)
            end
        end

        if added > 0 then break end   -- server แรกที่ได้ผลก็พอ ไม่ต้องไล่ให้ครบ
    end

    if added == 0 then
        log.Warn('ไล่ครบทุก server แล้วยังไม่เจอลิงก์วิดีโอ')
    end
end
