-- player ตระกูล Next.js ที่หน้า HTML ว่างเปล่า ลิงก์จริงมาจาก API
-- หน้าเว็บแม่ฝัง iframe ไป https://<player>/e/<รหัส 12 ตัว>
--
-- จุดที่พลาดง่าย: **โดเมน API ห้าม hardcode** เจ้านี้สลับโดเมนบ่อย
-- ต้องอ่านจากไฟล์ chunk ของหน้า player ทุกครั้ง

function Register()
    module.Name     = 'StreamOrigin'
    module.Version  = 1
    module.Adult    = true
    module.Priority = 0

    module.Domains:Add('pornavhd.com')
    module.Domains:Add('video.playerrecord.cfd')
end

-- หา url ของหน้า player · ถ้าผู้ใช้วางลิงก์ player มาตรงๆ ก็ใช้อันนั้นเลย
local function getPlayerUrl()
    if url:regex('/e/([A-Za-z0-9]+)', 1) ~= '' or url:contains('/e/') then
        return url
    end

    for _, src in ipairs(dom.SelectValues('//iframe/@src')) do
        if src:contains('/e/') then
            return UrlJoin(url, src)
        end
    end

    return ''
end

-- โดเมน API ซ่อนอยู่ในไฟล์ chunk ของ Next.js
local function findApiBase(playerUrl, playerHtml)
    local direct = playerHtml:regex('https://[A-Za-z0-9.-]+/app/v1', 0)
    if not isempty(direct) then
        return direct:before('/app/v1')
    end

    local chunkDom = Dom.New(playerHtml)
    for _, src in ipairs(chunkDom.SelectValues('//script/@src')) do
        if src:contains('_next/static/chunks') then
            local js = http.Get(UrlJoin(playerUrl, src))
            local found = js:regex('"(https://[A-Za-z0-9.-]+)"[^"]*app/v1', 1)
            if isempty(found) then
                found = js:regex('https://[A-Za-z0-9.-]+[.]cc', 0)
            end
            if not isempty(found) then
                return found
            end
        end
    end

    return ''
end

function GetInfo()
    info.Title = dom.SelectValue('//h1')
end

function GetStreams()
    local playerUrl = getPlayerUrl()
    if isempty(playerUrl) then
        log.Warn('หน้าเว็บไม่มี iframe ของ player')
        return
    end

    local playerOrigin = playerUrl:before('/e/')
    http.Headers['Referer'] = playerUrl
    local playerHtml = http.Get(playerUrl)

    local apiBase = findApiBase(playerUrl, playerHtml)
    if isempty(apiBase) then
        log.Warn('หาโดเมน API ใน chunk ของ player ไม่เจอ — เจ้านี้อาจเปลี่ยนโครงหน้าอีกแล้ว')
        return
    end

    local id = playerUrl:afterlast('/e/'):before('?')
    if isempty(id) then id = playerUrl:afterlast('/e/') end

    http.Headers['Referer'] = playerOrigin .. '/'
    http.Headers['Origin']  = playerOrigin
    local answer = http.GetJson(apiBase .. '/app/v1/play/' .. id .. '?embed=1')

    if answer == nil or isempty(answer.hls) then
        log.Warn('API ตอบมาแต่ไม่มีช่อง hls')
        return
    end

    if not isempty(answer.title) and isempty(info.Title) then
        info.Title = answer.title
    end
    if answer.duration ~= nil then
        info.Duration = tonumber(answer.duration) or 0
    end

    streams.Add{
        url     = answer.hls,
        kind    = 'hls',
        height  = tonumber(answer.height) or 1080,
        -- ลิงก์อยู่ได้ราวหนึ่งชั่วโมง (expires_at) ต้องขอใหม่ทุกครั้งที่เริ่มโหลด
        expires = true,
        referer = playerOrigin .. '/',
    }
end
