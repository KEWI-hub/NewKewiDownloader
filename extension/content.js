// แผงลอยเหนือตัวเล่นวิดีโอ แบบที่ IDM ทำ
//
// แผงอยู่ใน shadow root เพื่อให้ CSS ของเว็บเจ้าบ้านเอื้อมมาทับไม่ได้
// (เว็บดูวิดีโอชอบใส่กฎแรงๆ แบบ * { ... !important } ซึ่งจะทำให้แผงเพี้ยนทันที)

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
    button {
      font: inherit; cursor: pointer;
      border: 0; border-radius: 6px; padding: 5px 11px;
      background: #2997FF; color: #fff;
    }
    button:hover { background: #1b86ea; }
    button:disabled { opacity: .55; cursor: default; }
    select {
      font: inherit; cursor: pointer;
      border: 1px solid rgba(255,255,255,.25); border-radius: 6px;
      padding: 4px 6px; max-width: 150px;
      background: rgba(255,255,255,.1); color: #fff;
    }
    select option { color: #111; }
    .msg { font-size: 12px; opacity: .85; max-width: 240px; }
    .msg.bad { color: #ff9f9f; }
  `;

  let host = null;
  let shadow = null;
  let currentVideo = null;
  let hideTimer = 0;
  let loadedFor = null;

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
      <select class="pick"><option value="">กำลังหาวิดีโอ…</option></select>
      <button class="go" disabled>โหลด</button>
      <span class="msg"></span>
    `;

    box.querySelector('.bird').src = chrome.runtime.getURL('icons/icon48.png');
    box.querySelector('.go').addEventListener('click', onDownload);

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
      if (host) host.style.display = 'none';
    }, 600);
  }

  // ---------- รายการความชัด ----------

  async function loadQualities(video) {
    const pick = el('.pick');
    const go = el('.go');
    const key = location.href;

    if (loadedFor === key && pick.options.length > 1) return;
    loadedFor = key;

    pick.innerHTML = '<option value="">กำลังหาวิดีโอ…</option>';
    go.disabled = true;

    const answer = await chrome.runtime.sendMessage({ type: 'qualities' }).catch(() => null);
    const list = (answer && answer.qualities) || [];

    pick.innerHTML = '';

    for (const q of list) {
      const option = document.createElement('option');
      option.value = JSON.stringify(q);
      option.textContent = q.label === 'auto'
        ? shortName(q.url)
        : `${q.label} · ${q.kind.toUpperCase()}`;
      pick.appendChild(option);
    }

    // มีให้เลือกเสมอ — ถึงดักไม่เจออะไร แอปก็ยังแกะหน้าเว็บเองได้
    const page = document.createElement('option');
    page.value = JSON.stringify({ url: location.href, kind: 'page', height: 0, label: 'page' });
    page.textContent = list.length > 0 ? 'ส่งทั้งหน้าให้แอปแกะเอง' : 'ไม่เจอลิงก์ตรงๆ — ส่งทั้งหน้าให้แอป';
    pick.appendChild(page);

    go.disabled = false;
    message('');
  }

  function shortName(url) {
    try {
      const u = new URL(url);
      return u.pathname.split('/').pop() || u.hostname;
    } catch (e) {
      return url.slice(0, 40);
    }
  }

  function message(text, bad) {
    const msg = el('.msg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = bad ? 'msg bad' : 'msg';
  }

  // ---------- ส่งเข้าแอป ----------

  async function onDownload() {
    const pick = el('.pick');
    const go = el('.go');
    if (!pick.value) return;

    const chosen = JSON.parse(pick.value);
    go.disabled = true;
    message('กำลังส่ง…');

    const payload = {
      url: chosen.url,
      kind: chosen.kind,
      height: chosen.height || 0,
      title: (document.title || '').trim().slice(0, 150),
      pageUrl: location.href,
      referer: location.href,
      headers: { Referer: location.href },
    };

    let answer = await chrome.runtime.sendMessage({ type: 'send', payload }).catch(() => null);

    // ยังไม่เคยจับคู่ → ขอจับคู่แล้วลองส่งอีกรอบ
    if (answer && !answer.ok && String(answer.reason || '').includes('จับคู่')) {
      message('กำลังขออนุญาตจากแอป…');
      const paired = await chrome.runtime.sendMessage({ type: 'pair' }).catch(() => null);
      if (paired && paired.ok) {
        answer = await chrome.runtime.sendMessage({ type: 'send', payload }).catch(() => null);
      } else {
        answer = { ok: false, reason: (paired && paired.reason) || 'จับคู่ไม่สำเร็จ' };
      }
    }

    if (answer && answer.ok) {
      message('ส่งเข้าคิวแล้ว ✓');
      setTimeout(() => message(''), 3000);
    } else {
      message((answer && answer.reason) || 'ส่งไม่สำเร็จ', true);
    }

    go.disabled = false;
  }

  // ---------- จับการเอาเมาส์ไปวางบนวิดีโอ ----------

  function onPointerOver(e) {
    const video = e.target instanceof Element ? e.target.closest('video') : null;
    if (!video) return;

    build();
    currentVideo = video;
    clearTimeout(hideTimer);

    if (!place(video)) return;
    loadQualities(video);
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
    document.documentElement.dataset.newkewi = '1';
  } catch (e) { /* หน้าแปลกๆ ที่แตะ dataset ไม่ได้ */ }
})();
