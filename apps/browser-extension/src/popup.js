const ids = ['enabled', 'apiUrl', 'captureUser', 'captureAssistant', 'captureUnknown', 'clientRedaction'];
const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const lastStatus = document.getElementById('lastStatus');
const recentEl = document.getElementById('recent');
const captureSelection = document.getElementById('captureSelection');
const scanNow = document.getElementById('scanNow');

init();

async function init() {
  const status = await chrome.runtime.sendMessage({ type: 'evomate:get-status' });
  applyConfig(status.config || {});
  renderStatus(status);

  els.enabled.addEventListener('change', () => savePatch({ enabled: els.enabled.checked }));
  ['captureUser', 'captureAssistant', 'captureUnknown', 'clientRedaction'].forEach((id) => {
    els[id].addEventListener('change', () => savePatch({ [id]: els[id].checked }));
  });
  els.apiUrl.addEventListener('change', () => savePatch({ apiUrl: els.apiUrl.value }));

  captureSelection.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const reply = await chrome.runtime.sendMessage({ type: 'evomate:capture-selection', tabId: tab?.id, url: tab?.url });
    renderStatus({ lastReceipt: reply, recent: (await chrome.runtime.sendMessage({ type: 'evomate:get-status' })).recent });
  });

  scanNow.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'evomate:scan-now' }).catch((error) => ({ ok: false, error: String(error?.message || error) }));
    renderStatus({ lastReceipt: reply, recent: (await chrome.runtime.sendMessage({ type: 'evomate:get-status' })).recent });
  });
}

async function savePatch(patch) {
  const reply = await chrome.runtime.sendMessage({ type: 'evomate:set-config', patch });
  applyConfig(reply.config || {});
}

function applyConfig(config) {
  els.enabled.checked = config.enabled !== false;
  els.apiUrl.value = config.apiUrl || '';
  els.captureUser.checked = config.captureUser !== false;
  els.captureAssistant.checked = config.captureAssistant !== false;
  els.captureUnknown.checked = config.captureUnknown === true;
  els.clientRedaction.checked = config.clientRedaction !== false;
}

function renderStatus(status) {
  const receipt = status.lastReceipt || status;
  lastStatus.textContent = receipt?.ok ? `${receipt.status || 'ok'} · ${receipt.count || 0} sent` : (receipt?.error || 'waiting');
  const recent = status.recent || [];
  recentEl.innerHTML = recent.slice(0, 6).map((item) => `
    <div class="item">
      <p class="meta">${escapeHtml(item.eventKind || 'event')} · ${escapeHtml(item.source || 'browser')}</p>
      <p>${escapeHtml(item.contentPreview || '')}</p>
    </div>
  `).join('') || '<div class="item"><p>等待网页消息。</p></div>';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}
