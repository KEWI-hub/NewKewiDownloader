// แผงลอยเหนือตัวเล่นวิดีโอ แบบที่ IDM ทำ
//
// แผงอยู่ใน shadow root เพื่อให้ CSS ของเว็บเจ้าบ้านเอื้อมมาทับไม่ได้
// (เว็บดูวิดีโอชอบใส่กฎแรงๆ แบบ * { ... !important } ซึ่งจะทำให้แผงเพี้ยนทันที)
//
// ตั้งแต่รุ่น 2 กดโหลดแล้ว **เบราว์เซอร์โหลดเอง** แผงจึงโชว์ความคืบหน้าจริงได้
// และโชว์ชื่อไฟล์ที่จะได้เป็น .mp4 ตรงกับของที่เซฟลงเครื่องจริง

(function () {
  'use strict';

  const PANEL_CSS = `
    :host { all: initial; }
    .box {
      font: 500 13px/1.3 "Segoe UI", "Leelawadee UI", system-ui, sans-serif;
      display: flex; align-items: center; gap: 8px;
      padding: 7px 9px;
      background: rgba(22, 26, 32, .92);
      color: #fff;
      border-radius: 8px;
      box-shadow: 0 4px 18px rgba(0,0,0,.45);
      backdrop-filter: blur(3px);
    }
    .bird { width: 20px; height: 20px; border-radius: 50%; flex: none; }
    .name {
      max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-weight: 600;
    }
    .name .ext { color: #6fd3a0; }
    button {
      font: inherit; cursor: pointer;
      border: 0; border-radius: 6px; padding: 5px 11px;
      background: #2997FF; color: #fff;
    }
    button:hover { background: #1b86ea; }
    button:disabled { opacity: .55; cursor: default; }
    button.ghost {
      background: rgba(255,255,255,.12); padding: 5px 8px; font-size: 12px;
    }
    button.ghost:hover { background: rgba(255,255,255,.22); }
    select {
      font: inherit; cursor: pointer;
      border: 1px solid rgba(255,255,255,.25); border-radius: 6px;
      padding: 4px 6px; max-width: 150px;
      background: rgba(255,255,255,.1); color: #fff;
    }
    select option { color: #111; }
    .msg { font-size: 12px; opacity: .85; max-width: 240px; }
    .msg.bad { color: #ff9f9f; }
    .bar {
      width: 90px; height: 5px; border-radius: 3px; flex: none;
      background: rgba(255,255,255,.18); overflow: hidden; display: none;
    }
    .bar > i { display: block; height: 100%; width: 0; background: #6fd3a0; }
  `;

  let host = null;
  let shadow = null;
  let currentVideo = null;
  let hideTimer = 0;
  let watchTimer = 0;
  let loadedFor = null;
  let activeJob = null;
  let mp4Name = '';

  function build() {
    if (host) return;

    host = document.createElement('div');
    host.className = 'newkewi-panel-host';
    shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;

    const box = document.createElement('div');
    box.className = 'box';
    box.innerHTML = `
      <img class="bird" alt="">
      <span class="name"></span>
      <select class="pick"><option value="">กำลังหาวิดีโอ…</option></select>
      <button class="go" disabled>โหลด</button>
      <span class="bar"><i></i></span>
      <button class="toapp ghost" title="โหลดทุกคลิปในหน้านี้ลงโฟลเดอร์เดียว">ทั้งหน้า</button>
      <span class="msg"></span>
    `;

    box.querySelector('.bird').src = chrome.runtime.getURL('icons/icon48.png');
    box.querySelector('.go').addEventListener('click', onDownload);
    box.querySelector('.toapp').addEventListener('click', onSendPage);

    // กันไม่ให้การคลิกบนแผงทะลุไปโดนตัวเล่นวิดีโอ (จะทำให้วิดีโอหยุดเล่น)
    ['click', 'mousedown', 'pointerdown', 'dblclick'].forEach((t) =>
      box.addEventListener(t, (e) => e.stopPropagation(), true));

    box.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    box.addEventListener('mouseleave', scheduleHide);

    shadow.append(style, box);
  }

  function el(selector) {
    return shadow ? shadow.querySelector(selector) : null;
  }

  const ask = (message) => chrome.runtime.sendMessage(message).catch(() => null);

  // ---------- ตำแหน่ง ----------

  function place(video) {
    const rect = video.getBoundingClientRect();

    // เล็กเกินไปก็ไม่ใช่ตัวเล่นหลัก น่าจะเป็นภาพตัวอย่างหรือโฆษณา
    if (rect.width < 240 || rect.height < 140) return false;

    // เต็มจอต้องย้ายแผงเข้าไปอยู่ในตัวที่เต็มจอ ไม่งั้นมันจะอยู่ใต้วิดีโอ
    const parent = document.fullscreenElement || document.body;
    if (host.parentNode !== parent) parent.appendChild(host);

    host.style.position = document.fullscreenElement ? 'fixed' : 'absolute';
    const offsetY = document.fullscreenElement ? 0 : window.scrollY;
    const offsetX = document.fullscreenElement ? 0 : window.scrollX;

    host.style.top = `${rect.top + offsetY + 10}px`;
    host.style.left = `${rect.right + offsetX - 10}px`;
    host.style.transform = 'translateX(-100%)';
    host.style.display = 'block';
    return true;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      // กำลังโหลดอยู่ก็ค้างแผงไว้ ผู้ใช้ต้องเห็นว่ามันไปถึงไหนแล้ว
      if (host && !activeJob) host.style.display = 'none';
    }, 600);
  }

  // ---------- รายการความชัด ----------

  async function loadQualities() {
    const pick = el('.pick');
    const go = el('.go');
    const key = location.href;

    if (loadedFor === key && pick.options.length > 1) return;
    loadedFor = key;

    pick.innerHTML = '<option value="">กำลังหาวิดีโอ…</option>';
    go.disabled = true;

    const pageTitle = (document.title || '').trim().slice(0, 150);
    const [answer, named] = await Promise.all([
      ask({ type: 'qualities' }),
      ask({ type: 'filename', title: pageTitle, pageUrl: location.href }),
    ]);

    mp4Name = (named && named.filename) || 'video.mp4';
    showName(mp4Name);

    const list = (answer && answer.qualities) || [];
    pick.innerHTML = '';

    for (const q of list) {
      const option = document.createElement('option');
      option.value = JSON.stringify(q);
      // ความชัดเท่านั้น — ชื่อไฟล์โชว์แยกไว้ข้างหน้าแล้ว ไม่ต้องซ้ำในทุกบรรทัด
      option.textContent = q.height
        ? `${q.height}p`
        : (q.kind === 'hls' ? 'auto (HLS)' : q.kind.toUpperCase());
      pick.appendChild(option);
    }

    if (list.length === 0) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'ยังไม่เจอวิดีโอ — กดเล่นก่อน';
      pick.appendChild(none);
    }

    go.disabled = list.length === 0;
    message('');
  }

  /** โชว์ชื่อไฟล์ที่จะได้ โดยเน้นนามสกุลให้ชัดว่าเป็น .mp4 แน่นอน */
  function showName(filename) {
    const node = el('.name');
    if (!node) return;
    const base = filename.replace(/\.mp4$/i, '');
    node.textContent = '';
    node.append(document.createTextNode(base));
    const ext = document.createElement('span');
    ext.className = 'ext';
    ext.textContent = '.mp4';
    node.appendChild(ext);
    node.title = filename;
  }

  function message(text, bad) {
    const msg = el('.msg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = bad ? 'msg bad' : 'msg';
  }

  function progress(fraction) {
    const bar = el('.bar');
    if (!bar) return;
    bar.style.display = fraction === null ? 'none' : 'inline-block';
    if (fraction !== null) bar.firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
  }

  // ---------- โหลด ----------

  async function onDownload() {
    const pick = el('.pick');
    const go = el('.go');
    if (!pick.value) return;

    const chosen = JSON.parse(pick.value);
    const payload = {
      url: chosen.url,
      audioUrl: chosen.audioUrl || null,
      kind: chosen.kind,
      height: chosen.height || 0,
      title: (document.title || '').trim().slice(0, 150),
      pageUrl: location.href,
    };

    go.disabled = true;

    // DASH ยังทำไม่ได้ — ตัวแยกสตรีมที่เรามีอ่าน .mpd ไม่ได้ บอกตรงๆ ดีกว่าให้รอเงียบๆ
    if (chosen.kind === 'dash') {
      message('ยังโหลด DASH (.mpd) ไม่ได้', true);
      go.disabled = false;
      return;
    }

    message('เริ่มโหลด…');
    const started = await ask({ type: 'download', payload });

    if (!started || !started.ok) {
      message((started && started.reason) || 'เริ่มโหลดไม่สำเร็จ', true);
      go.disabled = false;
      return;
    }

    activeJob = started.id;
    showName(started.filename);
    watch();
  }

  /** ตามดูงานของตัวเองจนจบ · service worker อาจหลับไปตื่นมา เลยถามเป็นรอบ ไม่ใช้ช่องถาวร */
  function watch() {
    clearInterval(watchTimer);
    watchTimer = setInterval(async () => {
      const answer = await ask({ type: 'jobs' });
      const job = answer && answer.jobs ? answer.jobs.find((j) => j.id === activeJob) : null;
      if (!job) return;

      const mb = (job.bytes || 0) / 1048576;

      if (job.phase === 'downloading') {
        const done = job.segmentsTotal
          ? job.segmentsDone / job.segmentsTotal
          : null;
        progress(done);
        message(done !== null
          ? `${Math.round(done * 100)}% · ${mb.toFixed(1)} MB`
          : `${mb.toFixed(1)} MB`);
      } else if (job.phase === 'remuxing') {
        progress(1);
        message('กำลังรวมเป็น mp4…');
      } else if (job.phase === 'saving') {
        message('กำลังเซฟ…');
      } else if (job.phase === 'done') {
        stopWatching();
        progress(null);
        message(`เสร็จแล้ว ${mb.toFixed(1)} MB ✓`);
        setTimeout(() => { message(''); scheduleHide(); }, 4000);
      } else if (job.phase === 'failed' || job.phase === 'cancelled') {
        stopWatching();
        progress(null);
        message(job.error || 'โหลดไม่สำเร็จ', job.phase === 'failed');
      }
    }, 700);
  }

  function stopWatching() {
    clearInterval(watchTimer);
    watchTimer = 0;
    activeJob = null;
    const go = el('.go');
    if (go) go.disabled = false;
  }

  async function onSendPage() {
    message('กำลังหาคลิปในหน้านี้…');
    const sent = await ask({ type: 'download-page' });
    message(sent && sent.ok
      ? `เข้าคิว ${sent.count} คลิป → โฟลเดอร์ ${sent.folder} ✓`
      : ((sent && sent.reason) || 'ทำไม่สำเร็จ'), !(sent && sent.ok));
  }

  // ---------- จับการเอาเมาส์ไปวางบนวิดีโอ ----------

  function onPointerOver(e) {
    const video = e.target instanceof Element ? e.target.closest('video') : null;
    if (!video) return;

    build();
    currentVideo = video;
    clearTimeout(hideTimer);

    if (!place(video)) return;
    void loadQualities();
  }

  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerout', (e) => {
    if (e.target instanceof Element && e.target.closest('video')) scheduleHide();
  }, true);

  // ตามวิดีโอตอนเลื่อนหน้า/ย่อขยาย/เข้าออกเต็มจอ
  const follow = () => {
    if (host && host.style.display !== 'none' && currentVideo) place(currentVideo);
  };
  window.addEventListener('scroll', follow, { passive: true, capture: true });
  window.addEventListener('resize', follow, { passive: true });
  document.addEventListener('fullscreenchange', follow);

  // ร่องรอยว่าสคริปต์นี้ทำงานอยู่บนหน้านี้จริง · ไว้ตรวจตอนไล่ปัญหาว่า "ส่วนขยายโหลดขึ้นไหม"
  try {
    document.documentElement.dataset.newkewi = '2';
  } catch (e) { /* หน้าแปลกๆ ที่แตะ dataset ไม่ได้ */ }
})();
