// ============================================================
//  Audio Device Router — background.js
// ============================================================

chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    chrome.runtime.sendMessage(
      { target: 'offscreen', action: 'stopCapture', tabId },
      () => { void chrome.runtime.lastError; }
    );
  } catch (_) {}
});