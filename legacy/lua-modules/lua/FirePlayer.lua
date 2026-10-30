-- เว็บตระกูล FirePlayer (av-th.io · player อยู่บน av-th.xyz)
--
-- **จุดตายที่เสียเวลาที่สุดของแอปรุ่นก่อน** — playlist กับไฟล์ย่อยต้องใช้ header คนละชุด:
--
--   ขั้น playlist   ต้องมี Origin + Sec-Fetch-*   ไม่มี → ได้ 'security error' กลับมา 14 ไบต์
--   ขั้นไฟล์ย่อย    **ห้ามมี**                     มี   → ได้ HTTP 500
--
-- yt-dlp ส่ง header ชุดเดียวทั้งงาน จึงไม่มีทางผ่านทั้งสองขั้นด้วยคำสั่งเดียว
-- module นี้แค่ประกาศ header ของทั้งสองขั้นแยกกัน แล้วแอปจะดึง playlist มาเขียนลงเครื่องให้เอง
-- (ดู LocalPlaylistWriter) — ไม่ต้องทำอะไรเพิ่มในนี้

function Register()
    module.Name     = 'FirePlayer'
    module.Version  = 1
    module.Adult    = true
    module.Priority = 0

    module.Domains:Add('av-th.io')
    module.Domains:Add('av-th.net')
    module.Domains:Add('av-th.xyz')
end

local function siteRoot(u)
    local root = u:regex('^(https?://[^/]+)', 1)
    if isempty(root) then return '' end
    return root
end

-- หาหน้า player · ผู้ใช้วางลิงก์ player มาตรงๆ ก็ใช้อันนั้น
local function playerPage()
    if url:contains('/video/') and url:contains('av-th.xyz') then
        return url
    end
    for _, src in ipairs(dom.SelectValues('//iframe/@src')) do
        if src:contains('/video/') then
            return UrlJoin(url, src)
        end
    end
    return ''
end

function GetInfo()
    info.Title = dom.SelectValue('//h1')
    if isempty(info.Title) then
        info.Title = dom.Title:before(' - ')
    end
end

function GetStreams()
    local embed = playerPage()
    if isempty(embed) then
        log.Warn('หน้าเว็บไม่มี iframe ของ player')
        return
    end

    http.Headers['Referer'] = url
    local raw = http.Get(embed)

    -- JS ถูกบีบด้วย packer ต้องแตกก่อนถึงจะเห็น FirePlayer(...) ข้างใน
    local text = UnpackJs(raw) .. '\n' .. raw

    -- เขียน regex ใน long string ของ Lua ([==[ ... ]==]) เพื่อไม่ต้องหนี backslash ซ้อนสองชั้น
    -- ซึ่งเป็นจุดที่พลาดง่ายที่สุดเวลาเขียน module
    local id = text:regex([==[FirePlayer\(\s*["']([0-9a-fA-F]{16,64})["']]==], 1)

    -- ck คือ base64 ที่ถูกซ่อนอีกชั้นเป็น hex escape (\x5a\x54...)
    local ck = text:regex([==[["']ck["']\s*:\s*["']((?:\\+x[0-9a-fA-F]{2})+)["']]==], 1)

    if isempty(id) or isempty(ck) then
        log.Warn('หา FirePlayer id หรือ ck ในหน้า player ไม่เจอ — เว็บอาจเปลี่ยนโครง')
        return
    end

    local hash = Base64.Decode(HexUnescape(ck))
    if isempty(hash) then
        log.Warn('ถอด ck ไม่ออก')
        return
    end

    local playerOrigin = siteRoot(embed)
    local parentRoot = siteRoot(url)
    if isempty(parentRoot) then parentRoot = playerOrigin end

    http.Reset()
    http.Headers['Referer'] = embed
    http.Headers['Origin'] = playerOrigin
    http.Headers['X-Requested-With'] = 'XMLHttpRequest'
    http.PostData['hash'] = hash
    http.PostData['r'] = ''

    local answer = json.Decode(http.Post(playerOrigin .. '/player/index.php?data=' .. id .. '&do=getVideo'))
    if answer == nil then
        log.Warn('API ของ player ไม่ตอบ หรือตอบมาไม่ใช่ JSON')
        return
    end

    -- **ใช้ videoSource เท่านั้น** · securedLink โดน 403 เสมอ (พิสูจน์มาแล้ว)
    local source = answer.videoSource
    if type(source) ~= 'string' or source == '' then
        log.Warn('ไม่มีช่อง videoSource ในคำตอบ')
        return
    end
    source = source:gsub('\\/', '/')

    streams.Add{
        url    = source,
        kind   = 'hls',
        height = 1080,

        -- header ของสองขั้น · แอปเห็นว่าไม่เหมือนกันแล้วจะจัดการให้เอง
        playlistHeaders = {
            Referer            = parentRoot .. '/',
            Origin             = parentRoot,
            Accept             = '*/*',
            ['Sec-Fetch-Dest'] = 'empty',
            ['Sec-Fetch-Mode'] = 'cors',
            ['Sec-Fetch-Site'] = 'cross-site',
        },
        segmentHeaders = {},   -- ว่าง = ตอนโหลดไฟล์ย่อยห้ามส่งอะไรเลย

        -- referer ต้องเป็น**หน้าเว็บแม่** ไม่ใช่หน้า player
        referer = parentRoot .. '/',
    }
end
