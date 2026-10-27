// ตรวจว่าตัวที่ build แล้วติดตั้งขึ้นจริง
//
//   node extension/test/run-smoke.mjs
//
// ตรวจแค่ว่า Chrome รับโฟลเดอร์ใน dist/ เข้าไปได้และ service worker เริ่มทำงาน
// ซึ่งเป็นด่านที่จับความพลาดของขั้น build ได้: manifest เสีย ไฟล์ขาด หรือ CSP ผิด
//
// ส่วนตัวเครื่องยนต์ทดสอบที่ run-selftest.mjs ซึ่งวิ่งกับโค้ดต้นฉบับ (ตัวเดียวกันเป๊ะ
// เพราะ build แค่คัดลอกไฟล์ แล้ว build.mjs ตรวจรายการไฟล์ที่ต้องมีให้อีกชั้น)

import path from 'node:path';
import { runExtensionPage, repoRoot } from './browser.mjs';

const dist = path.join(repoRoot, 'dist', 'newkewi-extension');

try {
  const { value } = await runExtensionPage({
    extensionDir: dist,
    bootOnly: true,
    page: '',
    sentinel: '__smoke',
    port: 9335,
  });
  console.log(`✓ ${value.lines[0]}`);
  console.log(`  จาก ${dist}`);
  process.exit(0);
} catch (err) {
  console.error(`✗ ตัวที่ build แล้วติดตั้งไม่ขึ้น: ${err.message}`);
  process.exit(1);
}
