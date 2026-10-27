// คนกลางระหว่าง service worker กับ worker ที่โหลดจริง
//
// มีหน้านี้อยู่เพราะ service worker ของ MV3 สร้าง Worker ไม่ได้ และไม่มี URL.createObjectURL
// ให้ด้วย ซึ่งสองอย่างนั้นคือสิ่งที่ขั้นตอนโหลดต้องใช้

const worker = new Worker('download/worker.js', { type: 'module' });

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

  tell({ type: `job-${msg.type}`, ...msg });
};

worker.onerror = (event) => {
  tell({ type: 'job-failed', id: 'unknown', error: `worker พัง: ${event.message}` });
};

function tell(message) {
  // service worker อาจหลับอยู่ตอนเราส่ง — มันจะถูกปลุกให้มารับเอง ถ้าพลาดก็ไม่มีใครรับ
  chrome.runtime.sendMessage(message).catch(() => {});
}

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
