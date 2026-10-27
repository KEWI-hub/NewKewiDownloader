// เมนูของส่วนขยาย — วิดีโอในแท็บ · คิวงาน · บันทึก
//
// ไม่มีโปรแกรมข้างนอกให้ต่อแล้ว ทุกอย่างเกิดในเบราว์เซอร์

const $ = (id) => document.getElementById(id);
const ask = (message) => chrome.runtime.sendMessage(message).catch(() => null);

let tabId = -1;
let timer = 0;

function setState(text, kind) {
  const node = $('state');
  node.textContent = text;
  node.className = `state ${kind}`;
}

/** ชื่อไฟล์ที่เน้นนามสกุล .mp4 ให้เห็นชัดว่าได้อะไรแน่ */
function nameNode(filename) {
  const span = document.createElement('span');
  span.className = 'name';
  span.title = filename;
  span.append(document.createTextNode(filename.replace(/\.mp4$/i, '')));
  const ext = document.createElement('span');
  ext.className = 'ext';
  ext.textContent = '.mp4';
  span.appendChild(ext);
  return span;
}

// ---------- วิดีโอในแท็บ ----------

async function refreshList() {
  const answer = await ask({ type: 'qualities', tabId });
  const list = $('list');
  list.textContent = '';

  const items = (answer && answer.qualities) || [];
  $('empty').hidden = items.length > 0;

  const real = items.filter((q) => !q.ad);
  setState(real.length > 0
    ? `เจอ ${real.length} ตัวเลือกในแท็บนี้`
    : 'ยังไม่เจอวิดีโอ — กดเล่นวิดีโอก่อนแล้วเปิดเมนูนี้ใหม่',
  real.length > 0 ? 'ok' : 'warn');

  for (const q of items) {
    const row = document.createElement('li');

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = (q.ad ? 'โฆษณา · ' : '') + (q.height ? `${q.height}p` : q.kind.toUpperCase());

    const label = document.createElement('span');
    label.className = 'name';
    label.title = q.url;
    label.textContent = shortName(q.url);

    const go = document.createElement('button');
    go.className = 'small';
    go.textContent = 'โหลด .mp4';
    go.disabled = q.kind === 'dash';
    if (q.kind === 'dash') go.title = 'ยังโหลด DASH ไม่ได้';

    go.addEventListener('click', async () => {
      go.disabled = true;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const started = await ask({
        type: 'download',
        payload: {
          url: q.url, audioUrl: q.audioUrl || null, kind: q.kind, height: q.height || 0,
          title: tab ? tab.title : '', pageUrl: (answer && answer.pageUrl) || (tab ? tab.url : ''),
        },
      });
      go.textContent = started && started.ok ? 'เข้าคิวแล้ว' : 'ไม่สำเร็จ';
      void refreshJobs();
    });

    row.append(tag, label, go);
    list.appendChild(row);
  }
}

function shortName(url) {
  try {
    const u = new URL(url);
    return u.pathname.split('/').pop() || u.hostname;
  } catch (e) {
    return url.slice(0, 40);
  }
}

// ---------- คิวงาน ----------

const PHASE_TEXT = {
  queued: 'รอคิว', starting: 'กำลังเริ่ม', downloading: 'กำลังโหลด',
  converting: 'กำลังแปลง', remuxing: 'รวมเป็น mp4', saving: 'กำลังเซฟ',
  done: 'เสร็จแล้ว', failed: 'ล้มเหลว', cancelled: 'ยกเลิกแล้ว',
};

async function refreshJobs() {
  const answer = await ask({ type: 'jobs' });
  const jobs = (answer && answer.jobs) || [];
  const list = $('jobs');
  list.textContent = '';
  $('nojobs').hidden = jobs.length > 0;

  for (const job of jobs.slice(0, 10)) {
    const row = document.createElement('li');
    row.className = 'job';

    const top = document.createElement('div');
    top.className = 'top';
    top.appendChild(nameNode(job.filename || 'video.mp4'));

    const tag = document.createElement('span');
    tag.className = 'tag';
    const mb = (job.bytes || 0) / 1048576;
    tag.textContent = `${PHASE_TEXT[job.phase] || job.phase} · ${mb.toFixed(1)} MB`;
    top.appendChild(tag);

    if (['queued', 'starting', 'downloading', 'converting', 'remuxing'].includes(job.phase)) {
      const stop = document.createElement('button');
      stop.className = 'ghost small';
      stop.textContent = 'หยุด';
      stop.addEventListener('click', () => { void ask({ type: 'cancel', id: job.id }); });
      top.appendChild(stop);
    }

    row.appendChild(top);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    const done = job.phase === 'done' ? 1
      : job.segmentsTotal ? (job.segmentsDone || 0) / job.segmentsTotal
      : ['converting', 'remuxing', 'saving'].includes(job.phase) ? 1 : 0;
    fill.style.width = `${Math.round(done * 100)}%`;
    bar.appendChild(fill);
    row.appendChild(bar);

    if (job.error) {
      const why = document.createElement('div');
      why.className = 'why';
      why.textContent = job.error;
      row.appendChild(why);
    }

    list.appendChild(row);
  }
}

// ---------- บันทึก ----------

let logText = '';

async function refreshLog() {
  const answer = await ask({ type: 'log' });
  const rows = (answer && answer.rows) || [];

  logText = rows.map((r) => {
    const t = new Date(r.at).toLocaleTimeString('th-TH', { hour12: false });
    const mark = r.level === 'error' ? '!' : r.level === 'warn' ? '?' : ' ';
    return `${t} ${mark} ${r.text}`;
  }).join('\n');

  $('log').textContent = logText || 'ยังไม่มีบันทึก';
  $('log').scrollTop = $('log').scrollHeight;
}

// ---------- เริ่ม ----------

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab ? tab.id : -1;

  $('page').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const sent = await ask({ type: 'download-page', tabId });
    setState(sent && sent.ok
      ? `เข้าคิว ${sent.count} คลิป → โฟลเดอร์ ${sent.folder}`
      : ((sent && sent.reason) || 'ทำไม่สำเร็จ'), sent && sent.ok ? 'ok' : 'bad');
    e.target.disabled = false;
    void refreshJobs();
  });

  $('savelog').addEventListener('click', async () => {
    $('savelog').disabled = true;
    const saved = await ask({ type: 'save-log' });
    setState(saved && saved.ok
      ? `เก็บบันทึกไว้ที่โฟลเดอร์ดาวน์โหลด: ${saved.filename}`
      : `เก็บบันทึกไม่สำเร็จ: ${(saved && saved.reason) || '?'}`,
    saved && saved.ok ? 'ok' : 'bad');
    $('savelog').disabled = false;
  });

  $('copylog').addEventListener('click', async () => {
    await navigator.clipboard.writeText(logText).catch(() => {});
    $('copylog').textContent = 'คัดลอกแล้ว';
  });

  $('clearlog').addEventListener('click', async () => {
    await ask({ type: 'clear-log' });
    void refreshLog();
  });

  await Promise.all([refreshList(), refreshJobs(), refreshLog()]);

  // เมนูเปิดอยู่ก็อัปเดตเรื่อยๆ · ปิดเมนูแล้วหน้านี้ถูกทำลาย ตัวจับเวลาหายไปเอง
  timer = setInterval(() => { void refreshJobs(); void refreshLog(); }, 900);
  window.addEventListener('unload', () => clearInterval(timer));
})();
