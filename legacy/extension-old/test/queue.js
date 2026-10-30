// เทสคิวทางเดียวกับที่ผู้ใช้กดจริง
//
// สั่ง background ให้โหลด HLS หนึ่งลิงก์ แล้วดูว่ามันเดินผ่านทุกขั้นจนได้ไฟล์ไหม
// ใช้สตรีมสาธารณะ ไม่ต้องพึ่งเว็บที่ต้องกดเล่นก่อน

const STREAM = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

const out = document.getElementById('out');
const lines = [];
let failures = 0;

function say(text) {
  lines.push(text);
  out.textContent = lines.join('\n');
}

function check(name, pass, detail) {
  if (!pass) failures++;
  say(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const ask = (message) => chrome.runtime.sendMessage(message);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  try {
    say(`ส่วนขยายรุ่น ${chrome.runtime.getManifest().version}`);

    const started = await ask({
      type: 'download',
      payload: {
        url: STREAM, kind: 'hls', height: 0,
        title: 'เทสคิว', pageUrl: 'https://test-streams.mux.dev/',
        limitSegments: 3,
      },
    });

    check('background รับงานเข้าคิว', started && started.ok, started && started.reason);
    if (!started || !started.ok) return finish();

    say(`  งาน ${started.id} · ไฟล์ ${started.filename}`);

    const seen = [];
    let last = null;
    const deadline = Date.now() + 240000;

    while (Date.now() < deadline) {
      const answer = await ask({ type: 'jobs' });
      const job = (answer.jobs || []).find((j) => j.id === started.id);

      if (job) {
        last = job;
        if (seen[seen.length - 1] !== job.phase) {
          seen.push(job.phase);
          say(`  ขั้น: ${job.phase}`);
        }
        if (['done', 'failed', 'cancelled'].includes(job.phase)) break;
      }
      out.textContent = `${lines.join('\n')}\n  … ${last ? `${last.phase} ${(last.bytes / 1048576).toFixed(1)} MB` : 'ยังไม่เห็นงาน'}`;
      await sleep(1000);
    }

    // ขั้นที่ต้องเดินผ่าน ดูจาก **บันทึกของส่วนขยาย** ไม่ใช่จากการสุ่มอ่านสถานะ
    //
    // การสุ่มอ่านทุกวินาทีกระโดดข้ามขั้นกลางได้ง่ายมาก (เคยเห็น starting → done
    // ทั้งที่เดินครบทุกขั้น) แล้วเทสจะฟ้องผิดว่าพัง ซึ่งอันตรายกว่าไม่เทสเลย
    // ส่วน background จดทุกการเปลี่ยนขั้นไว้ ไม่มีทางพลาด
    const log = await ask({ type: 'log' });
    const mine = (log.rows || []).filter((r) => r.jobId === started.id).map((r) => r.text);
    const passed = (phase) => mine.some((t) => t === `ขั้น: ${phase}`);

    check('ออกจากขั้น starting ได้', passed('downloading'),
      `ทุกบรรทัดของงานนี้: ${mine.join(' | ') || '(ไม่มีเลย)'}`);
    check('ดึง segment ได้จริง', (last && last.bytes > 0), `${last ? (last.bytes / 1048576).toFixed(2) : 0} MB`);
    check('แปลงและรวมเป็น mp4', passed('remuxing'));
    check('งานจบด้วยสถานะเสร็จ', last && last.phase === 'done', last ? `${last.phase} ${last.error || ''}` : 'ไม่มีงาน');

    if (last && last.phase === 'done') {
      const saved = await chrome.downloads.search({ id: last.downloadId });
      check('เซฟลงเครื่องจริง', saved.length > 0 && saved[0].state === 'complete',
        saved[0] ? saved[0].filename : 'ไม่เจอรายการดาวน์โหลด');
    }
  } catch (err) {
    check('รันเทสจบโดยไม่มีข้อผิดพลาดหลุด', false, String(err && err.stack ? err.stack : err));
  }

  finish();
})();

async function finish() {
  // บันทึกของส่วนขยายคือหลักฐานชิ้นเดียวกับที่ผู้ใช้ส่งมาให้ ดูด้วยกันไปเลย
  try {
    const log = await ask({ type: 'log' });
    say('--- บันทึกของส่วนขยาย ---');
    for (const row of (log.rows || []).slice(-25)) {
      say(`  ${row.level === 'error' ? '! ' : ''}${row.text}`);
    }
  } catch (e) { /* อ่านไม่ได้ก็ไม่เป็นไร */ }

  say('', failures === 0 ? 'ผ่านทั้งหมด' : `ไม่ผ่าน ${failures} ข้อ`);
  out.textContent = lines.join('\n');
  document.title = failures === 0 ? 'QUEUE-PASS' : `QUEUE-FAIL-${failures}`;
  window.__queue = { failures, lines };
}
