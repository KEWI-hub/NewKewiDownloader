// เทสทั้งสายกับเว็บจริง
//
// เดินทางเดียวกับที่ผู้ใช้เดินเป๊ะ: เปิดหน้าเว็บ → ตัวดักเก็บลิงก์กับหัวคำขอจริง →
// สั่งโหลด → เบราว์เซอร์ดึง segment เอง → แปลง → รวมเป็น mp4 → เซฟลงเครื่อง
//
// ไม่มีอะไรปลอมเลยในนี้ ถ้าผ่าน แปลว่าเว็บนั้นโหลดได้จริง

const out = document.getElementById('out');
const lines = [];

function say(text) {
  lines.push(text);
  out.textContent = lines.join('\n');
}

const ask = (message) => chrome.runtime.sendMessage(message);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** รอจนเงื่อนไขเป็นจริง คืน null ถ้าหมดเวลา — ไม่มี retry ของตัวงาน นี่แค่รอให้ของมาถึง */
async function until(what, check, limitMs) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(1000);
  }
  say(`✗ หมดเวลารอ: ${what}`);
  return null;
}

async function run(siteUrl) {
  // รุ่นของส่วนขยายที่ **รันอยู่จริง** · เคยเจอว่าเบราว์เซอร์ค้างโค้ดรุ่นเก่าไว้
  // แล้วเทสวิ่งกับโค้ดเก่าโดยไม่มีอะไรบอก แก้โค้ดเท่าไหร่ก็ไม่มีผล
  say(`ส่วนขยายรุ่น ${chrome.runtime.getManifest().version}`);
  say(`เว็บที่ลอง: ${siteUrl}`);

  const tab = await chrome.tabs.create({ url: siteUrl, active: true });
  say(`เปิดแท็บ ${tab.id} แล้ว`);

  // รอให้หน้าโหลดจบ แล้วให้เวลาตัวเล่นวิดีโอขอ playlist ของมันเอง
  const loaded = await until('หน้าเว็บโหลดจบ', async () => {
    const t = await chrome.tabs.get(tab.id).catch(() => null);
    return t && t.status === 'complete' ? t : null;
  }, 60000);
  if (!loaded) return done(false);

  say(`ชื่อหน้า: ${loaded.title || '(ไม่มี)'}`);

  // รอ **คลิปจริง** ไม่ใช่โฆษณา · โฆษณามาถึงก่อนคลิปเสมอบนเว็บดูวิดีโอ
  // ถ้ารีบคว้าตัวแรกที่เจอจะได้ไฟล์โฆษณาไม่กี่ร้อย KB มาแทน
  const found = await until('ตัวดักเจอคลิปจริง (ไม่ใช่โฆษณา)', async () => {
    const answer = await ask({ type: 'qualities', tabId: tab.id });
    const real = (answer.qualities || [])
      .filter((q) => (q.kind === 'hls' || q.kind === 'file') && q.ad !== true);
    return real.length > 0 ? { real, pageUrl: answer.pageUrl } : null;
  }, 170000);

  if (!found) {
    say('  (เว็บนี้อาจต้องกดเล่นก่อน หรือเป็น DASH ซึ่งต้องส่งให้แอป)');
    await dumpCandidates(tab.id);
    return done(false);
  }

  // ให้เวลาอีกหน่อย เผื่อ variant ที่ชัดกว่ายังทยอยมา — ต้องได้ตัวสูงสุดที่เล่นได้
  await sleep(8000);
  const answer = await ask({ type: 'qualities', tabId: tab.id });
  const real = (answer.qualities || [])
    .filter((q) => (q.kind === 'hls' || q.kind === 'file') && q.ad !== true);

  await dumpCandidates(tab.id);
  say(`✓ เจอคลิปจริง ${real.length} ตัวเลือก · ชนิด ${[...new Set(real.map((q) => q.kind))].join(', ')}`);
  for (const q of real.slice(0, 8)) {
    say(`    ${q.height ? `${q.height}p` : q.kind}${q.codecs ? ` (${q.codecs})` : ''} ${q.url.slice(0, 90)}`);
  }

  // ลำดับที่ส่วนขยายจัดมาให้แล้วคือ "ของจริงก่อน · เล่นได้ก่อน · ชัดสุดก่อน"
  const pick = real[0];
  const heights = real.map((q) => q.height || 0);
  if (pick.height && pick.height < Math.max(...heights)) {
    say(`✗ เลือกได้ ${pick.height}p แต่มี ${Math.max(...heights)}p ให้เลือก`);
    return done(false);
  }
  say(`เลือก ${pick.height ? `${pick.height}p (สูงสุดที่เล่นได้)` : pick.kind} · ${pick.url.slice(0, 110)}`);

  const started = await ask({
    type: 'download',
    payload: {
      url: pick.url, audioUrl: pick.audioUrl || null, kind: pick.kind,
      height: pick.height || 0, title: loaded.title || '',
      pageUrl: answer.pageUrl || loaded.url,
      // ตัดให้สั้นพอรู้ว่าสายงานใช้ได้ ไม่ต้องดึงคลิปเต็มทุกครั้งที่เทส
      limitSegments: 4,
    },
  });

  if (!started.ok) {
    say(`✗ เริ่มโหลดไม่ได้: ${started.reason}`);
    return done(false);
  }
  say(`✓ เริ่มงานแล้ว · ชื่อไฟล์ที่จะได้: ${started.filename}`);

  let last = null;
  const finished = await until('งานโหลดจบ', async () => {
    const answer = await ask({ type: 'jobs' });
    const job = (answer.jobs || []).find((j) => j.id === started.id);
    if (!job) return null;
    last = job;
    out.textContent = `${lines.join('\n')}\n  … ${job.phase} ${(job.bytes / 1048576).toFixed(1)} MB` +
      (job.segmentsTotal ? ` (${job.segmentsDone}/${job.segmentsTotal})` : '');
    return ['done', 'failed', 'cancelled'].includes(job.phase) ? job : null;
  }, 240000);

  if (!finished) {
    // ค้างที่ขั้นไหนคือข้อมูลที่ไล่ปัญหาได้จริง ไม่ใช่แค่ "หมดเวลา"
    say(`  ค้างที่ขั้น: ${last ? last.phase : 'ไม่เคยเห็นงานนี้เลย'}` +
      (last ? ` · ${(last.bytes / 1048576).toFixed(1)} MB · ${last.segmentsDone || 0}/${last.segmentsTotal || 0} ชิ้น` : ''));
    await dumpLog();
    return done(false);
  }

  if (finished.phase !== 'done') {
    say(`✗ โหลดไม่สำเร็จ: ${finished.error}`);
    await dumpLog();
    return done(false);
  }

  say(`✓ โหลดเสร็จ ${(finished.bytes / 1048576).toFixed(2)} MB`);

  // ไฟล์ลงเครื่องจริงไหม ถามจากตัวจัดการดาวน์โหลดของเบราว์เซอร์เอง
  const saved = await chrome.downloads.search({ id: finished.downloadId });
  if (saved.length === 0 || saved[0].state !== 'complete') {
    say(`✗ เบราว์เซอร์ไม่ได้เซฟไฟล์ (${saved[0] ? saved[0].state : 'ไม่เจอรายการ'})`);
    return done(false);
  }

  say(`✓ เซฟลงเครื่องแล้ว: ${saved[0].filename}`);
  say(`✓ ขนาดบนดิสก์ ${(saved[0].fileSize / 1048576).toFixed(2)} MB`);

  if (!saved[0].filename.toLowerCase().endsWith('.mp4')) {
    say('✗ ไฟล์ที่ได้ไม่ลงท้าย .mp4');
    return done(false);
  }

  await dumpLog();
  return done(true);
}

/** เจออะไรไปบ้าง ไว้ดูตอนไม่เจอคลิปจริง — มักมีแต่โฆษณาติดมา */
async function dumpCandidates(tabId) {
  // อ่านของดิบที่ตัวดักเก็บไว้ด้วย · เทียบกันแล้วรู้ว่าธงหายไปตอนเก็บหรือตอนแตกรายการ
  const bag = await chrome.storage.session.get(`tab:${tabId}`);
  const raw = (bag[`tab:${tabId}`] || {}).items || [];
  say(`--- ของดิบที่ตัวดักเก็บไว้ ${raw.length} รายการ ---`);
  for (const i of raw.slice(-6)) say(`  ad=${i.ad} ${i.kind} ${i.url.slice(0, 90)}`);

  const answer = await ask({ type: 'qualities', tabId });
  say(`--- ที่ดักได้ทั้งหมด ${(answer.qualities || []).length} รายการ ---`);
  for (const q of (answer.qualities || []).slice(0, 12)) {
    say(`  ${q.ad ? '[โฆษณา] ' : ''}${q.kind} ${q.height || '?'}p ${q.url.slice(0, 95)}`);
  }
}

async function dumpLog() {
  const answer = await ask({ type: 'log' });
  say('--- บันทึกของส่วนขยาย ---');
  for (const row of (answer.rows || []).slice(-15)) say(`  ${row.text}`);
}

function done(pass) {
  say('', pass ? 'ผ่าน' : 'ไม่ผ่าน');
  document.title = pass ? 'LIVE-PASS' : 'LIVE-FAIL';
  window.__live = { pass, lines };
}

(async () => {
  const siteUrl = decodeURIComponent(location.hash.slice(1));
  if (!siteUrl) {
    say('ไม่ได้บอกว่าจะลองเว็บไหน — ส่งมาทาง #<url>');
    return done(false);
  }
  try {
    await run(siteUrl);
  } catch (err) {
    say(`✗ หลุดด้วยข้อผิดพลาด: ${err && err.stack ? err.stack : err}`);
    done(false);
  }
})();
