// คนกลางระหว่าง service worker กับ worker ที่โหลดจริง
//
// มีหน้านี้อยู่เพราะ service worker ของ MV3 สร้าง Worker ไม่ได้ และไม่มี URL.createObjectURL
// ให้ด้วย ซึ่งสองอย่างนั้นคือสิ่งที่ขั้นตอนโหลดต้องใช้

const worker = new Worker('download/worker.js', { type: 'module' });

/**
 * สายตรงไปหา service worker
 *
 * **ห้ามใช้ `chrome.runtime.sendMessage` แบบยิงทิ้งกับข้อความของงาน** · service worker
 * ของ MV3 ถูกปิดเองเมื่อไม่มีใครคุยด้วย ถ้ามันหลับหรือกำลังรีสตาร์ทตอนข้อความวิ่งมาถึง
 * ข้อความนั้น **หายไปเฉยๆ** แล้วงานจะค้างที่ขั้นแรกตลอดกาลโดยไม่มี error ให้เห็นเลย
 *
 * อาการนี้โผล่เฉพาะตอนใช้งานจริง (ผู้ใช้กดโหลดแล้วปิดเมนู) ส่วนตอนเทสไม่โผล่
 * เพราะหน้าเทสถามสถานะทุกวินาที ซึ่งทำให้ service worker ไม่เคยได้หลับ
 *
 * สายที่เปิดค้างไว้แก้ได้ทั้งสองอย่าง: ข้อความไม่หาย และตัว service worker
 * ถูกยืดอายุไว้ตราบที่สายยังเปิด
 */
let port = null;

function wire() {
  port = chrome.runtime.connect({ name: 'newkewi-jobs' });
  port.onDisconnect.addListener(() => { port = null; });
}

function tell(message) {
  try {
    if (!port) wire();
    port.postMessage(message);
  } catch (err) {
    // สายขาดระหว่างทาง — ต่อใหม่แล้วส่งซ้ำครั้งเดียว ถ้ายังไม่ได้ก็ปล่อย
    try {
      wire();
      port.postMessage(message);
    } catch (again) { /* service worker ไปแล้วจริงๆ */ }
  }
}

wire();

/** blob URL ที่ยังถือไว้รอ chrome.downloads ดูดไฟล์ไป · ปล่อยเร็วเกินไฟล์จะหาย */
const held = new Map();   // jobId -> blob URL

worker.onmessage = (event) => {
  const msg = event.data;

  if (msg.type === 'done') {
    const url = URL.createObjectURL(msg.file);
    held.set(msg.id, url);
    tell({ type: 'job-done', id: msg.id, size: msg.size, filename: msg.filename, blobUrl: url });
    return;
  }

  // ชื่อชนิดต้องอยู่ **หลัง** การกระจายค่า ไม่ใช่ก่อน
  //
  // เขียน `{ type: \`job-${msg.type}\`, ...msg }` แล้ว `...msg` จะเอา type เดิมมาทับกลับ
  // ข้อความ state/progress/log ทั้งหมดเลยวิ่งไปด้วยชื่อผิดแล้วถูกทิ้ง ผลคือแถบความคืบหน้า
  // ค้างที่ "กำลังเริ่ม 0.0 MB" ตลอดทั้งที่งานโหลดอยู่จริงและเสร็จได้ด้วย
  tell({ ...msg, type: `job-${msg.type}` });
};

worker.onerror = (event) => {
  tell({ type: 'job-failed', id: 'unknown', error: `worker พัง: ${event.message}` });
};


chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  switch (msg.type) {
    case 'offscreen-start':
      worker.postMessage({ type: 'start', job: msg.job });
      reply({ ok: true });
      return false;

    case 'offscreen-cancel':
      worker.postMessage({ type: 'cancel', id: msg.id });
      reply({ ok: true });
      return false;

    // กฎใส่หัวคำขอติดแล้ว ตัวโหลดเริ่มดึง segment ได้
    case 'offscreen-hosts-ready':
      worker.postMessage({ type: 'hosts-ready', id: msg.id });
      reply({ ok: true });
      return false;

    // ทำไฟล์ข้อความให้ service worker เอาไปเซฟ · มันไม่มี URL.createObjectURL
    // และ chrome.downloads ไม่รับ data: url
    case 'offscreen-save-text': {
      const id = `text-${Date.now().toString(36)}`;
      const url = URL.createObjectURL(new Blob([msg.text], { type: 'text/plain;charset=utf-8' }));
      held.set(id, url);
      reply({ id, blobUrl: url });
      return false;
    }

    case 'offscreen-release-text': {
      const url = held.get(msg.id);
      if (url) {
        URL.revokeObjectURL(url);
        held.delete(msg.id);
      }
      reply({ ok: true });
      return false;
    }

    // งานถูกเซฟลงเครื่องแล้ว เก็บกวาดได้
    case 'offscreen-release': {
      const url = held.get(msg.id);
      if (url) {
        URL.revokeObjectURL(url);
        held.delete(msg.id);
      }
      if (msg.discard) worker.postMessage({ type: 'discard', id: msg.id });
      reply({ ok: true });
      return false;
    }

    default:
      return false;
  }
});
