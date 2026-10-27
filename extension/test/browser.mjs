// เปิด Chromium พกพาพร้อมส่วนขยายของเรา เปิดหน้าเทส แล้วอ่านผลกลับมาทางสายดีบั๊ก
//
// ทำไมต้องวิ่งผ่านเบราว์เซอร์จริง: ชั้นที่จะเทส (OPFS, createSyncAccessHandle,
// fetch ข้ามโดเมนแบบมี cookie, ffmpeg wasm, declarativeNetRequest) ไม่มีอยู่นอกเบราว์เซอร์
// จะ mock ก็ไม่เหลืออะไรให้เทส

import { spawn } from 'node:child_process';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const extensionDir = path.resolve(here, '..');
export const repoRoot = path.resolve(extensionDir, '..');

const chromeExe = path.join(repoRoot, '_chromium', 'chrome-win64', 'chrome.exe');

/**
 * รันหน้าเทสหนึ่งหน้าจนมันตั้งค่าตัวแปรรายงานผล
 *
 * @param {{page:string, sentinel:string, port?:number, timeoutMs?:number, show?:boolean}} opts
 * @returns {Promise<{value:any, noise:string[]}>}
 */
export async function runExtensionPage(opts) {
  const port = opts.port || 9333;
  // เทสตัวที่ build แล้วได้ด้วย ไม่ใช่เฉพาะโค้ดต้นฉบับ
  const loadDir = opts.extensionDir || extensionDir;
  const timeoutMs = opts.timeoutMs || 120000;

  if (!existsSync(chromeExe)) {
    throw new Error(`ไม่เจอ Chromium พกพาที่ ${chromeExe} — เปิดแอปหนึ่งครั้งให้มันโหลดมาก่อน`);
  }

  // profile ของเทสใช้ที่เดิมซ้ำ แต่ล้างแคชสคริปต์ service worker ทุกรอบ
  //
  // **สองกับดักที่ขัดกันเอง เสียเวลาไปหลายรอบ:**
  //
  // 1. Chromium เก็บสคริปต์ service worker ของส่วนขยายไว้ใน profile · ใช้ profile เดิม
  //    ซ้ำแล้วเทสจะวิ่งกับ **background.js รุ่นเก่า** ทั้งที่
  //    `chrome.runtime.getManifest().version` อ่านได้เป็นรุ่นใหม่ (manifest อ่านสดจากดิสก์
  //    แต่สคริปต์มาจากแคช) อาการคือแก้โค้ดแล้วไม่มีผล และไม่มีอะไรบอกว่าทำไม
  //
  // 2. แต่ profile ที่เพิ่งสร้างใหม่ **เปิดหน้าของส่วนขยายไม่ได้เลย** ได้ `chrome-error://`
  //    กลับมา ซึ่งหน้าตาเหมือนหน้าว่าง · อุ่นเครื่องก่อนแล้วก็ไม่หาย
  //
  // ทางออกคือเก็บ profile ไว้ (แก้ข้อ 2) แล้วลบแค่โฟลเดอร์แคชของ service worker (แก้ข้อ 1)
  //
  // อยู่ใต้ _tmp/ ซึ่ง .gitignore ครอบอยู่ — ข้างในมี Cookies/History ของเบราว์เซอร์เทส
  const profile = path.join(repoRoot, '_tmp', 'selftest-profile');

  // `child.kill()` ฆ่าแค่ตัวสั่งเปิด ไม่ได้ฆ่าตัวเบราว์เซอร์ · ตัวที่ค้างอยู่จะล็อกไฟล์
  // ใน profile ไว้ลบไม่ได้ ต้องสั่งปิดให้เรียบร้อยก่อน
  await closeStaleBrowser(port);
  await mkdir(profile, { recursive: true });
  await rm(path.join(profile, 'Default', 'Service Worker'), { recursive: true, force: true })
    .catch(() => {});

  const launch = () => spawn(chromeExe, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    `--load-extension=${loadDir}`,
    `--disable-extensions-except=${loadDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=DialMediaRouteProvider,Translate',
    'about:blank',
  ], { stdio: 'ignore' });

  const cdp = makeClient(port);
  const child = launch();
  try {
    const id = await cdp.findExtensionId(loadDir);
    // โหมดตรวจแค่ว่าติดตั้งขึ้นและ service worker เริ่มทำงาน · ใช้กับตัวที่ build แล้ว
    // ซึ่งไม่มีหน้าเทสติดไปด้วย
    if (opts.bootOnly) {
      await new Promise((r) => setTimeout(r, 3000));
      return { value: { pass: true, id, lines: [`service worker ของ ${id} เริ่มทำงานแล้ว`] }, noise: [] };
    }
    console.log(`ส่วนขยายโหลดขึ้นแล้ว: ${id}`);
    return await cdp.openUntilReady(`chrome-extension://${id}/${opts.page}`, opts.sentinel, timeoutMs);
  } finally {
    await cdp.closeBrowser();
    child.kill();
    await new Promise((r) => setTimeout(r, 1200));
  }
}

/**
 * กดเล่นวิดีโอในแท็บของเว็บที่กำลังเทส
 *
 * จำเป็นเพราะเว็บดูวิดีโอส่วนใหญ่ไม่ยิงขอ playlist จนกว่าจะมีคนกดเล่น ตัวดักจึงเจอ
 * แต่โฆษณาซึ่งเล่นเองได้ · คลิกผ่านสายดีบั๊กนับเป็น **การกดของคนจริง** ในสายตาเบราว์เซอร์
 * ต่างจากการเรียก video.play() ใน JS ที่ถูกปฏิเสธเมื่อมีเสียง
 *
 * คืนข้อความบอกว่าทำอะไรได้ ไว้พิมพ์ให้คนอ่านเวลาเทสไม่ผ่าน
 */
export async function clickPlayInTab(port, siteUrl, { clickOnce = true } = {}) {
  let host;
  try { host = new URL(siteUrl).hostname; } catch (e) { return 'ลิงก์เว็บไม่ถูกต้อง'; }

  let target;
  try {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    // ต้องกันหน้าของส่วนขยายออกไป — ลิงก์เว็บที่จะลองอยู่ใน hash ของหน้าเทสเอง
    // จึง "มีชื่อโดเมนนั้น" อยู่ใน url ด้วย แล้วเราจะไปคลิกผิดหน้า
    target = list.find((t) => t.type === 'page'
      && !(t.url || '').startsWith('chrome-extension://')
      && (t.url || '').includes(host));
  } catch (e) {
    return 'ถามรายการแท็บไม่ได้';
  }
  if (!target) return 'ไม่เจอแท็บของเว็บนั้น';

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('ต่อแท็บของเว็บไม่ได้'));
  }).catch(() => {});

  let seq = 0;
  const waiting = new Map();
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const slot = waiting.get(msg.id);
    if (slot) { waiting.delete(msg.id); slot(msg); }
  };
  const send = (method, params) => new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (waiting.delete(id)) resolve({}); }, 5000);
  });

  try {
    // หาจุดกลางของตัวเล่นที่ใหญ่สุดในหน้า
    const where = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const players = [...document.querySelectorAll('video')]
          .map(v => v.getBoundingClientRect())
          .filter(r => r.width > 200 && r.height > 120)
          .sort((a, b) => b.width * b.height - a.width * a.height);
        if (players.length === 0) return null;
        const r = players[0];
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`,
    });

    const spot = where.result?.result?.value;
    if (!spot) return 'ยังไม่มี <video> ในหน้า';

    // กดซ้ำๆ ที่กลางตัวเล่นคือการ **สลับเล่น/หยุด** · กดหลายรอบแล้วมีโอกาสครึ่งหนึ่ง
    // ที่จะจบลงด้วยวิดีโอหยุดอยู่ ซึ่งทำให้ตัวดักไม่เจออะไรเลย
    // รอบแรกกดจริงเพื่อให้นับเป็นการกดของคน รอบต่อไปแค่สั่งเล่นต่อถ้ามันหยุดอยู่
    if (!clickOnce) {
      const state = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const v = [...document.querySelectorAll('video')]
            .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
          if (!v) return 'ไม่มีตัวเล่น';
          if (v.paused) { v.play().catch(() => {}); return 'หยุดอยู่ — สั่งเล่นต่อ'; }
          return 'กำลังเล่น ' + v.currentTime.toFixed(1) + ' วินาที';
        })()`,
      });
      return state.result?.result?.value || 'ถามสถานะไม่ได้';
    }

    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type, x: spot.x, y: spot.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    return `กดเล่นที่ (${spot.x}, ${spot.y}) แล้ว`;
  } finally {
    try { socket.close(); } catch (e) { /* ปิดไปแล้ว */ }
  }
}

/**
 * id ของส่วนขยายเรา คำนวณจาก `key` ใน manifest
 *
 * Chromium คิด id จาก 128 บิตแรกของ SHA-256 ของกุญแจสาธารณะ แล้วแปลงเลขฐานสิบหก
 * แต่ละหลักเป็นตัวอักษร a–p · เพราะ manifest มี key ฝังไว้ id จึงคงที่ทุกเครื่องทุกรอบ
 */
export async function ourExtensionId(dir = extensionDir) {
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (!manifest.key) throw new Error('manifest ไม่มี key — id ของส่วนขยายจะไม่คงที่');

  const der = Buffer.from(manifest.key, 'base64');
  const digest = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...digest].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/** สั่งเบราว์เซอร์ที่ยังตอบอยู่บนพอร์ตนี้ให้ปิดตัวเอง · ไม่มีใครตอบก็ถือว่าเรียบร้อย */
async function closeStaleBrowser(port) {
  let version;
  try {
    version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  } catch (e) {
    return;
  }
  if (!version.webSocketDebuggerUrl) return;

  console.log('มีเบราว์เซอร์เทสค้างอยู่ — สั่งปิดก่อน');
  await closeVia(version.webSocketDebuggerUrl);
  await new Promise((r) => setTimeout(r, 1500));
}

async function closeVia(webSocketDebuggerUrl) {
  await new Promise((resolve) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const finish = () => { try { socket.close(); } catch (e) { /* ปิดไปแล้ว */ } resolve(); };
    socket.onopen = () => {
      socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      setTimeout(finish, 800);
    };
    socket.onerror = finish;
    setTimeout(finish, 3000);
  });
}

function makeClient(port) {
  // Chromium รุ่นใหม่รับเฉพาะ PUT กับปลายทางที่ *สร้าง* หรือ *ปิด* อะไร
  // ถ้ายิง GET จะได้ 405 กลับมาเฉยๆ
  const http = async (pathname, method = 'GET') => {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
    if (!res.ok) throw new Error(`CDP ตอบ ${res.status} ที่ ${pathname}`);
    return res.json();
  };

  /**
   * รอให้ service worker ของส่วนขยาย **ตัวเรา** ขึ้นมา
   *
   * ไม่เดา id จากรายการเป้าหมายอีกแล้ว — Chromium มีส่วนขยายในตัวหลายตัวที่มี
   * `background.js` เหมือนกัน และคนละรอบได้คนละตัว ทำให้เปิดหน้าของ "ส่วนขยาย"
   * ที่ไม่ใช่ของเรา แล้วได้หน้าว่างเงียบๆ โดยไม่มี error ให้เห็น
   *
   * id ของเราคงที่เพราะ manifest มี `key` ฝังไว้ · คำนวณจาก key ตัวนั้นตรงๆ
   */
  async function findExtensionId(dir) {
    const id = await ourExtensionId(dir);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const list = await http('/json/list');
        if (list.some((t) => (t.url || '').startsWith(`chrome-extension://${id}/`))) return id;
      } catch (e) { /* เบราว์เซอร์ยังไม่เปิดพอร์ต ลองใหม่ */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`ส่วนขยาย ${id} ไม่โหลดขึ้น — ดู chrome://extensions`);
  }

  /**
   * เปิดหน้าใหม่ซ้ำจนกว่าจะเปิดได้จริง
   *
   * ต้องเปิดเป็น **แท็บใหม่** ทุกครั้ง ไม่ใช่สั่งแท็บเดิมให้ไปเอง — Chromium บล็อก
   * การพาตัวเองไปหน้าของส่วนขยายที่ไม่ได้ประกาศเป็น web_accessible_resources
   * แล้วจะได้ `chrome-error://` ซึ่งหน้าตาเหมือนหน้าว่างเฉยๆ ไม่มี error บอก
   */
  async function openUntilReady(url, sentinel, timeoutMs) {
    let last;
    for (let attempt = 1; attempt <= 12; attempt++) {
      try {
        return await runPage(url, sentinel, timeoutMs);
      } catch (err) {
        last = err;
        if (!String(err.message).includes('เปิดหน้าไม่ขึ้น')) throw err;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw last;
  }

  async function runPage(url, sentinel, timeoutMs) {
    const target = await http(`/json/new?${encodeURIComponent(url)}`, 'PUT');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error('ต่อ WebSocket ของหน้าไม่ได้'));
    });

    let seq = 0;
    let dead = null;
    const waiting = new Map();

    // สายขาดแล้วต้องรู้ทันที · ไม่งั้น promise ที่รออยู่ค้างเงียบ แล้ว node ออกไปเฉยๆ
    // พร้อมข้อความ "unsettled top-level await" ซึ่งไม่บอกอะไรเลยว่าอะไรตาย
    socket.onclose = () => {
      dead = new Error('สายดีบั๊กขาด — เบราว์เซอร์หรือแท็บเทสน่าจะตายไปแล้ว');
      for (const slot of waiting.values()) slot({ __dead: true });
      waiting.clear();
    };
    // เก็บเสียงจากหน้าไว้ด้วย · เวลาเทสค้าง สาเหตุมักเป็น error ที่หลุดก่อนถึงบรรทัดรายงานผล
    const noise = [];

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        noise.push(`[exception] ${d.exception?.description || d.text}`);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        noise.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
        return;
      }
      if (msg.method === 'Log.entryAdded') {
        noise.push(`[${msg.params.entry.level}] ${msg.params.entry.text}`);
        return;
      }
      if (msg.method === 'Page.frameNavigated') {
        noise.push(`[nav] ${msg.params.frame.url} err=${msg.params.frame.unreachableUrl || '-'}`);
        return;
      }
      if (msg.method) return;

      const slot = waiting.get(msg.id);
      if (!slot) return;
      waiting.delete(msg.id);
      slot(msg);
    };

    const send = (method, params) => new Promise((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

    const evaluate = async (expression) => {
      if (dead) throw dead;
      const answer = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (answer.__dead) throw dead;
      return answer.result?.result?.value;
    };

    await send('Runtime.enable', {});
    await send('Log.enable', {});
    await send('Page.enable', {});

    // หน้าขึ้นจริงหรือเป็นหน้า error ตรวจจากของที่อยู่ใน HTML แบบคงที่
    await new Promise((r) => setTimeout(r, 1200));
    if (await evaluate('!!document.getElementById("out")') !== true) {
      socket.close();
      await http(`/json/close/${target.id}`, 'PUT').catch(() => {});
      throw new Error('เปิดหน้าไม่ขึ้น (ส่วนขยายน่าจะยังติดตั้งไม่เสร็จ)');
    }
    console.log(`เปิดหน้า: ${url}`);

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const text = await evaluate(`window.${sentinel} ? JSON.stringify(window.${sentinel}) : ""`);
      if (text) {
        socket.close();
        await http(`/json/close/${target.id}`, 'PUT').catch(() => {});
        return { value: JSON.parse(text), noise };
      }

      if (Date.now() > deadline) {
        const shown = await evaluate('document.getElementById("out").textContent');
        socket.close();
        throw new Error([
          `หน้าเทสไม่รายงานผลภายใน ${Math.round(timeoutMs / 1000)} วินาที`,
          `หน้าจอค้างที่: ${shown || '(ว่าง)'}`,
          ...noise.slice(-25),
        ].join('\n'));
      }
      await new Promise((r) => setTimeout(r, 900));
    }
  }

  /** ปิดตัวเบราว์เซอร์จริงๆ — ไม่ใช่แค่ฆ่าตัวสั่งเปิด (ดูหมายเหตุที่ closeStaleBrowser) */
  async function closeBrowser() {
    try {
      const version = await http('/json/version');
      if (version.webSocketDebuggerUrl) await closeVia(version.webSocketDebuggerUrl);
    } catch (e) { /* ปิดไปแล้วหรือไม่ตอบ ก็ปล่อยให้ kill จัดการ */ }
  }

  return { findExtensionId, openUntilReady, closeBrowser };
}
