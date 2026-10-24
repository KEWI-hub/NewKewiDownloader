// ตัวดักวิดีโอและตัวส่งลิงก์เข้าแอป
//
// service worker ของ MV3 ถูกปิดเองเมื่อไม่มีงาน ตัวแปรในหน่วยความจำจึงหายได้ตลอด
// ของที่ต้องอยู่ข้ามการปิด-เปิดจึงเก็บใน chrome.storage.session (อยู่จนปิดเบราว์เซอร์)

const BRIDGE = 'http://127.0.0.1:47800';
const MEDIA_PATTERN = /\.(m3u8|mpd|mp4|webm|mkv|m4v)(\?|#|$)/i;

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

function kindOf(url) {
  if (/\.m3u8(\?|#|$)/i.test(url)) return 'hls';
  if (/\.mpd(\?|#|$)/i.test(url)) return 'dash';
  return 'file';
}

async function remember(tabId, url, kind) {
  if (tabId < 0) return;

  const data = await readTab(tabId);
  if (data.items.some((i) => i.url === url)) return;

  // เก็บไม่เกิน 40 รายการต่อแท็บ · เว็บสตรีมยิง segment เป็นร้อย ไม่ต้องเก็บหมด
  data.items.push({ url, kind, at: Date.now() });
  if (data.items.length > 40) data.items.shift();

  await writeTab(tabId, data);
  updateBadge(tabId, data.items.length);
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

    remember(details.tabId, url, kindOf(url));
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

    if (type.includes('mpegurl')) remember(details.tabId, details.url, 'hls');
    else if (type.includes('dash+xml')) remember(details.tabId, details.url, 'dash');
    else if (type.startsWith('video/')) remember(details.tabId, details.url, 'file');
  },
  { urls: ['http://*/*', 'https://*/*'] },
  ['responseHeaders']
);

// เปลี่ยนหน้าแล้วล้างของเก่า ไม่งั้นจะโชว์วิดีโอของหน้าก่อนหน้า
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  await writeTab(tabId, { pageUrl: info.url, items: [] });
  updateBadge(tabId, 0);
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(keyFor(tabId)));

// ---------- แตก master playlist เป็นรายการความชัด ----------

async function expandQualities(item) {
  if (item.kind !== 'hls') return [{ ...item, height: 0, label: 'auto' }];

  try {
    const res = await fetch(item.url, { credentials: 'include' });
    const body = await res.text();
    if (!body.includes('#EXT-X-STREAM-INF')) return [{ ...item, height: 0, label: 'auto' }];

    const lines = body.split('\n').map((l) => l.trim());
    const out = [];

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;

      let target = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j] || lines[j].startsWith('#')) continue;
        target = lines[j];
        break;
      }
      if (!target) continue;

      const res2 = /RESOLUTION=(\d+)x(\d+)/i.exec(lines[i]);
      const height = res2 ? parseInt(res2[2], 10) : 0;

      out.push({
        url: new URL(target, item.url).href,
        kind: 'hls',
        height,
        label: height ? `${height}p` : 'auto',
      });
    }

    if (out.length === 0) return [{ ...item, height: 0, label: 'auto' }];

    out.sort((a, b) => b.height - a.height);
    return out;
  } catch (e) {
    // อ่าน playlist ไม่ได้ (CORS/ลิงก์หมดอายุ) ก็ยังส่งตัว master ให้แอปไปจัดการเองได้
    return [{ ...item, height: 0, label: 'auto' }];
  }
}

// ---------- คุยกับแอป ----------

async function getToken() {
  const bag = await chrome.storage.local.get('token');
  return bag.token || '';
}

async function callApp(path, method, body) {
  const token = await getToken();
  const res = await fetch(BRIDGE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-NewKewi': '1',
      ...(token ? { 'X-NewKewi-Token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function appStatus() {
  try {
    const res = await callApp('/ping', 'GET');
    if (res.ok) return { state: 'ready', info: await res.json() };
    if (res.status === 401) return { state: 'needs-pairing' };
    return { state: 'refused' };
  } catch (e) {
    return { state: 'offline' };
  }
}

async function pair() {
  try {
    const res = await callApp('/pair', 'POST', { name: 'New Kewi Downloader (ส่วนขยายเบราว์เซอร์)' });
    if (!res.ok) return { ok: false, reason: await res.text() };

    const data = await res.json();
    await chrome.storage.local.set({ token: data.token });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'ติดต่อแอปไม่ได้ — เปิดโปรแกรมไว้หรือยัง' };
  }
}

async function sendToApp(payload) {
  try {
    const res = await callApp('/add', 'POST', payload);
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, reason: 'ยังไม่ได้จับคู่กับแอป' };
    return { ok: false, reason: await res.text() };
  } catch (e) {
    return { ok: false, reason: 'ติดต่อแอปไม่ได้ — เปิดโปรแกรมไว้หรือยัง' };
  }
}

// ---------- รับคำสั่งจาก content script และ popup ----------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const tabId = msg.tabId ?? sender.tab?.id ?? -1;

    switch (msg.type) {
      case 'status':
        reply(await appStatus());
        break;

      case 'pair':
        reply(await pair());
        break;

      case 'qualities': {
        const data = await readTab(tabId);
        // เอาตัวล่าสุดก่อน — คลิปที่ผู้ใช้กำลังดูมักเป็นอันหลังสุดที่โหลดมา
        const newest = data.items.slice().reverse();
        const groups = await Promise.all(newest.slice(0, 3).map(expandQualities));
        reply({ qualities: groups.flat(), pageUrl: data.pageUrl });
        break;
      }

      case 'send':
        reply(await sendToApp(msg.payload));
        break;

      default:
        reply({ ok: false, reason: 'ไม่รู้จักคำสั่งนี้' });
    }
  })();

  return true;   // บอก Chrome ว่าจะตอบแบบ async
});
