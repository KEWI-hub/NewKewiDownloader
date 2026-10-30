// รันเทสของตัวโหลดในเบราว์เซอร์
//
//   node extension/test/run-selftest.mjs
//
// ออกด้วยรหัส 0 เมื่อผ่านทั้งหมด · ใช้ profile แยก ไม่แตะ _profile/ ของแอป

import { runExtensionPage } from './browser.mjs';

try {
  const { value, noise } = await runExtensionPage({
    page: 'test/selftest.html',
    sentinel: '__selftest',
    timeoutMs: 120000,
  });

  console.log(value.lines.join('\n'));
  if (value.failures > 0) {
    console.log('\n--- เสียงจากในเบราว์เซอร์ ---');
    console.log(noise.join('\n'));
  }
  process.exit(value.failures === 0 ? 0 : 1);
} catch (err) {
  console.error(`เทสไม่ได้: ${err.message}`);
  process.exit(3);
}
