// ทำตัวติดตั้งของส่วนขยายให้พร้อมโหลดเข้า Chrome
//
//   node extension/build.mjs
//
// ได้ของสองอย่างใน dist/
//   newkewi-extension/       ← โฟลเดอร์ที่โหลดด้วย "โหลดส่วนขยายที่แตกไฟล์แล้ว" ได้เลย
//   newkewi-extension.zip    ← ก้อนเดียวไว้ส่งต่อ
//
// ไฟล์เทสไม่ถูกใส่ลงไป · ส่วน NOTICE/LICENSE ของไลบรารีคนอื่นต้องติดไปด้วยตามเงื่อนไข

import { cp, mkdir, rm, readFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repoRoot = path.resolve(here, '..');
const outRoot = path.join(repoRoot, 'dist');
const outDir = path.join(outRoot, 'newkewi-extension');
const outZip = path.join(outRoot, 'newkewi-extension.zip');

/** ของที่ไม่ต้องติดไปกับตัวติดตั้ง */
const SKIP = new Set(['test', 'build.mjs', 'node_modules']);

await rm(outDir, { recursive: true, force: true });
await rm(outZip, { force: true });
await mkdir(outDir, { recursive: true });

for (const name of await readdir(here)) {
  if (SKIP.has(name)) continue;
  await cp(path.join(here, name), path.join(outDir, name), { recursive: true });
}

const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'));

// ตรวจว่าของที่จำเป็นจริงๆ ติดไปครบ · ลืมตัว wasm แล้วส่วนขยายจะติดตั้งได้แต่โหลดวิดีโอไม่ได้
// และจะไปรู้ตอนผู้ใช้ลองใช้ ซึ่งสายไปแล้ว
const MUST_HAVE = [
  'manifest.json', 'background.js', 'content.js', 'offscreen.html', 'offscreen.js',
  'popup.html', 'popup.js', 'panel.css',
  'download/worker.js', 'download/hls.js',
  'vendor/muxjs/mux-mp4.min.js',
  'vendor/libav/libav-remux-cli.mjs',
  'vendor/libav/libav-6.8.7.1-remux-cli.wasm.mjs',
  'vendor/libav/libav-6.8.7.1-remux-cli.wasm.wasm',
  'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png',
];

const missing = [];
for (const rel of MUST_HAVE) {
  try { await stat(path.join(outDir, rel)); } catch (e) { missing.push(rel); }
}
if (missing.length > 0) {
  console.error('ขาดไฟล์ที่ต้องมี:\n  ' + missing.join('\n  '));
  process.exit(1);
}

// zip ด้วยเครื่องมือของ Windows เอง ไม่ต้องลงอะไรเพิ่ม
await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${outZip}' -Force`]);

const size = await total(outDir);
const zipped = (await stat(outZip)).size;

console.log(`New Kewi Downloader รุ่น ${manifest.version}`);
console.log(`  โฟลเดอร์: ${outDir}  (${(size / 1048576).toFixed(2)} MB)`);
console.log(`  zip:      ${outZip}  (${(zipped / 1048576).toFixed(2)} MB)`);
console.log('');
console.log('วิธีติดตั้ง: เปิด chrome://extensions → เปิด "โหมดนักพัฒนาซอฟต์แวร์"');
console.log(`  → "โหลดส่วนขยายที่แตกไฟล์แล้ว" → เลือกโฟลเดอร์ ${outDir}`);

async function total(dir) {
  let sum = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    sum += entry.isDirectory() ? await total(full) : (await stat(full)).size;
  }
  return sum;
}
