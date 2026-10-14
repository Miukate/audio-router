// ============================================================
//  Audio Device Router — popup.js
// ============================================================

const tabDeviceSel    = document.getElementById('tabDevice');
const globalDeviceSel = document.getElementById('globalDevice');
const statusEl        = document.getElementById('status');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isErr ? '#e66' : '#6c6';
}

// -------- ping / ensureOffscreen --------
function pingOnce(timeoutMs) {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(false); } }, timeoutMs);
    try {
      chrome.runtime.sendMessage({ target: 'offscreen', action: 'ping' }, (r) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (chrome.runtime.lastError) resolve(false);
        else resolve(!!(r && r.ok));
      });
    } catch (_) {
      if (!done) { done = true; clearTimeout(t); resolve(false); }
    }
  });
}

async function waitForOffscreen(maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await pingOnce(300)) return true;
    await sleep(80);
  }
  return false;
}

async function ensureOffscreen() {
  // Уже существует?
  let exists = false;
  try {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    exists = ctxs.length > 0;
  } catch (_) {}

  if (exists) {
    if (await waitForOffscreen(700)) return true;
    // Существует но не отвечает — снести
    try { await chrome.offscreen.closeDocument(); } catch (_) {}
    await sleep(200);
  }

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Route tab audio to selected output device'
    });
  } catch (e) {
    const m = String(e && e.message || e);
    if (!m.includes('Only a single offscreen')) throw new Error('createDocument: ' + m);
  }

  if (!(await waitForOffscreen(3000))) {
    throw new Error('Offscreen не отвечает. Открой Inspect views: offscreen.html');
  }
  return true;
}

// -------- запрос к offscreen --------
function sendOffscreen(msg, timeoutMs = 6000) {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve({ error: 'timeout' }); } }, timeoutMs);
    try {
      chrome.runtime.sendMessage({ target: 'offscreen', ...msg }, (r) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
        else resolve(r || { ok: true });
      });
    } catch (e) {
      if (!done) { done = true; clearTimeout(t); resolve({ error: String(e) }); }
    }
  });
}

// -------- устройства --------
async function getOutputDevices() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
  } catch (e) {
    console.warn('[Popup] mic:', e);
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(d => d.kind === 'audiooutput' && d.deviceId);
}

function fillSelect(sel, devices, selectedId) {
  sel.innerHTML = '';
  const def = document.createElement('option');
  def.value = 'default';
  def.textContent = 'Выбрать';
  sel.appendChild(def);

  devices.forEach(d => {
    if (d.deviceId === 'default') return;
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || ('Устройство ' + d.deviceId.slice(0, 8));
    sel.appendChild(o);
  });

  if (selectedId) sel.value = selectedId;
}

async function init() {
  setStatus('Загрузка...');
  const devices = await getOutputDevices();
  const saved = await chrome.storage.local.get(['globalDeviceId']);
  const globalId = saved.globalDeviceId || 'default';

  fillSelect(tabDeviceSel, devices, 'default');
  fillSelect(globalDeviceSel, devices, globalId);

  setStatus('Готовлю offscreen...');
  try {
    await ensureOffscreen();
    setStatus('Найдено устройств: ' + devices.length);
  } catch (e) {
    setStatus(e.message, true);
  }
}

// -------- apply / stop для вкладки --------
document.getElementById('applyTab').addEventListener('click', async () => {
  const deviceId = tabDeviceSel.value;
  setStatus('Захватываю...');

  try { await ensureOffscreen(); }
  catch (e) { setStatus(e.message, true); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { setStatus('Нет активной вкладки', true); return; }

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (e) {
    setStatus('tabCapture: ' + (e.message || e), true);
    return;
  }

  const res = await sendOffscreen({ action: 'startCapture', streamId, tabId: tab.id, deviceId });
  if (res.error) { setStatus('Ошибка: ' + res.error, true); return; }
  setStatus('✓ Применено к вкладке');
});

document.getElementById('stopTab').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const res = await sendOffscreen({ action: 'stopCapture', tabId: tab.id });
  if (res.error) { setStatus('Ошибка: ' + res.error, true); return; }
  setStatus('✓ Остановлено');
});

// -------- apply / stop для всех --------
document.getElementById('applyGlobal').addEventListener('click', async () => {
  const deviceId = globalDeviceSel.value;
  await chrome.storage.local.set({ globalDeviceId: deviceId });

  setStatus('Применяю...');
  try { await ensureOffscreen(); }
  catch (e) { setStatus(e.message, true); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { setStatus('Нет активной вкладки', true); return; }

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (e) {
    setStatus('tabCapture: ' + (e.message || e), true);
    return;
  }

  const res = await sendOffscreen({ action: 'startCapture', streamId, tabId: tab.id, deviceId });
  if (res.error) { setStatus('Ошибка: ' + res.error, true); return; }
  setStatus('✓ Применено. Другие вкладки — открой попап там.');
});

document.getElementById('stopGlobal').addEventListener('click', async () => {
  await chrome.storage.local.set({ globalDeviceId: 'default' });
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    await sendOffscreen({ action: 'stopCapture', tabId: t.id }, 2000).catch(() => {});
  }
  globalDeviceSel.value = 'default';
  setStatus('✓ Всё остановлено');
});

init();