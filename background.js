// MV3 service worker: inject page-inject.js into MAIN world to bypass CSP
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'inject-page-script') return; // ignore others
  try {
    const tabId = sender.tab && sender.tab.id;
    const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'No tabId in sender' });
      return; // no async
    }
    try { console.debug('[SoraAutoplay] injecting page-inject.js via MAIN world', { tabId, frameId }); } catch {}
    chrome.scripting.executeScript(
      {
        target: { tabId, frameIds: [frameId] },
        files: ['page-inject.js'],
        world: 'MAIN'
      },
      () => {
        const err = chrome.runtime.lastError;
        try { console.debug('[SoraAutoplay] injection result', err ? ('ERROR: ' + err.message) : 'OK'); } catch {}
        sendResponse({ ok: !err, error: err && err.message });
      }
    );
    return true; // async response
  } catch (e) {
    try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch {}
  }
});
