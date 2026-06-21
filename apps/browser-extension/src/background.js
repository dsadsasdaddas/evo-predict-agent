const PROTOCOL_VERSION = 'evomate.hook.v1';
const DEFAULT_API_URL = 'https://evomate.yueanlab.com/api/hook-events';
const MAX_RECENT = 24;

const defaultConfig = {
  enabled: true,
  apiUrl: DEFAULT_API_URL,
  injectAdvisor: false,
  captureAssistant: true,
  captureUser: true,
  captureUnknown: false,
  minChars: 12,
  maxChars: 6000,
  clientRedaction: true
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['evomateConfig']);
  const config = { ...defaultConfig, ...(stored.evomateConfig || {}) };
  if (!stored.evomateConfig) {
    await chrome.storage.local.set({ evomateConfig: config, evomateRecent: [] });
  }
  await setBadge(config.enabled ? 'on' : 'off');
});

chrome.runtime.onStartup?.addListener(async () => {
  const config = await getConfig();
  await setBadge(config.enabled ? 'on' : 'off');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleRuntimeMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== 'capture-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await captureSelectionFromTab(tab.id, tab.url || '');
});

async function handleRuntimeMessage(message, sender) {
  if (!message || typeof message !== 'object') return { ok: false, error: 'invalid_message' };

  if (message.type === 'evomate:get-config') {
    return { ok: true, config: await getConfig() };
  }

  if (message.type === 'evomate:set-config') {
    const nextConfig = { ...(await getConfig()), ...(message.patch || {}) };
    if (typeof nextConfig.apiUrl === 'string') nextConfig.apiUrl = normalizeApiUrl(nextConfig.apiUrl);
    await chrome.storage.local.set({ evomateConfig: nextConfig });
    await setBadge(nextConfig.enabled ? 'on' : 'off');
    await broadcastConfig(nextConfig);
    return { ok: true, config: nextConfig };
  }

  if (message.type === 'evomate:get-status') {
    const data = await chrome.storage.local.get(['evomateRecent', 'evomateLastReceipt']);
    return { ok: true, config: await getConfig(), recent: data.evomateRecent || [], lastReceipt: data.evomateLastReceipt || null };
  }

  if (message.type === 'evomate:hook-events') {
    const config = await getConfig();
    if (!config.enabled) return { ok: true, skipped: true, reason: 'disabled' };
    const events = normalizeEvents(message.events || message.event, sender, config);
    if (!events.length) return { ok: true, skipped: true, reason: 'no_events' };
    return await postHookEvents(events, config);
  }

  if (message.type === 'evomate:advisor-prepare') {
    const config = await getConfig();
    if (!config.enabled || config.injectAdvisor === false) return { ok: true, skipped: true, reason: 'advisor_injection_disabled' };
    return await prepareAdvisor(message, config);
  }

  if (message.type === 'evomate:capture-selection') {
    const tabId = message.tabId || sender.tab?.id;
    const tabUrl = message.url || sender.tab?.url || '';
    if (!tabId) return { ok: false, error: 'tab_required' };
    return await captureSelectionFromTab(tabId, tabUrl);
  }

  return { ok: false, error: 'unknown_message_type' };
}

async function prepareAdvisor(message, config) {
  const input = String(message.input || '').trim();
  if (!input) return { ok: false, error: 'input_required' };
  const advisorUrl = advisorUrlFromHookUrl(config.apiUrl || DEFAULT_API_URL);
  await setBadge('send');
  try {
    const response = await fetch(advisorUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input,
        source: message.source || 'browser-extension',
        event: 'browser_advisor_request',
        workspace: message.workspace,
        sessionId: message.sessionId,
        metadata: {
          provider: message.provider,
          pageTitle: message.pageTitle,
          url: message.url,
          injection: 'prompt_prefix'
        }
      })
    });
    const body = await response.json().catch(() => ({}));
    await setBadge(response.ok ? 'ok' : 'err');
    return { ok: response.ok, status: response.status, advisorUrl, ...body };
  } catch (error) {
    await setBadge('err');
    return { ok: false, status: 0, advisorUrl, error: String(error?.message || error) };
  }
}

async function captureSelectionFromTab(tabId, tabUrl) {
  const config = await getConfig();
  if (!config.enabled) return { ok: true, skipped: true, reason: 'disabled' };
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      selection: String(window.getSelection?.().toString() || '').trim(),
      title: document.title,
      url: location.href,
      host: location.hostname
    })
  });
  const payload = result?.result || {};
  if (!payload.selection) return { ok: false, error: 'selection_empty' };
  const event = createHookEvent({
    source: `browser-extension:${detectProvider(payload.host || tabUrl)}`,
    eventKind: 'copy',
    direction: 'feedback',
    content: payload.selection,
    url: payload.url || tabUrl,
    metadata: {
      provider: detectProvider(payload.host || tabUrl),
      pageTitle: payload.title,
      captureMode: 'manual_selection',
      textHash: hashText(payload.selection)
    },
    privacy: { consent: true, redaction: config.clientRedaction ? 'client' : 'none', pii: 'possible', retention: 'short' },
    outcome: 'accepted',
    score: 0.78,
    signals: ['browser_extension', 'manual_capture', 'selected_text']
  }, config);
  return await postHookEvents([event], config);
}

async function getConfig() {
  const stored = await chrome.storage.local.get(['evomateConfig']);
  return { ...defaultConfig, ...(stored.evomateConfig || {}) };
}

function normalizeEvents(input, sender, config) {
  const rawEvents = Array.isArray(input) ? input : input ? [input] : [];
  return rawEvents
    .filter((event) => event && typeof event === 'object')
    .map((event) => createHookEvent({
      ...event,
      url: event.url || sender.tab?.url,
      metadata: {
        ...(event.metadata || {}),
        senderTabId: sender.tab?.id,
        senderFrameId: sender.frameId
      }
    }, config))
    .filter((event) => typeof event.content === 'string' ? event.content.trim().length >= Number(config.minChars || 12) : true);
}

function createHookEvent(event, config) {
  const content = typeof event.content === 'string'
    ? trimToLimit(config.clientRedaction ? redactText(event.content) : event.content, Number(config.maxChars || 6000))
    : event.content;
  return {
    protocolVersion: PROTOCOL_VERSION,
    source: event.source || 'browser-extension',
    channel: 'browser-extension',
    event: event.event || `browser_${event.eventKind || 'message'}`,
    eventKind: event.eventKind || 'assistant_message',
    direction: event.direction || inferDirection(event.eventKind),
    content,
    sessionId: event.sessionId,
    url: event.url,
    device: 'web',
    app: 'browser-extension',
    appVersion: chrome.runtime.getManifest().version,
    occurredAt: event.occurredAt || new Date().toISOString(),
    metadata: event.metadata || {},
    privacy: event.privacy || { consent: true, redaction: config.clientRedaction ? 'client' : 'none', pii: 'possible', retention: 'short' },
    outcome: event.outcome,
    kind: event.kind,
    score: event.score,
    geneId: event.geneId,
    signals: event.signals || ['browser_extension', 'web_chat']
  };
}

async function postHookEvents(events, config) {
  const apiUrl = normalizeApiUrl(config.apiUrl || DEFAULT_API_URL);
  await setBadge('send');
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events })
    });
    const body = await response.json().catch(() => ({}));
    const receipt = {
      ok: response.ok,
      status: response.status,
      at: new Date().toISOString(),
      count: events.length,
      apiUrl,
      body
    };
    await rememberReceipt(receipt, events);
    if (response.ok) await broadcastHookCaptured(receipt, events);
    await setBadge(response.ok ? 'ok' : 'err');
    return receipt;
  } catch (error) {
    const receipt = { ok: false, status: 0, at: new Date().toISOString(), count: events.length, apiUrl, error: String(error?.message || error) };
    await rememberReceipt(receipt, events);
    await setBadge('err');
    return receipt;
  }
}


async function broadcastHookCaptured(receipt, events) {
  const tabs = await chrome.tabs.query({});
  const message = {
    type: 'evomate:hook-captured-broadcast',
    receipt: sanitizeForMessage(receipt),
    events: events.map((event) => ({
      source: event.source,
      eventKind: event.eventKind,
      direction: event.direction,
      url: event.url,
      occurredAt: event.occurredAt,
      contentPreview: preview(event.content || ''),
      metadata: {
        provider: event.metadata?.provider,
        captureMode: event.metadata?.captureMode,
        role: event.metadata?.role,
        textHash: event.metadata?.textHash
      }
    }))
  };
  await Promise.allSettled(tabs.map((tab) => tab.id ? chrome.tabs.sendMessage(tab.id, message) : Promise.resolve()));
}

function sanitizeForMessage(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ok: Boolean(value?.ok), status: value?.status, at: value?.at, count: value?.count };
  }
}

async function rememberReceipt(receipt, events) {
  const stored = await chrome.storage.local.get(['evomateRecent']);
  const recent = [
    ...events.map((event) => ({
      at: receipt.at,
      status: receipt.status,
      ok: receipt.ok,
      eventKind: event.eventKind,
      source: event.source,
      url: event.url,
      contentPreview: preview(event.content || ''),
      hash: event.metadata?.textHash || hashText(event.content || '')
    })),
    ...(stored.evomateRecent || [])
  ].slice(0, MAX_RECENT);
  await chrome.storage.local.set({ evomateRecent: recent, evomateLastReceipt: receipt });
}

async function broadcastConfig(config) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((tab) => tab.id ? chrome.tabs.sendMessage(tab.id, { type: 'evomate:config-updated', config }) : Promise.resolve()));
}

async function setBadge(state) {
  const map = {
    on: { text: 'ON', color: '#16a34a' },
    off: { text: 'OFF', color: '#52525b' },
    send: { text: '↗', color: '#0ea5e9' },
    ok: { text: '✓', color: '#22c55e' },
    err: { text: '!', color: '#ef4444' }
  };
  const next = map[state] || map.on;
  await chrome.action.setBadgeText({ text: next.text });
  await chrome.action.setBadgeBackgroundColor({ color: next.color });
}

function inferDirection(eventKind) {
  if (eventKind === 'user_message' || eventKind === 'advisor_request') return 'inbound';
  if (eventKind === 'feedback' || eventKind === 'copy' || eventKind === 'regenerate' || eventKind === 'stop') return 'feedback';
  return 'outbound';
}

function normalizeApiUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return DEFAULT_API_URL;
  return trimmed.endsWith('/api/hook-events') ? trimmed : `${trimmed.replace(/\/+$/, '')}/api/hook-events`;
}

function advisorUrlFromHookUrl(value) {
  return normalizeApiUrl(value).replace(/\/api\/hook-events$/, '/api/advisor/prepare');
}

function detectProvider(value) {
  const host = String(value || '').toLowerCase();
  if (host.includes('chatgpt')) return 'chatgpt';
  if (host.includes('claude')) return 'claude';
  if (host.includes('gemini') || host.includes('aistudio.google')) return 'gemini';
  if (host.includes('doubao')) return 'doubao';
  if (host.includes('perplexity')) return 'perplexity';
  if (host.includes('poe.com')) return 'poe';
  if (host.includes('localhost') || host.includes('127.0.0.1')) return 'local_web';
  return 'generic_web_ai';
}

function redactText(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-[REDACTED]')
    .replace(/sk-evomap-[A-Za-z0-9_-]{16,}/g, 'sk-evomap-[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email-redacted]')
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[phone-redacted]');
}

function trimToLimit(text, limit) {
  const value = String(text || '').trim();
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function preview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function hashText(text) {
  let hash = 2166136261;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
