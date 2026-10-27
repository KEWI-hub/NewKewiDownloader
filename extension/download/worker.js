// ตัวโหลดวิดีโอที่ทำงานในเบราว์เซอร์
//
// **ทำไมต้องโหลดในเบราว์เซอร์** คำขอที่ออกจากที่นี่คือคำขอของ Chromium จริง — ได้ cookie
// ของเว็บนั้น ได้ลายนิ้วมือ TLS ของ Chrome ครบ เว็บที่กันบอทอย่าง Cloudflare จึงมองว่าเป็น
// คนดูธรรมดา ต่างจากตอนที่ exe ยิง HttpClient เองแล้วโดน 403 ทั้งที่เบราว์เซอร์เปิดหน้าได้ปกติ
//
// ทำงานสองขั้นแยกกัน ไม่ใช่ขั้นเดียวแบบ Video DownloadHelper:
//
//   ขั้น 1  อ่าน m3u8 เอง แล้วดึง segment **ขนานหลายช่อง** ลงไฟล์เดียวใน OPFS
//   ขั้น 2  ให้ ffmpeg (wasm) รวมไฟล์นั้นเป็น mp4 ด้วย `-c copy`
//
// ที่แยกสองขั้นเพราะขั้น 1 คือที่เดียวที่ทำ **โหลดหลายช่อง** กับ **ทำต่อจากที่ค้าง** ได้
// ถ้าปล่อยให้ ffmpeg ดึง m3u8 เองอย่าง VDH จะได้ทีละชิ้นเรียงตามลำดับ และเริ่มใหม่หมดทุกครั้ง
//
// ไม่มี retry — ตามกฎของโปรเจกต์ ชิ้นไหนพังคืองานล้ม พร้อมบอกว่าพังที่ชิ้นไหน

import { isMaster, parseMaster, parseMedia, decryptSegment } from './hls.js';
import LibAVFactory from '../vendor/libav/libav-remux-cli.mjs';

const PART_VIDEO = 'video.part';
const PART_VIDEO_MP4 = 'video.mp4part';
const PART_AUDIO_MP4 = 'audio.mp4part';
const PART_AUDIO = 'audio.part';
const STATE_FILE = 'state.json';
const OUTPUT_FILE = 'out.mp4';

/** งานที่กำลังทำ · ยกเลิกได้ตัวต่อตัว */
const running = new Map();   // id -> AbortController

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'start') void runJob(msg.job);
  else if (msg.type === 'cancel') cancel(msg.id);
  else if (msg.type === 'discard') void discard(msg.id);
  else if (msg.type === 'hosts-ready') {
    const go = hostsAck.get(msg.id);
    if (go) { hostsAck.delete(msg.id); go(); }
  }
};

/** งานที่กำลังรอให้ฝ่ายโน้นออกกฎหัวคำขอให้เสร็จก่อน */
const hostsAck = new Map();   // id -> resolve

/**
 * บอกโดเมนที่กำลังจะดึงให้ฝ่ายจัดการงานไปออกกฎใส่หัวคำขอ แล้วรอจนมันบอกว่าพร้อม
 *
 * ต้อง **รอ** จริงๆ ไม่ใช่ยิงแล้วไปต่อ — กฎยังไม่ติดตอนคำขอแรกออกไป แปลว่าชิ้นแรก
 * ไม่มี Referer แล้วโดนปฏิเสธ ซึ่งคือทั้งงานล้มเพราะเราไม่มี retry
 */
async function announceHosts(id, urls) {
  const hosts = [...new Set(urls.map((u) => {
    try { return new URL(u).host; } catch (e) { return ''; }
  }).filter(Boolean))];
  if (hosts.length === 0) return;

  await new Promise((resolve) => {
    hostsAck.set(id, resolve);
    post({ type: 'hosts', id, hosts });
    // ไม่ตอบกลับมาก็ไปต่อ ดีกว่าค้างอยู่เงียบๆ จนผู้ใช้ไม่รู้ว่าเกิดอะไร
    setTimeout(() => { if (hostsAck.delete(id)) resolve(); }, 5000);
  });
}

function cancel(id) {
  const stop = running.get(id);
  if (stop) stop.abort(new Error('ผู้ใช้สั่งหยุด'));
}

const post = (m) => self.postMessage(m);
const log = (id, text) => post({ type: 'log', id, text, at: Date.now() });

// ---------- ที่พักไฟล์ ----------

async function jobDir(id, create = true) {
  const root = await navigator.storage.getDirectory();
  const jobs = await root.getDirectoryHandle('jobs', { create });
  return jobs.getDirectoryHandle(id, { create });
}

async function readState(dir) {
  try {
    const handle = await dir.getFileHandle(STATE_FILE);
    return JSON.parse(await (await handle.getFile()).text());
  } catch (e) {
    return null;   // ยังไม่เคยทำงานนี้ หรือสถานะเสีย — เริ่มใหม่ทั้งคู่ปลอดภัยกว่าเดา
  }
}

async function writeState(dir, state) {
  const handle = await dir.getFileHandle(STATE_FILE, { create: true });
  const w = await handle.createWritable();
  await w.write(JSON.stringify(state));
  await w.close();
}

async function discard(id) {
  try {
    const root = await navigator.storage.getDirectory();
    const jobs = await root.getDirectoryHandle('jobs');
    await jobs.removeEntry(id, { recursive: true });
  } catch (e) { /* ไม่มีอยู่แล้วก็ถือว่าเรียบร้อย */ }
}

// ---------- ขั้น 1 · ดึง segment ----------

async function fetchBytes(url, headers, byteRange, signal) {
  const extra = { ...headers };
  if (byteRange) extra.Range = `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}`;

  const res = await fetch(url, {
    headers: extra,
    credentials: 'include',   // ← เหตุผลทั้งหมดที่ย้ายมาโหลดในเบราว์เซอร์
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} จาก ${shortUrl(url)}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchText(url, headers, signal) {
  const res = await fetch(url, { headers, credentials: 'include', signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} จาก ${shortUrl(url)}`);
  return res.text();
}

const shortUrl = (url) => {
  try { return new URL(url).pathname.split('/').pop() || url; } catch (e) { return url.slice(0, 60); }
};

/**
 * ดึง segment ทั้งชุดลงไฟล์เดียว
 *
 * ขนานได้ตามจำนวนช่องที่ตั้งไว้ แต่ **เขียนลงไฟล์เรียงตามลำดับเสมอ** — ชิ้นที่มาถึงก่อนคิว
 * ถูกพักไว้ในหน่วยความจำจนถึงคิวของมัน ทำให้หน่วยความจำที่ใช้ไม่เกินจำนวนช่อง
 * และไฟล์ที่ได้มีขนาดที่เชื่อถือได้ จึงกลับมาทำต่อจากที่ค้างได้
 */
async function fetchSegments(ctx, playlist, partName, stateKey) {
  const { id, headers, signal, dir, channels } = ctx;

  const handle = await dir.getFileHandle(partName, { create: true });
  const file = await handle.createSyncAccessHandle();

  try {
    const state = ctx.state[stateKey] || { committed: 0, bytes: 0, sizes: [] };
    if (!state.sizes) state.sizes = [];
    // ตัดท้ายไฟล์ให้ตรงกับที่บันทึกไว้ — ถ้ารอบก่อนถูกฆ่ากลางคัน ไฟล์อาจมีเศษชิ้นที่ยังไม่นับ
    file.truncate(state.bytes);
    let writeAt = state.bytes;
    let committed = state.committed;
    // ความยาวของแต่ละชิ้นตามลำดับที่เขียนลงไฟล์ · ขั้นแปลง MPEG-TS ต้องรู้รอยต่อ
    // เพราะต้องสั่ง flush ที่ขอบ segment ไม่ใช่กลาง PES packet
    const sizes = state.sizes.slice(0, committed);

    if (committed > 0) log(id, `ทำต่อจากชิ้นที่ ${committed} (${(state.bytes / 1048576).toFixed(1)} MB)`);

    // init segment ของ fragmented mp4 ต้องอยู่หัวไฟล์ และมีได้ครั้งเดียว
    if (playlist.initUrl && committed === 0) {
      const init = await fetchBytes(playlist.initUrl, headers, playlist.initByteRange, signal);
      file.write(init, { at: writeAt });
      writeAt += init.length;
      post({ type: 'progress', id, bytes: init.length });
    }

    const keyCache = new Map();
    const pending = new Map();        // index -> Uint8Array ที่มาถึงก่อนคิว
    const inFlight = new Map();       // index -> Promise
    let next = committed;             // ชิ้นถัดไปที่จะ *เขียน*
    let dispatch = committed;         // ชิ้นถัดไปที่จะ *ขอ*

    // ชิ้นที่พังต้องกลายเป็น *ค่าที่คืนมา* ไม่ใช่ promise ที่ปฏิเสธ — ไม่งั้นชิ้นอื่นที่ยังบินอยู่
    // จะกลายเป็น unhandled rejection ตอนเราโยน error ออกไป ซึ่งทำให้ worker ตายแบบไม่มีสาเหตุบอก
    const want = (index) => {
      const seg = playlist.segments[index];
      inFlight.set(index, (async () => {
        try {
          let bytes = await fetchBytes(seg.url, headers, seg.byteRange, signal);
          if (seg.key) bytes = await unlock(seg, bytes, keyCache, headers, signal);
          return { index, bytes };
        } catch (error) {
          return { index, error };
        }
      })());
    };

    while (next < playlist.segments.length) {
      signal.throwIfAborted();

      while (dispatch < playlist.segments.length && inFlight.size < channels) want(dispatch++);

      // รอชิ้นไหนก็ได้ที่เสร็จ แล้วค่อยระบายเท่าที่เรียงต่อกันได้
      const done = await Promise.race(inFlight.values());

      inFlight.delete(done.index);
      if (done.error) throw new Error(`ชิ้นที่ ${done.index + 1}/${playlist.segments.length}: ${done.error.message}`);
      pending.set(done.index, done.bytes);

      while (pending.has(next)) {
        const bytes = pending.get(next);
        pending.delete(next);
        file.write(bytes, { at: writeAt });
        writeAt += bytes.length;
        sizes[next] = bytes.length;
        next++;

        post({
          type: 'progress', id, bytes: bytes.length,
          segmentsDone: next, segmentsTotal: playlist.segments.length,
        });
      }

      // บันทึกจุดที่ทำได้แล้วเป็นระยะ ไม่ใช่ทุกชิ้น — เขียน state ถี่ๆ ช้ากว่าตัวงานเอง
      if (next - committed >= 20) {
        file.flush();
        committed = next;
        ctx.state[stateKey] = { committed, bytes: writeAt, sizes };
        await writeState(dir, ctx.state);
      }
    }

    file.flush();
    ctx.state[stateKey] = { committed: next, bytes: writeAt, sizes };
    await writeState(dir, ctx.state);
    return writeAt;
  } finally {
    file.close();   // ต้องปล่อยก่อน ไม่งั้น ffmpeg เปิดไฟล์เดียวกันไม่ได้
  }
}

/** ถอดรหัสชิ้นที่ล็อกไว้ · กุญแจเก็บแคชเพราะทั้ง playlist มักใช้ตัวเดียว */
async function unlock(seg, bytes, keyCache, headers, signal) {
  if (seg.key.method !== 'AES-128') {
    throw new Error(`playlist ล็อกด้วย ${seg.key.method} ซึ่งโปรแกรมถอดไม่ได้`);
  }
  if (!keyCache.has(seg.key.url)) {
    keyCache.set(seg.key.url, await fetchBytes(seg.key.url, headers, null, signal));
  }
  return decryptSegment(bytes, keyCache.get(seg.key.url), seg.key.ivHex, seg.key.seq);
}

/** ไฟล์เดียวจบ (mp4/webm ตรงๆ) — ดึงทีเดียว ไม่ต้องแบ่งชิ้น */
async function fetchWholeFile(ctx, url) {
  const { id, headers, signal, dir } = ctx;

  const handle = await dir.getFileHandle(PART_VIDEO, { create: true });
  const file = await handle.createSyncAccessHandle();
  try {
    const start = ctx.state.video ? ctx.state.video.bytes : 0;
    file.truncate(start);

    const extra = { ...headers };
    if (start > 0) {
      extra.Range = `bytes=${start}-`;
      log(id, `ขอต่อจากไบต์ที่ ${start}`);
    }

    const res = await fetch(url, { headers: extra, credentials: 'include', signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // เซิร์ฟเวอร์ไม่ยอมต่อให้ (ตอบ 200 ทั้งที่ขอ Range) = ต้องเริ่มใหม่ ไม่ใช่เขียนทับกลางไฟล์
    let at = start > 0 && res.status === 206 ? start : 0;
    if (at === 0 && start > 0) {
      log(id, 'เซิร์ฟเวอร์ไม่รับการโหลดต่อ — เริ่มใหม่ตั้งแต่ต้น');
      file.truncate(0);
    }

    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      file.write(value, { at });
      at += value.length;
      post({ type: 'progress', id, bytes: value.length });

      if (at - (ctx.state.video ? ctx.state.video.bytes : 0) > 8 * 1048576) {
        file.flush();
        ctx.state.video = { committed: 0, bytes: at };
        await writeState(dir, ctx.state);
      }
    }

    file.flush();
    ctx.state.video = { committed: 0, bytes: at };
    await writeState(dir, ctx.state);
    return at;
  } finally {
    file.close();
  }
}

// ---------- ขั้น 1.5 · MPEG-TS → mp4 แบ่งท่อน ----------

let muxjsReady = null;

/** โหลด mux.js แบบ UMD เข้ามา · มันตั้ง globalThis.muxjs ให้เอง ไม่ได้ export อะไรกลับ */
async function loadMuxjs() {
  if (!muxjsReady) {
    muxjsReady = import('../vendor/muxjs/mux-mp4.min.js').then(() => {
      // บันเดิล mux-mp4 วาง Transmuxer ไว้ชั้นบนสุดเลย ไม่ได้ซ้อนใต้ .mp4
      // เหมือนบันเดิลตัวเต็ม — เรียกผิดชั้นแล้วได้ undefined เงียบๆ
      if (!self.muxjs || !self.muxjs.Transmuxer) throw new Error('โหลด mux.js ไม่ได้');
      return self.muxjs;
    });
  }
  return muxjsReady;
}

/**
 * แปลง MPEG-TS ที่ดึงมาให้เป็น mp4 แบ่งท่อน
 *
 * ต้องมีขั้นนี้เพราะ ffmpeg ที่เราใช้ **แยกสตรีม MPEG-TS ไม่ได้** (ดู vendor/libav/NOTICE.md)
 * แต่ HLS ส่วนใหญ่ส่ง segment มาเป็น .ts ถ้าไม่มีขั้นนี้ก็โหลดเว็บส่วนใหญ่ไม่ได้เลย
 *
 * flush ทีละ segment ตามความยาวที่จดไว้ตอนดึง — flush กลาง PES packet จะได้ภาพขาด
 * นี่คือเหตุผลที่ต้องจดความยาวของแต่ละชิ้นไว้ ไม่ใช่แค่ขนาดไฟล์รวม
 */
async function transmuxTs(ctx, fromName, toName, sizes) {
  const { id, dir, signal } = ctx;
  const muxjs = await loadMuxjs();

  const source = await (await dir.getFileHandle(fromName)).getFile();
  const outHandle = await dir.getFileHandle(toName, { create: true });
  const out = await outHandle.createSyncAccessHandle();

  try {
    out.truncate(0);
    let writeAt = 0;
    let wroteInit = false;

    const transmuxer = new muxjs.Transmuxer({ keepOriginalTimestamps: true });
    transmuxer.on('data', (segment) => {
      if (!wroteInit && segment.initSegment) {
        out.write(new Uint8Array(segment.initSegment), { at: writeAt });
        writeAt += segment.initSegment.byteLength;
        wroteInit = true;
      }
      out.write(new Uint8Array(segment.data), { at: writeAt });
      writeAt += segment.data.byteLength;
    });

    // ไม่มีความยาวรายชิ้น (ไฟล์เก่าจากรุ่นก่อน) ก็หั่นเป็นก้อนตามขอบ packet 188 ไบต์
    const chunks = sizes && sizes.length > 0 ? sizes : fallbackChunks(source.size);

    let at = 0;
    for (const length of chunks) {
      signal.throwIfAborted();
      if (length <= 0 || at >= source.size) continue;

      const slice = new Uint8Array(await source.slice(at, at + length).arrayBuffer());
      at += length;
      transmuxer.push(slice);
      transmuxer.flush();
    }

    out.flush();
    log(id, `แปลง MPEG-TS เป็น mp4 แบ่งท่อนแล้ว ${(writeAt / 1048576).toFixed(1)} MB`);
    if (writeAt === 0) throw new Error('แปลง MPEG-TS ไม่ได้เลย — ไฟล์อาจไม่ใช่ MPEG-TS จริง');
    return writeAt;
  } finally {
    out.close();
  }
}

/** ก้อนขนาด ~4 MB ที่หารด้วย 188 ลงตัว เพื่อไม่ตัดกลาง packet ของ MPEG-TS */
function fallbackChunks(total) {
  const step = 188 * 22000;
  const out = [];
  for (let at = 0; at < total; at += step) out.push(Math.min(step, total - at));
  return out;
}

// ---------- ขั้น 2 · รวมเป็น mp4 ----------

/**
 * รวมไฟล์ที่ดึงมาให้เป็น mp4
 *
 * `-c copy` ทุกครั้ง ไม่เข้ารหัสวิดีโอใหม่เลย — ตัว wasm ที่เราใช้ตัดตัวเข้ารหัสออกหมดอยู่แล้ว
 * จึงไม่มีทางเผลอได้ H.265 ออกมา
 *
 * ขาออกเขียนผ่าน `mkfsfhfile` ซึ่งเป็นไฟล์จริงใน OPFS ที่เลื่อนตำแหน่งเขียนได้
 * ถ้าใช้ writer device ธรรมดาจะเลื่อนไม่ได้ ต้องไปใช้ mp4 แบบแบ่งท่อน (`frag_keyframe`)
 * ซึ่งเล่นไม่ได้ในโปรแกรมเก่าบางตัว
 */
async function remuxToMp4(ctx, inputs, container) {
  const { id, dir, signal } = ctx;
  const hasAudio = inputs.length > 1;

  const libav = await LibAVFactory.LibAV({ noworker: true });
  try {
    const videoFile = await (await dir.getFileHandle(inputs[0])).getFile();
    await libav.mkreadaheadfile('in0', videoFile);

    const args = ['-analyzeduration', '10M', '-f', container, '-i', 'in0'];
    if (hasAudio) {
      const audioFile = await (await dir.getFileHandle(inputs[1])).getFile();
      await libav.mkreadaheadfile('in1', audioFile);
      args.push('-f', container, '-i', 'in1');
    }

    const outHandle = await dir.getFileHandle(OUTPUT_FILE, { create: true });
    // เริ่มจากไฟล์ว่าง · ของเก่าค้างอยู่แล้ว ffmpeg จะเขียนทับไม่หมดแล้วได้ไฟล์เสีย
    await (await outHandle.createWritable()).close();
    await libav.mkfsfhfile(OUTPUT_FILE, outHandle);

    args.push(
      '-map', '0:v:0?',
      '-map', hasAudio ? '1:a:0?' : '0:a:0?',
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',   // MPEG-TS เริ่มที่เวลาไม่ใช่ศูนย์ได้ ซึ่ง mp4 รับไม่ได้
      '-y', OUTPUT_FILE);

    log(id, `ffmpeg ${args.join(' ')}`);
    signal.throwIfAborted();

    const code = await libav.ffmpeg(...args);
    if (code !== 0) throw new Error(`ffmpeg ออกด้วยรหัส ${code} — ไฟล์ที่ดึงมาน่าจะไม่ครบหรือไม่ใช่ ${container}`);

    await libav.unlinkfsfhfile(OUTPUT_FILE);
    await libav.unlinkreadaheadfile('in0');
    if (hasAudio) await libav.unlinkreadaheadfile('in1');

    return (await outHandle.getFile()).size;
  } finally {
    try { await libav.terminate(); } catch (e) { /* ปิดไม่ได้ก็ปล่อย worker ตายไปกับงาน */ }
  }
}

// ---------- ร้อยทั้งงาน ----------

async function runJob(job) {
  const stop = new AbortController();
  running.set(job.id, stop);

  const ctx = {
    id: job.id,
    headers: job.headers || {},
    signal: stop.signal,
    channels: Math.max(1, Math.min(16, job.channels || 6)),
    dir: null,
    state: {},
  };

  try {
    ctx.dir = await jobDir(job.id);
    ctx.state = (await readState(ctx.dir)) || {};

    post({ type: 'state', id: job.id, phase: 'downloading' });

    let container = 'mp4';
    let inputs = [PART_VIDEO];

    if (job.kind === 'hls') {
      let mediaUrl = job.url;
      let audioUrl = job.audioUrl || null;

      // ลิงก์ที่ส่งมาอาจเป็น master — เลือกความชัดตามที่ผู้ใช้กด หรือตัวชัดสุดถ้าไม่ได้ระบุ
      const first = await fetchText(mediaUrl, ctx.headers, ctx.signal);
      if (isMaster(first)) {
        const variants = parseMaster(first, mediaUrl);
        if (variants.length === 0) throw new Error('master playlist ไม่มีความชัดให้เลือกเลย');

        const pick = job.height
          ? variants.find((v) => v.height === job.height) || variants[0]
          : variants[0];

        mediaUrl = pick.url;
        audioUrl = audioUrl || pick.audioUrl;
        log(job.id, `เลือก ${pick.height || '?'}p จาก ${variants.length} ความชัด`);
      }

      const body = mediaUrl === job.url ? first : await fetchText(mediaUrl, ctx.headers, ctx.signal);
      const playlist = parseMedia(body, mediaUrl);
      if (playlist.segments.length === 0) throw new Error('playlist ไม่มี segment เลย');
      if (playlist.isLive) throw new Error('นี่เป็นสตรีมสด ยังโหลดไม่ได้');

      // ตัดให้สั้นได้ · เทสใช้ตัดเหลือไม่กี่ชิ้นเพื่อไม่ต้องดึงคลิปเต็มทุกครั้ง
      if (job.limitSegments > 0) playlist.segments = playlist.segments.slice(0, job.limitSegments);

      container = playlist.container;
      post({
        type: 'state', id: job.id, phase: 'downloading',
        segmentsTotal: playlist.segments.length, duration: playlist.duration,
      });

      await announceHosts(job.id, playlist.segments.slice(0, 50).map((s) => s.url));
      await fetchSegments(ctx, playlist, PART_VIDEO, 'video');
      inputs = [PART_VIDEO];

      if (audioUrl) {
        const audioBody = await fetchText(audioUrl, ctx.headers, ctx.signal);
        const audioList = parseMedia(audioBody, audioUrl);
        if (audioList.segments.length > 0) {
          await announceHosts(job.id, audioList.segments.slice(0, 50).map((s) => s.url));
          log(job.id, `เสียงแยกไฟล์ ${audioList.segments.length} ชิ้น`);
          await fetchSegments(ctx, audioList, PART_AUDIO, 'audio');
          inputs.push(PART_AUDIO);
        }
      }

      // ffmpeg ของเราอ่าน MPEG-TS ไม่ได้ ต้องให้ mux.js แปลงก่อน
      if (container === 'mpegts') {
        post({ type: 'state', id: job.id, phase: 'converting' });
        await transmuxTs(ctx, PART_VIDEO, PART_VIDEO_MP4, ctx.state.video.sizes);
        if (inputs.length > 1) {
          await transmuxTs(ctx, PART_AUDIO, PART_AUDIO_MP4, ctx.state.audio.sizes);
          inputs = [PART_VIDEO_MP4, PART_AUDIO_MP4];
        } else {
          inputs = [PART_VIDEO_MP4];
        }
        container = 'mp4';
      }
    } else {
      await fetchWholeFile(ctx, job.url);
      inputs = [PART_VIDEO];
      container = containerFromUrl(job.url);
    }

    post({ type: 'state', id: job.id, phase: 'remuxing' });
    const size = await remuxToMp4(ctx, inputs, container);

    // ส่งไฟล์ที่เสร็จแล้วออกไปให้หน้า offscreen ทำ blob URL — worker ทำเองไม่ได้
    const outFile = await (await ctx.dir.getFileHandle(OUTPUT_FILE)).getFile();
    post({ type: 'done', id: job.id, size, file: outFile, filename: job.filename });
  } catch (err) {
    const aborted = ctx.signal.aborted;
    post({
      type: 'failed', id: job.id,
      cancelled: aborted,
      error: aborted ? 'ยกเลิกแล้ว' : String(err && err.message ? err.message : err),
    });
  } finally {
    running.delete(job.id);
  }
}

function containerFromUrl(url) {
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.webm')) return 'webm';
  if (path.endsWith('.mkv')) return 'matroska';
  if (path.endsWith('.ts')) return 'mpegts';
  return 'mp4';
}
