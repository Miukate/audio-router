console.log('[OFF] loaded');

const captures = new Map();

// Регистрируем listener СРАЗУ и синхронно — до всего остального
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;

  if (msg.action === 'ping') {
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'startCapture') {
    startCapture(msg.streamId, msg.tabId, msg.deviceId)
      .then(r => sendResponse(r))
      .catch(e => {
        console.error('[OFF] start error:', e);
        sendResponse({ error: String(e && e.message || e) });
      });
    return true;
  }

  if (msg.action === 'stopCapture') {
    stopCapture(msg.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ error: String(e && e.message || e) }));
    return true;
  }
});

async function startCapture(streamId, tabId, deviceId) {
  if (captures.has(tabId)) await stopCapture(tabId);
  console.log('[OFF] getUserMedia streamId=', streamId);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  const ctx = new AudioContext();
  console.log('[OFF] ctx state=', ctx.state, 'setSinkId=', typeof ctx.setSinkId);

  if (deviceId && deviceId !== 'default' && typeof ctx.setSinkId === 'function') {
    try {
      await ctx.setSinkId(deviceId);
      console.log('[OFF] sinkId=', deviceId);
    } catch (e) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('setSinkId: ' + (e.message || e));
    }
  }

  const source = ctx.createMediaStreamSource(stream);
  source.connect(ctx.destination);
  captures.set(tabId, { stream, ctx, source });
  console.log('[OFF] started tab', tabId);
  return { ok: true };
}

async function stopCapture(tabId) {
  const c = captures.get(tabId);
  if (!c) return { ok: true };
  try {
    c.stream.getTracks().forEach(t => t.stop());
    c.source.disconnect();
    await c.ctx.close();
  } catch (e) { console.warn(e); }
  captures.delete(tabId);
  console.log('[OFF] stopped tab', tabId);
  return { ok: true };
}