// ตัวอ่าน playlist ของ HLS
//
// เราอ่าน m3u8 เองใน JS ไม่ปล่อยให้ ffmpeg ดึงเอง เพราะสองอย่างนี้:
//   1. โหลด segment ขนานหลายช่องได้  — ffmpeg ดึงทีละชิ้นตามลำดับเท่านั้น
//   2. ทำต่อจากที่ค้างได้           — ต้องรู้ว่าเหลือ segment ไหน ซึ่ง ffmpeg ไม่บอก
//
// ไม่มี retry ตามกฎของโปรเจกต์ · ชิ้นไหนพังคืองานล้ม พร้อมบอกว่าพังชิ้นที่เท่าไหร่

/** แกะ `KEY=VALUE,KEY="VALUE,WITH,COMMAS"` ของ m3u8 ซึ่งคอมมาในเครื่องหมายคำพูดไม่ใช่ตัวคั่น */
export function parseAttributes(line) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m;
  while ((m = re.exec(line)) !== null) {
    out[m[1].toUpperCase()] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
  }
  return out;
}

const tagOf = (line) => {
  const colon = line.indexOf(':');
  return colon < 0 ? line : line.slice(0, colon);
};
const valueOf = (line) => {
  const colon = line.indexOf(':');
  return colon < 0 ? '' : line.slice(colon + 1);
};

function lines(body) {
  return body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}

export function isMaster(body) {
  return body.includes('#EXT-X-STREAM-INF');
}

/**
 * แตก master playlist เป็นรายการความชัด
 *
 * สายเสียงแยกไฟล์ (`#EXT-X-MEDIA:TYPE=AUDIO`) ถูกจับคู่เข้ากับความชัดผ่าน GROUP-ID
 * ถ้าไม่จับคู่ให้ จะได้วิดีโอเงียบ ซึ่งเป็นอาการที่ผู้ใช้หาสาเหตุเองไม่ได้เลย
 */
export function parseMaster(body, baseUrl) {
  const rows = lines(body);
  const audioGroups = new Map();   // GROUP-ID -> { url, language, name }

  for (const line of rows) {
    if (tagOf(line) !== '#EXT-X-MEDIA') continue;
    const a = parseAttributes(valueOf(line));
    if ((a.TYPE || '').toUpperCase() !== 'AUDIO' || !a.URI) continue;

    const group = a['GROUP-ID'] || '';
    // DEFAULT=YES คือสายที่ player จะเลือก ถ้ามีก็เอาตัวนั้นทับตัวที่เจอก่อน
    if (!audioGroups.has(group) || (a.DEFAULT || '').toUpperCase() === 'YES') {
      audioGroups.set(group, {
        url: new URL(a.URI, baseUrl).href,
        language: a.LANGUAGE || '',
        name: a.NAME || '',
      });
    }
  }

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (tagOf(rows[i]) !== '#EXT-X-STREAM-INF') continue;

    const target = rows.slice(i + 1).find((l) => !l.startsWith('#'));
    if (!target) continue;

    const a = parseAttributes(valueOf(rows[i]));
    const res = /^(\d+)x(\d+)$/.exec(a.RESOLUTION || '');
    const audio = a.AUDIO ? audioGroups.get(a.AUDIO) : undefined;

    out.push({
      url: new URL(target, baseUrl).href,
      audioUrl: audio ? audio.url : null,
      audioLanguage: audio ? audio.language : '',
      height: res ? parseInt(res[2], 10) : 0,
      width: res ? parseInt(res[1], 10) : 0,
      bandwidth: parseInt(a.BANDWIDTH || a['AVERAGE-BANDWIDTH'] || '0', 10),
      codecs: a.CODECS || '',
    });
  }

  // ชัดที่สุดก่อน · ความชัดเท่ากันให้ bitrate สูงกว่าชนะ
  // ตัวที่เล่นไม่ได้ถูกดันไปท้าย ไม่ใช่ทิ้ง — เผื่อ playlist มีแต่พวกนั้น
  out.sort((x, y) =>
    (playable(x.codecs) - playable(y.codecs)) ||
    (y.height - x.height) ||
    (y.bandwidth - x.bandwidth));
  return out;
}

/**
 * variant นี้เอามาทำ mp4 ที่เล่นได้จริงไหม (0 = ได้ · 1 = ไม่ควรเอา)
 *
 * เราไม่เข้ารหัสวิดีโอใหม่เลย สิ่งที่อยู่ใน playlist จึงไปอยู่ในไฟล์ตรงๆ
 * ถ้าหยิบ variant ที่เป็น H.265 หรือ AV1 มา จะได้ mp4 ที่เปิดไม่ได้ในโปรแกรมทั่วไป
 * และผิดกฎของโปรเจกต์ที่ห้าม H.265 ด้วย
 */
function playable(codecs) {
  const lower = (codecs || '').toLowerCase();
  if (lower.includes('hvc1') || lower.includes('hev1') || lower.includes('dvh')) return 1;
  if (lower.includes('av01')) return 1;
  return 0;
}

/**
 * แตก media playlist เป็นรายการ segment ที่พร้อมดึง
 *
 * คืน `encryption` ไว้ด้วย แต่ยังไม่ดึงกุญแจ — คนเรียกดึงเองเพราะต้องใช้หัวคำขอชุดเดียวกัน
 */
export function parseMedia(body, baseUrl) {
  const rows = lines(body);

  let mediaSequence = 0;
  let initUrl = null;
  let initByteRange = null;
  let key = null;                    // { method, url, ivHex }
  let pendingByteRange = null;
  let pendingDuration = 0;
  let lastByteEnd = 0;
  let duration = 0;
  const segments = [];

  for (const line of rows) {
    if (!line.startsWith('#')) {
      const seq = mediaSequence + segments.length;
      segments.push({
        url: new URL(line, baseUrl).href,
        seq,
        duration: pendingDuration,
        byteRange: pendingByteRange,
        key: key && key.method !== 'NONE' ? { ...key, seq } : null,
      });
      duration += pendingDuration;
      pendingDuration = 0;
      pendingByteRange = null;
      continue;
    }

    switch (tagOf(line)) {
      case '#EXT-X-MEDIA-SEQUENCE':
        mediaSequence = parseInt(valueOf(line), 10) || 0;
        break;

      case '#EXTINF':
        pendingDuration = parseFloat(valueOf(line).split(',')[0]) || 0;
        break;

      case '#EXT-X-BYTERANGE': {
        // `LENGTH[@OFFSET]` — ไม่มี OFFSET แปลว่าต่อท้ายชิ้นก่อนหน้า
        const [lenText, offsetText] = valueOf(line).split('@');
        const length = parseInt(lenText, 10) || 0;
        const offset = offsetText !== undefined ? parseInt(offsetText, 10) : lastByteEnd;
        pendingByteRange = { offset, length };
        lastByteEnd = offset + length;
        break;
      }

      case '#EXT-X-MAP': {
        const a = parseAttributes(valueOf(line));
        if (a.URI) initUrl = new URL(a.URI, baseUrl).href;
        if (a.BYTERANGE) {
          const [lenText, offsetText] = a.BYTERANGE.split('@');
          initByteRange = {
            offset: parseInt(offsetText || '0', 10),
            length: parseInt(lenText, 10) || 0,
          };
        }
        break;
      }

      case '#EXT-X-KEY': {
        const a = parseAttributes(valueOf(line));
        const method = (a.METHOD || 'NONE').toUpperCase();
        key = method === 'NONE' ? null : {
          method,
          url: a.URI ? new URL(a.URI, baseUrl).href : '',
          ivHex: a.IV || '',
        };
        break;
      }

      default:
        break;
    }
  }

  return {
    segments,
    initUrl,
    initByteRange,
    duration,
    isLive: !body.includes('#EXT-X-ENDLIST'),
    container: guessContainer(initUrl, segments),
  };
}

/**
 * บอก ffmpeg ว่าก้อนที่เราต่อให้เป็นรูปแบบอะไร
 *
 * เดาผิดแล้วงานล้มทั้งงาน และ `-f` ที่ถูกคือเรื่องเดียวที่กันไม่ให้ ffmpeg
 * ไปเดาเองแล้วเจอ MPEG-TS ที่มี header แปลกๆ
 */
function guessContainer(initUrl, segments) {
  if (initUrl) return 'mp4';   // มี init segment = fragmented mp4 เสมอ

  const sample = segments.length > 0 ? segments[0].url : '';
  const path = sample.split('?')[0].toLowerCase();
  if (path.endsWith('.m4s') || path.endsWith('.mp4') || path.endsWith('.m4a')) return 'mp4';
  if (path.endsWith('.aac')) return 'aac';
  if (path.endsWith('.webm')) return 'webm';
  return 'mpegts';
}

/**
 * ถอดรหัส segment ของ HLS
 *
 * AES-128 ของ HLS คือ AES-CBC ที่ **IV มาจากลำดับ segment** เมื่อ playlist ไม่ได้ระบุ IV ไว้
 * เรื่องนี้พลาดง่ายมาก และอาการคือได้ไฟล์ที่ ffmpeg บอกว่า "ไม่รู้จักรูปแบบ" เฉยๆ
 */
export async function decryptSegment(bytes, keyBytes, ivHex, seq) {
  let iv;
  if (ivHex) {
    const hex = ivHex.replace(/^0[xX]/, '');
    iv = new Uint8Array(16);
    for (let i = 0; i < 16; i++) iv[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
  } else {
    iv = new Uint8Array(16);
    new DataView(iv.buffer).setUint32(12, seq >>> 0, false);   // big-endian ท้ายสุด
  }

  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, bytes);
  return new Uint8Array(plain);
}
