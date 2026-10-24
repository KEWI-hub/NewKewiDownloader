// เมนูของส่วนขยาย · บอกสถานะการเชื่อมต่อกับแอป และลิสต์วิดีโอที่ดักได้ในแท็บนี้

const stateBox = document.getElementById('state');
const actions = document.getElementById('actions');
const list = document.getElementById('list');
const empty = document.getElementById('empty');

function setState(kind, text) {
  stateBox.className = 'state ' + kind;
  stateBox.textContent = text;
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshState() {
  const status = await chrome.runtime.sendMessage({ type: 'status' });
  actions.innerHTML = '';

  if (status.state === 'ready') {
    setState('ok', `ต่อกับแอปแล้ว (รุ่น ${status.info.version})`);
    return true;
  }

  if (status.state === 'needs-pairing') {
    setState('warn', 'ยังไม่ได้จับคู่กับแอป — กดปุ่มข้างล่างแล้วไปกดอนุญาตในหน้าต่างแอป');

    const button = document.createElement('button');
    button.textContent = 'จับคู่กับแอป';
    button.addEventListener('click', async () => {
      button.disabled = true;
      const answer = await chrome.runtime.sendMessage({ type: 'pair' });
      if (answer.ok) await refreshState();
      else {
        setState('bad', answer.reason || 'จับคู่ไม่สำเร็จ');
        button.disabled = false;
      }
    });
    actions.appendChild(button);
    return false;
  }

  setState('bad', 'ติดต่อแอปไม่ได้ — เปิด New Kewi Video Downloader ไว้หรือยัง');
  return false;
}

async function refreshList() {
  const tab = await currentTab();
  const answer = await chrome.runtime.sendMessage({ type: 'qualities', tabId: tab.id });
  const items = (answer && answer.qualities) || [];

  list.innerHTML = '';
  empty.hidden = items.length > 0;

  for (const q of items) {
    const row = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = shortName(q.url);
    name.title = q.url;

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = q.label === 'auto' ? q.kind.toUpperCase() : q.label;

    const send = document.createElement('button');
    send.textContent = 'โหลด';
    send.addEventListener('click', () => sendOne(q, tab, send));

    row.append(name, tag, send);
    list.appendChild(row);
  }

  // ส่งทั้งหน้าให้แอปแกะเอง — ใช้ได้แม้ดักอะไรไม่เจอเลย
  const row = document.createElement('li');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = 'ส่งทั้งหน้านี้ให้แอปแกะเอง';

  const send = document.createElement('button');
  send.className = 'ghost';
  send.textContent = 'ส่ง';
  send.addEventListener('click', () =>
    sendOne({ url: tab.url, kind: 'page', height: 0 }, tab, send));

  row.append(name, send);
  list.appendChild(row);
}

async function sendOne(q, tab, button) {
  button.disabled = true;
  button.textContent = 'กำลังส่ง…';

  const payload = {
    url: q.url,
    kind: q.kind,
    height: q.height || 0,
    title: (tab.title || '').slice(0, 150),
    pageUrl: tab.url,
    referer: tab.url,
    headers: { Referer: tab.url },
  };

  let answer = await chrome.runtime.sendMessage({ type: 'send', payload });

  if (!answer.ok && String(answer.reason || '').includes('จับคู่')) {
    const paired = await chrome.runtime.sendMessage({ type: 'pair' });
    if (paired.ok) answer = await chrome.runtime.sendMessage({ type: 'send', payload });
  }

  button.textContent = answer.ok ? 'ส่งแล้ว ✓' : 'ไม่สำเร็จ';
  if (!answer.ok) {
    setState('bad', answer.reason || 'ส่งไม่สำเร็จ');
    button.disabled = false;
    button.textContent = 'ลองใหม่';
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

(async () => {
  await refreshState();
  await refreshList();
})();
