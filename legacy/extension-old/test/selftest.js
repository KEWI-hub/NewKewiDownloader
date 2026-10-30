// เทสของจริง: อ่าน playlist จริง ดึง segment จริง แล้วให้ ffmpeg wasm รวมเป็น mp4 จริง
//
// ไม่ใส่ของปลอมเลย เพราะสิ่งที่พลาดบ่อยคือรอยต่อระหว่างชั้น (OPFS ↔ wasm ↔ fetch)
// ซึ่งของปลอมมองไม่เห็น

import { parseAttributes, isMaster, parseMaster, parseMedia, decryptSegment } from '../download/hls.js';

const out = document.getElementById('out');
const lines = [];
let failures = 0;

function check(name, pass, detail) {
  if (!pass) failures++;
  lines.push(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  out.textContent = lines.join('\n');
  out.className = failures > 0 ? 'bad' : 'ok';
}

// ---------- ตัวอ่าน playlist ----------

function testParser() {
  const attrs = parseAttributes('BANDWIDTH=800000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1280x720');
  check('คอมมาในเครื่องหมายคำพูดไม่ถูกตัดเป็นคนละค่า',
    attrs.CODECS === 'avc1.4d401f,mp4a.40.2' && attrs.RESOLUTION === '1280x720',
    JSON.stringify(attrs));

  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",LANGUAGE="th",NAME="ไทย",DEFAULT=YES,URI="audio/th.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,AUDIO="a1"',
    'v/360.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO="a1"',
    'v/1080.m3u8',
  ].join('\n');

  check('รู้ว่าเป็น master', isMaster(master));

  const variants = parseMaster(master, 'https://example.com/hls/index.m3u8');
  check('เรียงความชัดสูงสุดมาก่อน', variants[0].height === 1080, String(variants[0].height));
  check('ลิงก์ย่อยถูกต่อเป็น url เต็ม',
    variants[0].url === 'https://example.com/hls/v/1080.m3u8', variants[0].url);
  check('จับคู่สายเสียงแยกไฟล์ผ่าน GROUP-ID',
    variants[0].audioUrl === 'https://example.com/hls/audio/th.m3u8', String(variants[0].audioUrl));

  const media = [
    '#EXTM3U',
    '#EXT-X-MEDIA-SEQUENCE:10',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    '#EXTINF:4.0,',
    'seg1.m4s',
    '#EXT-X-BYTERANGE:1000@500',
    '#EXTINF:4.0,',
    'seg2.m4s',
    '#EXT-X-ENDLIST',
  ].join('\n');

  const list = parseMedia(media, 'https://example.com/hls/v/1080.m3u8');
  check('นับ segment ถูก', list.segments.length === 2, String(list.segments.length));
  check('ลำดับ segment เริ่มจาก MEDIA-SEQUENCE', list.segments[0].seq === 10, String(list.segments[0].seq));
  check('มี init segment = รู้ว่าเป็น mp4 แบ่งท่อน',
    list.initUrl.endsWith('/hls/v/init.mp4') && list.container === 'mp4', list.container);
  check('อ่าน BYTERANGE ได้',
    list.segments[1].byteRange.offset === 500 && list.segments[1].byteRange.length === 1000,
    JSON.stringify(list.segments[1].byteRange));
  check('รู้ว่า playlist จบแล้ว ไม่ใช่สตรีมสด', list.isLive === false);
  check('กุญแจติดไปกับทุกชิ้นพร้อมลำดับของชิ้นนั้น',
    list.segments[0].key.seq === 10 && list.segments[1].key.seq === 11);

  const live = parseMedia('#EXTM3U\n#EXTINF:4.0,\na.ts', 'https://e.com/x.m3u8');
  check('ไม่มี ENDLIST = สตรีมสด', live.isLive === true);
}

// ---------- การถอดรหัส ----------

async function testDecrypt() {
  const key = crypto.getRandomValues(new Uint8Array(16));
  const plain = crypto.getRandomValues(new Uint8Array(64));

  // เข้ารหัสด้วย IV ที่สร้างจากลำดับ แบบเดียวกับที่ HLS กำหนดเมื่อ playlist ไม่ระบุ IV
  const seq = 7;
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, seq, false);

  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt', 'decrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, plain));

  const back = await decryptSegment(cipher, key, '', seq);
  check('ถอดรหัส AES-128 ด้วย IV ที่มาจากลำดับ segment',
    back.length === plain.length && back.every((b, i) => b === plain[i]));
}

// ---------- ของจริงทั้งสาย ----------

const TEST_STREAM = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

async function testRealDownload() {
  const worker = new Worker(chrome.runtime.getURL('download/worker.js'), { type: 'module' });
  const id = `selftest-${Date.now().toString(36)}`;

  const finished = new Promise((resolve) => {
    worker.onmessage = (event) => {
      const msg = event.data;
      // ไม่มีใครคอยออกกฎหัวคำขอให้ตอนเทส บอกไปเลยว่าพร้อมแล้ว
      if (msg.type === 'hosts') worker.postMessage({ type: 'hosts-ready', id: msg.id });
      else if (msg.type === 'done' || msg.type === 'failed') resolve(msg);
    };
    worker.onerror = (e) => resolve({ type: 'failed', error: `worker พัง: ${e.message}` });
  });

  worker.postMessage({
    type: 'start',
    job: {
      id, kind: 'hls', url: TEST_STREAM, filename: 'selftest.mp4',
      headers: {}, channels: 4, height: 0, limitSegments: 3,
    },
  });

  const result = await Promise.race([
    finished,
    new Promise((r) => setTimeout(() => r({ type: 'failed', error: 'เกิน 120 วินาที' }), 120000)),
  ]);

  if (result.type !== 'done') {
    check('โหลดสตรีมจริงจนได้ mp4', false, result.error);
    worker.terminate();
    return;
  }

  check('โหลดสตรีมจริงจนได้ mp4', true, `${(result.size / 1024).toFixed(0)} KB`);

  const head = new Uint8Array(await result.file.slice(0, 12).arrayBuffer());
  const brand = String.fromCharCode(...head.slice(4, 8));
  check('ไฟล์ที่ได้เป็น mp4 จริง (มีกล่อง ftyp)', brand === 'ftyp', brand);

  // ตัวเล่นของเบราว์เซอร์อ่านได้ = ไฟล์ใช้ได้จริง ไม่ใช่แค่ header ถูก
  const played = await new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(result.file);
    video.onloadedmetadata = () => resolve({ duration: video.duration });
    video.onerror = () => resolve({
      duration: 0,
      why: video.error ? `code=${video.error.code} ${video.error.message}` : 'ไม่บอกสาเหตุ',
    });
    setTimeout(() => resolve({ duration: 0, why: 'ไม่ตอบใน 15 วินาที' }), 15000);
  });
  check('เบราว์เซอร์เปิดไฟล์ที่ได้และอ่านความยาวได้', played.duration > 1,
    played.why || `${played.duration.toFixed(1)} วินาที`);

  worker.postMessage({ type: 'discard', id });
  worker.terminate();
}

// ---------- เริ่ม ----------

(async () => {
  try {
    testParser();
    await testDecrypt();
    await testRealDownload();
  } catch (err) {
    check('รันเทสจบโดยไม่มีข้อผิดพลาดหลุด', false, String(err && err.stack ? err.stack : err));
  }

  lines.push('', failures === 0 ? 'ผ่านทั้งหมด' : `ไม่ผ่าน ${failures} ข้อ`);
  out.textContent = lines.join('\n');
  document.title = failures === 0 ? 'SELFTEST-PASS' : `SELFTEST-FAIL-${failures}`;
  window.__selftest = { failures, lines };
})();
