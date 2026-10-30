// เทสโหลดจากเว็บจริงทั้งสาย
//
//   node extension/test/run-livesite.mjs https://เว็บ/หน้าที่มีวิดีโอ
//
// เดินทางเดียวกับผู้ใช้: เปิดหน้าเว็บ → ตัวดักเก็บลิงก์กับหัวคำขอจริง → สั่งโหลด →
// เบราว์เซอร์ดึง segment เอง → แปลง → รวมเป็น mp4 → เซฟลงเครื่อง
//
// โหลดแค่ไม่กี่ segment ต่อรอบ พอรู้ว่าสายงานใช้ได้กับเว็บนั้นจริง

import { runExtensionPage, clickPlayInTab } from './browser.mjs';

const PORT = 9334;

const siteUrl = process.argv[2];
if (!siteUrl) {
  console.error('บอกด้วยว่าจะลองเว็บไหน:  node extension/test/run-livesite.mjs <url>');
  process.exit(2);
}

// กดเล่นวิดีโอให้เองเป็นระยะระหว่างที่หน้าเทสรออยู่
//
// เว็บส่วนใหญ่ไม่ขอ playlist จนมีคนกดเล่น · กดซ้ำหลายรอบเพราะรอบแรกๆ หน้าอาจยังไม่โหลด
// ตัวเล่น และบางเว็บเล่นโฆษณาก่อน ต้องกดข้ามหรือกดอีกทีให้คลิปจริงเริ่ม
let clicking = true;
(async () => {
  await new Promise((r) => setTimeout(r, 9000));
  let clicked = false;
  for (let round = 1; round <= 30 && clicking; round++) {
    const what = await clickPlayInTab(PORT, siteUrl, { clickOnce: !clicked })
      .catch((e) => `กดไม่ได้: ${e.message}`);
    console.log(`  [เล่น ${round}] ${what}`);
    if (what.startsWith('กดเล่นที่')) clicked = true;
    await new Promise((r) => setTimeout(r, 5000));
  }
})();

try {
  const { value, noise } = await runExtensionPage({
    page: `test/livesite.html#${encodeURIComponent(siteUrl)}`,
    sentinel: '__live',
    timeoutMs: 420000,
    port: PORT,
  });
  clicking = false;

  console.log(value.lines.join('\n'));
  if (!value.pass) {
    const useful = noise.filter((l) => !l.startsWith('[nav]'));
    if (useful.length > 0) {
      console.log('\n--- เสียงจากในเบราว์เซอร์ ---');
      console.log(useful.slice(-40).join('\n'));
    }
  }
  process.exit(value.pass ? 0 : 1);
} catch (err) {
  console.error(`เทสไม่ได้: ${err.message}`);
  process.exit(3);
}
