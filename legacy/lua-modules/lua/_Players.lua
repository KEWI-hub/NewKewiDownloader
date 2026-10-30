-- ตัวช่วยที่ใช้ร่วมกันหลาย module · ชื่อขึ้นต้นด้วย _ แปลว่าไม่ถูกนับเป็น module ของเว็บ
-- เรียกใช้ด้วย  local players = require '_Players'

local M = {}

-- player ตระกูล javplayer: หน้า embed เป็นหน้าเปล่า ลิงก์จริงขอจาก /stream?id=<id>
-- ใช้กับ 123av และเว็บอื่นที่ฝัง player เจ้านี้
function M.javplayerStream(playerUrl)
    local host = playerUrl:regex('^https?://([^/]+)/e/', 1)
    local id = playerUrl:regex('/e/([A-Za-z0-9_-]+)', 1)
    if isempty(host) or isempty(id) then return nil end

    http.Headers['Referer'] = playerUrl
    local data = http.GetJson('https://' .. host .. '/stream?id=' .. id)
    if data == nil or data.media == nil then return nil end

    for _, key in ipairs({ 'stream', 'file', 'url' }) do
        local value = data.media[key]
        if type(value) == 'string' and value ~= '' then
            return value
        end
    end
    return nil
end

-- กวาดหาลิงก์วิดีโอในหน้า player ที่ไม่รู้จัก
-- playlist มาก่อนไฟล์เดี่ยวเสมอ เพราะเว็บมักมี mp4 ตัวอย่างสั้นๆ ปนมาด้วย
function M.scan(html, baseUrl)
    local found = {}
    local seen = {}

    local function take(raw, kind)
        if isempty(raw) then return end
        local full = UrlJoin(baseUrl, raw)
        if full == '' or seen[full] then return end
        seen[full] = true
        table.insert(found, { url = full, kind = kind })
    end

    for _, u in ipairs(html:regexall('https?://[^"\'<>\\s]+[.]m3u8[^"\'<>\\s]*', 0)) do
        take(u, 'hls')
    end
    for _, u in ipairs(html:regexall('"(/[^"]+[.]m3u8[^"]*)"', 1)) do
        take(u, 'hls')
    end
    for _, u in ipairs(html:regexall('https?://[^"\'<>\\s]+[.]mp4[^"\'<>\\s]*', 0)) do
        take(u, 'file')
    end

    return found
end

-- เอาผลจาก scan ใส่ลงใน streams พร้อม referer
function M.addAll(list, referer)
    for _, item in ipairs(list) do
        streams.Add{ url = item.url, kind = item.kind, referer = referer }
    end
    return #list
end

return M
