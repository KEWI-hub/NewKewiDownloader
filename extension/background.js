// New Kewi Downloader — ตัวดักวิดีโอ · คิวงาน · บันทึกเหตุการณ์
//
// ส่วนขยายนี้ **เป็นตัวโปรแกรมทั้งหมด** ไม่มีโปรแกรมข้างนอกให้พึ่งแล้ว
// การโหลดเกิดในเบราว์เซอร์ล้วนๆ (ดูเหตุผลเต็มๆ ใน download/worker.js)
//
// service worker ของ MV3 ถูกปิดเองเมื่อไม่มีงาน ตัวแปรในหน่วยความจำจึงหายได้ตลอด
// ของที่ต้องอยู่ข้ามการปิด-เปิดจึงเก็บใน chrome.storage

const MEDIA_PATTERN = /\.(m3u8|mpd|mp4|webm|mkv|m4v)(\?|#|$)/i;
const OFFSCREEN = 'offscreen.html';

/** โหลดพร้อมกันได้กี่คลิป · แต่ละคลิปยังดึง segment ขนานหลายช่องของตัวเองอีกชั้น */
const MAX_RUNNING = 2;

// ---------- บันทึกเหตุการณ์ ----------
//
// เก็บใน storage.local เพราะต้องอยู่ข้ามการปิดเบราว์เซอร์ — เวลาผู้ใช้มาบอกว่า
// "โหลดไม่ได้" ต้องอ่านย้อนได้ว่าตอนนั้นเกิดอะไร ไม่ใช่ขอให้ทำซ้ำให้ดู
//
// **ไม่เคยบันทึก cookie หรือค่าที่ใช้ยืนยันตัวตนลงไป** · เก็บแค่ลิงก์ หัวคำขอที่ไม่เป็นความลับ
// ขั้นของงาน และข้อความผิดพลาด

const LOG_KEY = 'log';
const LOG_MAX = 2000;
const SECRET_HEADERS = ['cookie', 'authorization', 'set-cookie', 'x-csrf-token'];

async function note(level, text, jobId) {
  const bag = await chrome.storage.local.get(LOG_KEY);
  const rows = bag[LOG_KEY] || [];
  rows.push({ at: Date.now(), level, text, jobId: jobId || null });
  while (rows.length > LOG_MAX) rows.shift();
  await chrome.storage.local.set({ [LOG_KEY]: rows });
}

const info = (text, jobId) => note('info', text, jobId);
const warn = (text, jobId) => note('warn', text, jobId);
const fail = (text, jobId) => note('error', text, jobId);

/** หัวคำขอในรูปที่เอาลง log ได้ · ค่าที่เป็นความลับถูกตัดออก ไม่ใช่ปิดบางส่วน */
function safeHeaders(headers) {
  return Object.entries(headers || {})
    .filter(([k]) => !SECRET_HEADERS.includes(k.toLowerCase()))
    .map(([k, v]) => `${k}=${String(v).slice(0, 120)}`)
    .join(' · ') || '(ไม่มี)';
}

// ---------- หัวคำขอจริงที่หน้าเว็บส่ง ----------
//
// นี่คือจุดสำคัญที่สุดของการโหลดให้ผ่าน: เราไม่ **เดา** Referer เราแอบ **จด** ของจริง
// ตอนตัวเล่นของหน้าเว็บขอ playlist เอง แล้วเอาชุดเดิมไปสวมตอนเราดึง segment
//
// เก็บเป็นรายโดเมน เพราะ segment มักอยู่โดเมนเดียวกับ playlist และหัวที่ต้องใช้ก็ชุดเดียวกัน
// ไม่เก็บ cookie — เบราว์เซอร์แนบของมันเองให้อยู่แล้วตอนเราใช้ credentials: 'include'

const HEADERS_KEY = 'seen-headers';
const COPY_HEADERS = ['referer', 'origin', 'user-agent', 'x-requested-with'];

async function rememberHeaders(url, requestHeaders) {
  let host;
  try { host = new URL(url).host; } catch (e) { return; }

  const picked = {};
  for (const h of requestHeaders || []) {
    if (COPY_HEADERS.includes(h.name.toLowerCase()) && h.value) picked[h.name] = h.value;
  }
  if (Object.keys(picked).length === 0) return;

  const bag = await chrome.storage.session.get(HEADERS_KEY);
  const all = bag[HEADERS_KEY] || {};
  all[host] = picked;
  await chrome.storage.session.set({ [HEADERS_KEY]: all });
}

async function headersFor(hosts) {
  const bag = await chrome.storage.session.get(HEADERS_KEY);
  const all = bag[HEADERS_KEY] || {};
  for (const host of hosts) {
    if (all[host]) return all[host];
  }
  return {};
}

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0) return;              // คำขอของเราเอง ไม่ใช่ของหน้าเว็บ
    if (!MEDIA_PATTERN.test(details.url) && !/\.(ts|m4s)(\?|#|$)/i.test(details.url)) return;
    void rememberHeaders(details.url, details.requestHeaders);
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest', 'media', 'other'] },
  ['requestHeaders', 'extraHeaders']
);

// ---------- สวมหัวคำขอให้คำขอของเราเอง ----------
//
// `fetch` ใส่ Referer เองไม่ได้ เบราว์เซอร์ห้ามไว้ ต้องให้ declarativeNetRequest ใส่แทน
//
// กฎถูกล็อกด้วย `tabIds: [-1]` ซึ่งหมายถึง "คำขอที่ไม่ได้มาจากแท็บไหน" = คำขอของส่วนขยายเท่านั้น
// สำคัญมาก เพราะถ้าไม่ล็อก กฎจะไปทับหัวคำขอของหน้าเว็บที่ผู้ใช้กำลังดูด้วย แล้วหน้าเว็บจะพัง

let ruleSeq = 1;
const rulesOfJob = new Map();   // jobId -> [ruleId]
const hostsOfJob = new Map();   // jobId -> Set<host> ที่ออกกฎไปแล้ว

async function applyHeaderRules(jobId, hosts, headers) {
  const entries = Object.entries(headers);
  if (entries.length === 0 || hosts.length === 0) return;

  const id = 100000 + (ruleSeq++ * 10);
  const rule = {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: entries.map(([header, value]) => ({ operation: 'set', header, value })),
    },
    condition: {
      requestDomains: hosts,
      resourceTypes: ['xmlhttprequest'],
      tabIds: [-1],
    },
  };

  try {
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule] });
    rulesOfJob.set(jobId, [...(rulesOfJob.get(jobId) || []), id]);
    await info(`ออกกฎหัวคำขอให้ ${hosts.join(', ')} · ${safeHeaders(headers)}`, jobId);
  } catch (err) {
    await fail(`ออกกฎหัวคำขอไม่ได้: ${err.message}`, jobId);
  }
}

async function dropHeaderRules(jobId) {
  const ids = rulesOfJob.get(jobId);
  hostsOfJob.delete(jobId);
  if (!ids || ids.length === 0) return;
  rulesOfJob.delete(jobId);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
}

/**
 * ตัวโหลดเจอโดเมนใหม่ตอนอ่าน playlist — ขยายกฎให้ครอบก่อนมันจะเริ่มดึง segment
 *
 * จำเป็นเพราะ segment มักอยู่ CDN คนละโดเมนกับตัว playlist และ CDN พวกนั้น
 * ตรวจ Referer ด้วย ตอนสร้างงานเรายังไม่รู้ว่าโดเมนไหน เพราะยังไม่ได้อ่าน playlist
 */
async function widenRules(id, hosts) {
  const jobs = await allJobs();
  const job = jobs[id];
  if (!job) return;

  const already = hostsOfJob.get(id) || new Set();
  const fresh = hosts.filter((h) => h && !already.has(h));
  if (fresh.length === 0) return;

  for (const h of fresh) already.add(h);
  hostsOfJob.set(id, already);

  let jobHost = '';
  try { jobHost = new URL(job.url).host; } catch (e) { /* ไม่มีก็ไม่เป็นไร */ }

  const seen = await headersFor([jobHost, ...fresh]);
  if (Object.keys(seen).length > 0) await applyHeaderRules(id, fresh, seen);
}

// ---------- ที่เก็บของที่เจอ แยกตามแท็บ ----------

const keyFor = (tabId) => `tab:${tabId}`;

async function readTab(tabId) {
  const key = keyFor(tabId);
  const bag = await chrome.storage.session.get(key);
  return bag[key] || { pageUrl: '', items: [] };
}

async function writeTab(tabId, data) {
  await chrome.storage.session.set({ [keyFor(tabId)]: data });
}

/**
 * วิดีโอที่ดักได้เป็นโฆษณาไหม
 *
 * เว็บดูวิดีโอเล่นโฆษณาเป็นวิดีโอจริงๆ ก่อนคลิป แล้วโฆษณามักมาถึง **ก่อน** คลิปจริง
 * ถ้าไม่แยกออก ตัวเลือกอันดับแรกจะเป็นโฆษณาเสมอ — เคยเทสแล้วได้ไฟล์โฆษณา 0.8 MB
 * มาแทนคลิปที่ผู้ใช้อยากได้
 *
 * ไม่ทิ้งทีเดียว แค่ดันไปท้ายรายการ เพราะกฎแบบนี้มีวันจับผิดตัว
 */
const AD_HINTS = [
  '/creatives/', '/ads/', 'adtng.com', 'trafficjunky', 'exoclick', 'juicyads',
  'popads', 'adnxs.com', 'doubleclick.net', 'googlesyndication', 'adsco.re',
  'adserver', 'pubads', '/vast', 'imasdk.googleapis.com',
];

function looksLikeAd(url) {
  const lower = url.toLowerCase();
  return AD_HINTS.some((hint) => lower.includes(hint));
}

function kindOf(url) {
  if (/\.m3u8(\?|#|$)/i.test(url)) return 'hls';
  if (/\.mpd(\?|#|$)/i.test(url)) return 'dash';
  return 'file';
}

async function remember(tabId, url, kind) {
  if (tabId < 0) return;

  const data = await readTab(tabId);
  if (data.items.some((i) => i.url === url)) return;

  const ad = looksLikeAd(url);

  // เก็บไม่เกิน 40 รายการต่อแท็บ · เว็บสตรีมยิง segment เป็นร้อย ไม่ต้องเก็บหมด
  data.items.push({ url, kind, at: Date.now(), ad });
  if (data.items.length > 40) data.items.shift();

  await writeTab(tabId, data);
  updateBadge(tabId, data.items.filter((i) => !i.ad).length);

  // ลงบันทึกทุกตัวที่ดักได้ · เวลาเว็บไหนโหลดไม่ได้ นี่คือหลักฐานชิ้นแรกที่ต้องดู
  await info(`ดักเจอ ${kind}${ad ? ' [โฆษณา]' : ''} ${url}`);
}

function updateBadge(tabId, count) {
  chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#2997FF' });
}

// ---------- ดัก request ----------

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    if (!url.startsWith('http')) return;

    // ชิ้นส่วนของ playlist ไม่ต้องเก็บ เราสนใจตัว playlist กับไฟล์เต็มเท่านั้น
    if (/\.(ts|m4s|aac)(\?|#|$)/i.test(url)) return;
    if (!MEDIA_PATTERN.test(url)) return;

    void remember(details.tabId, url, kindOf(url));
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest', 'media', 'other', 'object', 'sub_frame'] }
);

// บางเว็บส่ง playlist มาโดย url ไม่มีนามสกุล — ดูจาก Content-Type แทน
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const header = (details.responseHeaders || [])
      .find((h) => h.name.toLowerCase() === 'content-type');
    const type = (header && header.value ? header.value : '').toLowerCase();

    if (type.includes('mpegurl')) void remember(details.tabId, details.url, 'hls');
    else if (type.includes('dash+xml')) void remember(details.tabId, details.url, 'dash');
    else if (type.startsWith('video/')) void remember(details.tabId, details.url, 'file');
  },
  { urls: ['http://*/*', 'https://*/*'] },
  ['responseHeaders']
);

/**
 * ไปหน้าอื่นแล้วล้างของเก่า ไม่งั้นจะโชว์วิดีโอของหน้าก่อนหน้า
 *
 * **แต่ต้องเป็นหน้าอื่นจริงๆ** · เว็บดูวิดีโอแก้ url ของตัวเองระหว่างเล่น (ใส่ตัวนับเวลา
 * ใส่พารามิเตอร์ติดตาม เปลี่ยน hash) ถ้าล้างทุกครั้งที่ url ขยับ ลิงก์ที่ดักได้จะหายเกลี้ยง
 * ตอนผู้ใช้กำลังดูอยู่ — เคยเจอว่าดักไม่ได้อะไรเลยทั้งที่วิดีโอเล่นอยู่
 *
 * ยึดที่ origin + path เท่านั้น ส่วน query กับ hash ไม่นับว่าเปลี่ยนหน้า
 */
const samePage = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch (e) {
    return a === b;
  }
};

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url) return;

  const current = await readTab(tabId);
  if (current.pageUrl && samePage(current.pageUrl, change.url)) {
    await writeTab(tabId, { ...current, pageUrl: change.url });
    return;
  }

  await writeTab(tabId, { pageUrl: change.url, items: [] });
  updateBadge(tabId, 0);
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(keyFor(tabId)));

// ---------- แตก master playlist เป็นรายการความชัด ----------

async function expandQualities(item) {
  if (item.kind !== 'hls') return [{ ...item, height: item.height || 0, label: 'auto' }];

  try {
    const res = await fetch(item.url, { credentials: 'include' });
    const body = await res.text();
    if (!body.includes('#EXT-X-STREAM-INF')) return [{ ...item, height: 0, label: 'auto' }];

    const lines = body.split('\n').map((l) => l.trim());
    const out = [];

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;

      const target = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
      if (!target) continue;

      const size = /RESOLUTION=(\d+)x(\d+)/i.exec(lines[i]);
      const codecs = /CODECS="([^"]*)"/i.exec(lines[i]);

      out.push({
        url: new URL(target, item.url).href,
        master: item.url,
        kind: 'hls',
        height: size ? parseInt(size[2], 10) : 0,
        codecs: codecs ? codecs[1] : '',
        ad: item.ad === true,
        label: size ? `${size[2]}p` : 'auto',
      });
    }

    if (out.length === 0) return [{ ...item, height: 0, label: 'auto' }];
    return out;
  } catch (e) {
    // อ่าน playlist ไม่ได้ (ลิงก์หมดอายุ) ก็ยังส่งตัว master ให้ตัวโหลดไปจัดการเองได้
    return [{ ...item, height: 0, label: 'auto' }];
  }
}

/** 1 = เอาไปทำ mp4 แล้วเล่นไม่ได้ (H.265 / AV1) เพราะเราไม่เข้ารหัสวิดีโอใหม่ */
function unplayable(codecs) {
  const lower = (codecs || '').toLowerCase();
  return (lower.includes('hvc1') || lower.includes('hev1') || lower.includes('av01')) ? 1 : 0;
}

/** ของจริงก่อนโฆษณา · เล่นได้ก่อนเล่นไม่ได้ · ชัดสุดก่อน — ตัวแรกคือตัวที่ควรโหลด */
const bestFirst = (a, b) =>
  ((a.ad === true) - (b.ad === true)) ||
  (unplayable(a.codecs) - unplayable(b.codecs)) ||
  ((b.height || 0) - (a.height || 0));

async function qualitiesFor(tabId) {
  const data = await readTab(tabId);
  // เอาตัวล่าสุดก่อน — คลิปที่ผู้ใช้กำลังดูมักเป็นอันหลังสุดที่โหลดมา
  const newest = data.items.slice().reverse().slice(0, 6);
  const groups = await Promise.all(newest.map(expandQualities));
  return { qualities: groups.flat().sort(bestFirst), pageUrl: data.pageUrl };
}

// ---------- ตั้งชื่อไฟล์ ----------

/**
 * ชื่อไฟล์ที่เซฟจริง — **ลงท้าย .mp4 เสมอ**
 *
 * ตรงกับสิ่งที่แผงโชว์ให้ผู้ใช้เห็น และตรงกับของที่ได้จริง เพราะทุกงานผ่าน ffmpeg
 * ออกมาเป็น mp4 ไม่ว่าต้นทางจะเป็น HLS หรือ webm
 */
function mp4NameFrom(title, pageUrl) {
  let base = (title || '').trim();

  // ชื่อหน้าเว็บมักมีชื่อเว็บต่อท้ายหลังขีด ตัดออกให้เหลือชื่อคลิป
  base = base.replace(/\s*[-|–—]\s*[^-|–—]{1,30}$/u, '');
  base = base.replace(/\s*\((?:\d{3,4}p|HD|FHD)\)\s*/gi, ' ');

  if (!base) {
    try { base = new URL(pageUrl).pathname.split('/').filter(Boolean).pop() || 'video'; }
    catch (e) { base = 'video'; }
  }

  return `${safeName(base) || 'video'}.mp4`;
}

/** ตัดตัวที่ Windows ห้ามในชื่อไฟล์ และ `/` ที่ chrome.downloads จะตีความเป็นโฟลเดอร์ */
function safeName(text) {
  return String(text)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .slice(0, 120)
    .trim();
}

// ---------- คิวงาน ----------

const JOBS_KEY = 'jobs';

async function allJobs() {
  const bag = await chrome.storage.session.get(JOBS_KEY);
  return bag[JOBS_KEY] || {};
}

async function patchJob(id, fields) {
  const jobs = await allJobs();
  jobs[id] = { ...(jobs[id] || { id }), ...fields };
  await chrome.storage.session.set({ [JOBS_KEY]: jobs });
  return jobs[id];
}

let offscreenReady = null;

async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;

  offscreenReady = (async () => {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
    });
    if (existing.length > 0) return;

    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN,
        reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
        justification: 'รัน ffmpeg (wasm) และทำ blob URL ของไฟล์ที่โหลดเสร็จ',
      });
    } catch (err) {
      // สร้างซ้อนกันสองที่พร้อมกันได้ ตัวที่สองจะโดนปฏิเสธ ซึ่งแปลว่ามีอยู่แล้ว = พอใช้
      if (!String(err.message || err).includes('Only a single offscreen document')) throw err;
    }
  })();

  try {
    await offscreenReady;
  } catch (err) {
    offscreenReady = null;
    throw err;
  }
  return offscreenReady;
}

/** เอางานเข้าคิว · ยังไม่เริ่มถ้ามีงานวิ่งครบจำนวนแล้ว */
async function enqueue(payload) {
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const folder = payload.folder ? safeName(payload.folder) : '';
  const filename = (folder ? `${folder}/` : '') + mp4NameFrom(payload.title, payload.pageUrl);

  await patchJob(id, {
    id, filename, title: payload.title || '', url: payload.url,
    audioUrl: payload.audioUrl || null,
    kind: payload.kind, height: payload.height || 0,
    pageUrl: payload.pageUrl || '', limitSegments: payload.limitSegments || 0,
    channels: payload.channels || 6,
    phase: 'queued', bytes: 0, segmentsDone: 0, segmentsTotal: 0,
    queuedAt: Date.now(), error: null,
  });

  await info(`เข้าคิว: ${filename} · ${payload.kind} ${payload.height || '?'}p · ${payload.url}`, id);
  await pump();
  return { ok: true, id, filename };
}

/** เริ่มงานที่รออยู่เท่าที่ยังมีช่องว่าง */
async function pump() {
  const jobs = await allJobs();
  const list = Object.values(jobs);

  const busy = list.filter((j) => ['starting', 'downloading', 'converting', 'remuxing', 'saving'].includes(j.phase));
  let room = MAX_RUNNING - busy.length;
  if (room <= 0) return;

  const waiting = list.filter((j) => j.phase === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);

  for (const job of waiting) {
    if (room-- <= 0) break;
    await launch(job);
  }
}

async function launch(job) {
  try {
    await patchJob(job.id, { phase: 'starting', startedAt: Date.now() });
    await ensureOffscreen();

    let host = '';
    try { host = new URL(job.url).host; } catch (e) { /* ลิงก์พิการ เดี๋ยวตัวโหลดจะบอกเอง */ }

    const pageHost = (() => {
      try { return new URL(job.pageUrl).host; } catch (e) { return ''; }
    })();

    // หัวคำขอ: เอาของจริงที่จดไว้ก่อน ไม่มีก็ใช้หน้าเว็บเป็น Referer ตามมาตรฐาน
    const seen = await headersFor([host, pageHost]);
    const headers = Object.keys(seen).length > 0
      ? seen
      : { Referer: job.pageUrl || job.url, Origin: pageHost ? `https://${pageHost}` : '' };
    for (const k of Object.keys(headers)) if (!headers[k]) delete headers[k];

    if (Object.keys(seen).length === 0) {
      await warn(`ไม่มีหัวคำขอจริงของ ${host || '?'} ที่จดไว้ — เดาจากหน้าเว็บแทน`, job.id);
    }

    if (host) {
      hostsOfJob.set(job.id, new Set([host]));
      await applyHeaderRules(job.id, [host], headers);
    }

    await chrome.runtime.sendMessage({
      type: 'offscreen-start',
      job: {
        id: job.id, filename: job.filename, url: job.url, audioUrl: job.audioUrl,
        kind: job.kind, height: job.height, headers,
        channels: job.channels, limitSegments: job.limitSegments,
      },
    });
  } catch (err) {
    await patchJob(job.id, { phase: 'failed', error: `เริ่มงานไม่ได้: ${err.message}` });
    await fail(`เริ่มงานไม่ได้: ${err.message}`, job.id);
  }
}

async function saveFinished(msg) {
  const jobs = await allJobs();
  const job = jobs[msg.id] || {};
  const filename = msg.filename || job.filename || 'video.mp4';

  try {
    const downloadId = await chrome.downloads.download({ url: msg.blobUrl, filename, saveAs: false });
    await patchJob(msg.id, { phase: 'saving', bytes: msg.size, downloadId });
    await info(`รวมเป็น mp4 เสร็จ ${(msg.size / 1048576).toFixed(2)} MB → ${filename}`, msg.id);
  } catch (err) {
    await patchJob(msg.id, { phase: 'failed', error: `เซฟไม่สำเร็จ: ${err.message}` });
    await fail(`เซฟไม่สำเร็จ: ${err.message}`, msg.id);
    await release(msg.id, false);
    await pump();
  }
}

async function release(id, discard) {
  await dropHeaderRules(id);
  await chrome.runtime.sendMessage({ type: 'offscreen-release', id, discard }).catch(() => {});
}

// ไฟล์ถูกเขียนลงเครื่องครบแล้วค่อยปล่อย blob กับลบของชั่วคราว
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state) return;

  const jobs = await allJobs();
  const entry = Object.values(jobs).find((j) => j.downloadId === delta.id);
  if (!entry) return;

  if (delta.state.current === 'complete') {
    const found = await chrome.downloads.search({ id: delta.id });
    await patchJob(entry.id, { phase: 'done', finishedAt: Date.now() });
    await info(`เซฟลงเครื่องแล้ว: ${found[0] ? found[0].filename : entry.filename}`, entry.id);
    await release(entry.id, true);
  } else if (delta.state.current === 'interrupted') {
    await patchJob(entry.id, { phase: 'failed', error: 'เบราว์เซอร์เซฟไฟล์ไม่สำเร็จ' });
    await fail('เบราว์เซอร์เซฟไฟล์ไม่สำเร็จ', entry.id);
    await release(entry.id, false);
  }
  await pump();
});

// ---------- โหลดทั้งหน้าลงโฟลเดอร์ ----------

/**
 * โหลดทุกคลิปที่ดักได้ในแท็บนี้ ลงโฟลเดอร์เดียว
 *
 * เอาความชัดสูงสุดของแต่ละคลิป ไม่ใช่ทุกความชัด ไม่งั้นจะได้คลิปเดียวกันหลายรอบ
 * โฟลเดอร์เป็นชื่อย่อยใต้โฟลเดอร์ดาวน์โหลดของเบราว์เซอร์ (chrome.downloads รับ `a/b.mp4`)
 */
async function downloadWholePage(tabId) {
  const data = await readTab(tabId);
  const real = data.items.filter((i) => !i.ad && i.kind !== 'dash');
  if (real.length === 0) return { ok: false, reason: 'ยังไม่เจอคลิปในหน้านี้ (ที่ไม่ใช่โฆษณา)' };

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const folder = mp4NameFrom(tab ? tab.title : '', data.pageUrl).replace(/\.mp4$/i, '');

  const groups = await Promise.all(real.map(expandQualities));
  let started = 0;

  for (const group of groups) {
    const pick = group.slice().sort(bestFirst)[0];
    if (!pick) continue;

    await enqueue({
      url: pick.url, audioUrl: pick.audioUrl || null, kind: pick.kind,
      height: pick.height || 0,
      title: `${tab ? tab.title : 'video'} ${pick.height ? `${pick.height}p` : ''} ${++started}`,
      pageUrl: data.pageUrl, folder,
    });
  }

  await info(`โหลดทั้งหน้า ${started} คลิป ลงโฟลเดอร์ ${folder}`);
  return { ok: true, count: started, folder };
}

// ---------- ดึงบันทึกออกเป็นไฟล์ ----------

/** บันทึกในรูปข้อความที่คนอ่านได้ · หัวไฟล์บอกสภาพแวดล้อมไว้ด้วย */
async function logAsText() {
  const bag = await chrome.storage.local.get(LOG_KEY);
  const rows = bag[LOG_KEY] || [];
  const jobs = Object.values(await allJobs());

  const head = [
    `New Kewi Downloader — บันทึกเหตุการณ์`,
    `ส่วนขยายรุ่น ${chrome.runtime.getManifest().version}`,
    `เบราว์เซอร์ ${navigator.userAgent}`,
    `ดึงออกเมื่อ ${new Date().toLocaleString('th-TH')}`,
    `จำนวนบรรทัด ${rows.length}`,
    '',
    '--- งานทั้งหมดในรอบนี้ ---',
    ...jobs.map((j) => `  ${j.phase.padEnd(12)} ${(j.bytes / 1048576).toFixed(2)} MB  ${j.filename}` +
      (j.error ? `\n      เหตุผล: ${j.error}` : '') +
      `\n      ลิงก์: ${j.url}`),
    '',
    '--- เรียงตามเวลา ---',
  ];

  const body = rows.map((r) => {
    const when = new Date(r.at).toLocaleTimeString('th-TH', { hour12: false });
    const mark = r.level === 'error' ? 'ผิดพลาด' : r.level === 'warn' ? 'เตือน  ' : '       ';
    return `${when} ${mark} ${r.jobId ? `[${r.jobId}] ` : ''}${r.text}`;
  });

  return [...head, ...body].join('\n');
}

/**
 * เซฟบันทึกเป็นไฟล์ในโฟลเดอร์ดาวน์โหลด
 *
 * ต้องผ่านหน้า offscreen เพราะ service worker ของ MV3 ไม่มี URL.createObjectURL
 * และ chrome.downloads ไม่รับ data: url
 */
async function saveLogFile(why) {
  const text = await logAsText();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `NewKewi-log/log-${stamp}.txt`;

  try {
    await ensureOffscreen();
    const answer = await chrome.runtime.sendMessage({ type: 'offscreen-save-text', text });
    if (!answer || !answer.blobUrl) return { ok: false, reason: 'ทำไฟล์ไม่สำเร็จ' };

    const downloadId = await chrome.downloads.download({ url: answer.blobUrl, filename, saveAs: false });
    await info(`เก็บบันทึกเป็นไฟล์แล้ว (${why}): ${filename}`);

    // ปล่อย blob หลังเบราว์เซอร์ดูดไฟล์ไปแล้ว
    setTimeout(() => {
      void chrome.runtime.sendMessage({ type: 'offscreen-release-text', id: answer.id }).catch(() => {});
    }, 8000);

    return { ok: true, filename, downloadId };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ---------- รับคำสั่ง ----------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const tabId = msg.tabId ?? sender.tab?.id ?? -1;

    switch (msg.type) {
      // ----- จากหน้า offscreen -----
      case 'job-state':
      case 'job-progress': {
        const jobs = await allJobs();
        const job = jobs[msg.id];
        if (!job) break;

        const next = { ...job };
        if (msg.phase) next.phase = msg.phase;
        if (msg.bytes) next.bytes = (job.bytes || 0) + msg.bytes;
        if (msg.segmentsDone) next.segmentsDone = msg.segmentsDone;
        if (msg.segmentsTotal) next.segmentsTotal = msg.segmentsTotal;
        if (msg.duration) next.duration = msg.duration;
        jobs[msg.id] = next;
        await chrome.storage.session.set({ [JOBS_KEY]: jobs });

        if (msg.phase && msg.phase !== job.phase) await info(`ขั้น: ${msg.phase}`, msg.id);
        break;
      }

      case 'job-log':
        await info(msg.text, msg.id);
        break;

      case 'job-hosts':
        await widenRules(msg.id, msg.hosts || []);
        await chrome.runtime.sendMessage({ type: 'offscreen-hosts-ready', id: msg.id }).catch(() => {});
        break;

      case 'job-done':
        await saveFinished(msg);
        break;

      case 'job-failed':
        await patchJob(msg.id, { phase: msg.cancelled ? 'cancelled' : 'failed', error: msg.error });
        await note(msg.cancelled ? 'info' : 'error', msg.error, msg.id);
        await release(msg.id, false);
        // เก็บบันทึกไว้เองทันทีที่พัง ผู้ใช้ไม่ต้องจำว่าต้องกดอะไร
        if (!msg.cancelled) await saveLogFile('งานล้มเหลว');
        await pump();
        break;

      // ----- จากแผงและเมนู -----
      case 'filename':
        reply({ filename: mp4NameFrom(msg.title, msg.pageUrl) });
        return;

      case 'qualities':
        reply(await qualitiesFor(tabId));
        return;

      case 'download':
        try {
          reply(await enqueue(msg.payload));
        } catch (err) {
          await fail(`เข้าคิวไม่ได้: ${err.message}`);
          reply({ ok: false, reason: err.message });
        }
        return;

      case 'download-page':
        reply(await downloadWholePage(tabId));
        return;

      case 'cancel':
        await chrome.runtime.sendMessage({ type: 'offscreen-cancel', id: msg.id }).catch(() => {});
        reply({ ok: true });
        return;

      case 'jobs':
        reply({
          jobs: Object.values(await allJobs())
            .sort((a, b) => (b.queuedAt || 0) - (a.queuedAt || 0)),
        });
        return;

      case 'log': {
        const bag = await chrome.storage.local.get(LOG_KEY);
        reply({ rows: bag[LOG_KEY] || [] });
        return;
      }

      case 'save-log':
        reply(await saveLogFile('ผู้ใช้กดเก็บ'));
        return;

      case 'clear-log':
        await chrome.storage.local.set({ [LOG_KEY]: [] });
        reply({ ok: true });
        return;

      default:
        reply({ ok: false, reason: 'ไม่รู้จักคำสั่งนี้' });
        return;
    }

    reply({ ok: true });
  })();

  return true;   // บอก Chrome ว่าจะตอบแบบ async
});

// เปิดเบราว์เซอร์มาแล้วมีงานค้างจากรอบก่อนก็ลุยต่อ
chrome.runtime.onStartup.addListener(() => { void pump(); });
chrome.runtime.onInstalled.addListener(async () => {
  await info(`ติดตั้ง/อัปเดตเป็นรุ่น ${chrome.runtime.getManifest().version}`);
});
