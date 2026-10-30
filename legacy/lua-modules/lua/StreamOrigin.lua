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
--
-- **คืนเป็นรายการ ไม่ใช่ตัวเดียว** — ในไฟล์ chunk มีหลายโดเมนปนกัน
-- เคยคว้าตัวแรกที่เจอแล้วได้ api.streamorigin.cc ซึ่งตอบ 401
-- ส่วนตัวที่ใช้ได้จริงคือ embedorigin.cc ที่อยู่ถัดไป
local function apiCandidates(playerUrl, playerHtml)
    local found, seen = {}, {}

    local function take(domain)
        if isempty(domain) or seen[domain] then return end
        -- เอาเฉพาะโดเมนที่หน้าตาเป็นของ player เจ้านี้ ไม่งั้นจะได้ CDN ของคนอื่นมาเต็มไปหมด
        if not (domain:contains('embed') or domain:contains('origin')) then return end
        seen[domain] = true
        table.insert(found, domain)
    end

    take(playerHtml:regex([[(https://[A-Za-z0-9.-]+)/app/v1]], 1))

    local chunkDom = Dom.New(playerHtml)
    for _, src in ipairs(chunkDom.SelectValues('//script/@src')) do
        if src:contains('_next/static/chunks') then
            local js = http.Get(UrlJoin(playerUrl, src))
            if js:contains('app/v1') then
                for _, domain in ipairs(js:regexall([[https://[A-Za-z0-9.-]+]], 0)) do
                    take(domain)
                end
            end
        end
    end

    -- โดเมนที่มีคำว่า embed มักเป็นตัวที่รับคำขอของ player จริง ลองก่อน
    local ordered = {}
    for _, d in ipairs(found) do
        if d:contains('embed') then table.insert(ordered, d) end
    end
    for _, d in ipairs(found) do
        if not d:contains('embed') then table.insert(ordered, d) end
    end
    return ordered
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

    local candidates = apiCandidates(playerUrl, playerHtml)
    if #candidates == 0 then
        log.Warn('หาโดเมน API ใน chunk ของ player ไม่เจอ — เจ้านี้อาจเปลี่ยนโครงหน้าอีกแล้ว')
        return
    end

    local id = playerUrl:afterlast('/e/'):before('?')
    if isempty(id) then id = playerUrl:afterlast('/e/') end

    http.Headers['Referer'] = playerOrigin .. '/'
    http.Headers['Origin']  = playerOrigin

    -- ลองทีละโดเมนจนกว่าจะได้ hls · บางตัวตอบ 401 เพราะไม่ใช่ตัวที่รับคำขอของ player
    local answer = nil
    for _, apiBase in ipairs(candidates) do
        local try = http.GetJson(apiBase .. '/app/v1/play/' .. id .. '?embed=1')
        if try ~= nil and not isempty(try.hls) then
            answer = try
            break
        end
        log.Warn('โดเมน ' .. apiBase .. ' ไม่ให้ hls มา ลองตัวถัดไป')
    end

    if answer == nil then
        log.Warn('ลองครบ ' .. #candidates .. ' โดเมนแล้วยังไม่ได้ hls')
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
