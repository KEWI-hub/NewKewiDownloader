// เทสคิวทางที่ผู้ใช้เดินจริง — ผ่าน background → offscreen → worker
//
//   node extension/test/run-queue.mjs
//
// ฟังเสียงจากทุกเป้าหมายในเบราว์เซอร์ด้วย เพราะความผิดพลาดในหน้า offscreen
// กับใน worker ไม่เคยโผล่มาถึงบันทึกของส่วนขยายเลย

import path from 'node:path';
import { runExtensionPage, watchAllTargets, repoRoot } from './browser.mjs';

const PORT = 9336;

// เกาะสายฟังไว้ตั้งแต่เบราว์เซอร์เพิ่งเปิด · รอจนพอร์ตดีบั๊กตอบก่อนค่อยผูก
let watcher = { noise: [], stop() {} };
(async () => {
  for (let round = 0; round < 60; round++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
    } catch (e) {
      continue;   // เบราว์เซอร์ยังไม่เปิดพอร์ต
    }
    watcher = await watchAllTargets(PORT);
    return;
  }
})();

try {
  const { value } = await runExtensionPage({
    // เทสตัวที่ build แล้วได้ด้วย: NEWKEWI_DIST=1 · แต่ dist ไม่มีหน้าเทสติดไป
    // จึงต้องคัดลอก test/ เข้าไปชั่วคราว (run-queue จัดการให้)
    extensionDir: process.env.NEWKEWI_TEST_DIR || undefined,
    page: 'test/queue.html',
    sentinel: '__queue',
    timeoutMs: 300000,
    port: PORT,
  });

  console.log(value.lines.join('\n'));

  if (value.failures > 0) {
    console.log('\n--- เสียงจากทุกส่วนในเบราว์เซอร์ ---');
    console.log(watcher.noise.join('\n') || '(เงียบสนิท)');
  }
  watcher.stop();
  process.exit(value.failures === 0 ? 0 : 1);
} catch (err) {
  console.error(`เทสไม่ได้: ${err.message}`);
  console.log('\n--- เสียงจากทุกส่วนในเบราว์เซอร์ ---');
  console.log(watcher.noise.join('\n') || '(เงียบสนิท)');
  watcher.stop();
  process.exit(3);
}
