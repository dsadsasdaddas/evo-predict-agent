(() => {
  const PROTOCOL_VERSION = 'evomate.hook.v1';
  const SESSION_KEY = 'evomate.webHook.sessionId';
  const SEEN_KEY = 'evomate.webHook.seenHashes';
  const MAX_SEEN = 260;
  const MAX_BATCH = 6;
  const SCAN_DEBOUNCE_MS = 900;
  const RESCAN_MS = 8000;

  let config = null;
  let observer = null;
  let scanTimer = 0;
  let lastUrl = location.href;
  let seen = loadSeen();
  let latestPromptDraft = { text: '', at: 0, selector: '' };
  const provider = detectProvider(location.hostname);
  const sessionId = getSessionId();

  init();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'evomate:hook-captured-broadcast') {
      window.dispatchEvent(new CustomEvent('evomate-hook-captured', {
        detail: { receipt: message.receipt, events: message.events }
      }));
      pulseBadge('ok');
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === 'evomate:config-updated') {
      config = message.config;
      updateBadge();
      scheduleScan('config_updated');
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === 'evomate:scan-now') {
      scan('manual_rescan').then(sendResponse);
      return true;
    }

    if (message?.type === 'evomate:capture-selection-from-content') {
      captureSelection().then(sendResponse);
      return true;
    }

    return false;
  });

  async function init() {
    const reply = await chrome.runtime.sendMessage({ type: 'evomate:get-config' }).catch(() => null);
    config = reply?.config || { enabled: true, captureAssistant: true, captureUser: true, captureUnknown: false, minChars: 12, maxChars: 6000, clientRedaction: true };
    mountBadge();
    startObserver();
    installInputHooks();
    scheduleScan('init');
    window.setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleScan('url_changed');
      } else {
        scheduleScan('interval');
      }
    }, RESCAN_MS);
  }

  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver((mutations) => {
      if (!config?.enabled) return;
      if (mutations.some((mutation) => mutation.addedNodes?.length || mutation.type === 'characterData')) {
        scheduleScan('dom_mutation');
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function scheduleScan(reason) {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => scan(reason), SCAN_DEBOUNCE_MS);
  }

  async function scan(reason) {
    if (!config?.enabled) return { ok: true, skipped: true, reason: 'disabled' };
    const candidates = extractMessages();
    const events = [];
    for (const item of candidates) {
      if (!shouldCaptureRole(item.role)) continue;
      const text = item.text.trim();
      if (text.length < minCharsFor(item.role, reason)) continue;
      if (isNoise(text, { role: item.role, captureMode: 'auto_dom' })) continue;
      const hash = hashText([provider, item.role, normalizeTextForHash(text)].join('\n'));
      if (seen.has(hash)) continue;
      seen.add(hash);
      events.push(toHookEvent(item, text, hash, reason));
      if (events.length >= MAX_BATCH) break;
    }

    persistSeen();
    if (!events.length) return { ok: true, skipped: true, reason: 'no_new_messages' };

    pulseBadge('send');
    const receipt = await chrome.runtime.sendMessage({ type: 'evomate:hook-events', events }).catch((error) => ({ ok: false, error: String(error) }));
    pulseBadge(receipt?.ok ? 'ok' : 'err');
    return receipt;
  }


  function installInputHooks() {
    document.addEventListener('input', rememberPromptDraftFromEvent, true);
    document.addEventListener('keyup', rememberPromptDraftFromEvent, true);
    document.addEventListener('paste', () => window.setTimeout(() => rememberPromptDraftFromElement(findActivePromptInput(), 'paste'), 0), true);

    document.addEventListener('keydown', (event) => {
      rememberPromptDraftFromEvent(event);
      if (!config?.enabled || event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      const editable = findActivePromptInput();
      const text = readInputText(editable) || freshDraftText();
      if (!isCapturablePromptText(text)) return;
      capturePromptText(text, 'input_enter', editable);
    }, true);

    ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
      document.addEventListener(eventName, (event) => {
        rememberPromptDraftFromEvent(event);
        if (!config?.enabled) return;
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest('button,[role="button"]');
        if (!button || !isSendButton(button)) return;
        const editable = findActivePromptInput() || findNearestPromptInput(button);
        const text = readInputText(editable) || freshDraftText();
        if (!isCapturablePromptText(text)) return;
        capturePromptText(text, `send_${eventName}`, editable || button);
      }, true);
    });
  }

  function rememberPromptDraftFromEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const promptNode = path.find((node) => node instanceof HTMLElement && isPromptInput(node)) || findActivePromptInput();
    rememberPromptDraftFromElement(promptNode, event.type);
  }

  function rememberPromptDraftFromElement(node, reason) {
    const text = readInputText(node);
    if (!isCapturablePromptText(text, { allowShort: true })) return;
    latestPromptDraft = { text, at: Date.now(), selector: describeNode(node) || reason || 'prompt.input' };
  }

  function freshDraftText() {
    return Date.now() - latestPromptDraft.at < 15000 ? latestPromptDraft.text : '';
  }

  function isCapturablePromptText(text, options = {}) {
    const clean = cleanText(text);
    const minChars = options.allowShort ? 1 : minCharsFor('user', 'auto_input');
    if (!clean || clean.length < minChars) return false;
    return !isNoise(clean, { role: 'user', captureMode: 'auto_input' });
  }

  function capturePromptText(text, reason, node) {
    const clean = cleanText(text);
    const hash = hashText([provider, 'user', normalizeTextForHash(clean)].join('\n'));
    if (seen.has(hash)) return;
    seen.add(hash);
    persistSeen();
    const event = toHookEvent({ role: 'user', text: clean, selector: describeNode(node) || latestPromptDraft.selector || 'active.prompt.input' }, clean, hash, reason);
    event.metadata.captureMode = 'auto_input';
    event.signals = ['browser_extension', 'web_chat', `provider_${provider}`, 'role_user', 'input_hook'];
    chrome.runtime.sendMessage({ type: 'evomate:hook-events', events: [event] }).then((receipt) => {
      pulseBadge(receipt?.ok ? 'ok' : 'err');
    }).catch(() => pulseBadge('err'));
  }

  function findActivePromptInput() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && isPromptInput(active)) return active;
    return findNearestPromptInput(active instanceof Element ? active : document.body);
  }

  function findNearestPromptInput(anchor) {
    const root = anchor?.closest?.('main, form, [role="main"], body') || document;
    const selectors = [
      'textarea',
      'input[type="text"]',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '[aria-label*="prompt" i]',
      '[aria-label*="message" i]',
      '[aria-label*="enter" i]',
      '[aria-label*="ask" i]',
      '[aria-label*="输入" i]',
      '[aria-label*="消息" i]',
      '.ql-editor'
    ];
    for (const selector of selectors) {
      const candidates = Array.from(root.querySelectorAll?.(selector) || []).filter((node) => node instanceof HTMLElement && isPromptInput(node));
      const active = candidates.find((node) => node === document.activeElement || node.contains(document.activeElement));
      if (active) return active;
      const visible = candidates.filter(isVisible);
      if (visible.length) return visible[visible.length - 1];
    }
    return null;
  }

  function isPromptInput(node) {
    if (!(node instanceof HTMLElement)) return false;
    const tag = node.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') return node.getAttribute('type') === 'text' || !node.getAttribute('type');
    if (node.isContentEditable || node.getAttribute('contenteditable') === 'true') return true;
    if (node.getAttribute('role') === 'textbox') return true;
    const label = `${node.getAttribute('aria-label') || ''} ${node.getAttribute('placeholder') || ''}`.toLowerCase();
    return /prompt|message|ask|enter|输入|消息|提问/.test(label);
  }

  function readInputText(node) {
    if (!node) return '';
    if ('value' in node) return cleanText(node.value || '');
    return cleanText(node.innerText || node.textContent || '');
  }

  function isSendButton(button) {
    const signal = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.textContent || ''} ${button.className || ''}`.toLowerCase();
    return /send|submit|发送|提交|arrow_upward|send-button/.test(signal);
  }

  async function captureSelection() {
    const selected = String(window.getSelection?.().toString() || '').trim();
    if (!selected) return { ok: false, error: 'selection_empty' };
    const event = toHookEvent({ role: 'feedback', text: selected, selector: 'window.selection' }, selected, hashText(selected), 'manual_selection');
    event.eventKind = 'copy';
    event.direction = 'feedback';
    event.outcome = 'accepted';
    event.score = 0.78;
    event.signals = ['browser_extension', 'manual_selection', 'selected_text'];
    return await chrome.runtime.sendMessage({ type: 'evomate:hook-events', events: [event] }).catch((error) => ({ ok: false, error: String(error) }));
  }

  function extractMessages() {
    const nodes = providerExtractors(provider)();
    const seenLocal = new Set();
    const items = [];
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (!isVisible(node)) continue;
      const rawRole = inferRole(node);
      const text = cleanText(node.innerText || node.textContent || '');
      const role = rawRole === 'unknown' ? inferProviderFallbackRole(node, text) : rawRole;
      const key = `${role}:${text.slice(0, 180)}`;
      if (!text || seenLocal.has(key)) continue;
      seenLocal.add(key);
      items.push({ node, role, text, selector: describeNode(node) });
    }
    return dedupeNested(items).slice(-40);
  }

  function providerExtractors(name) {
    const generic = () => queryMany([
      '[data-message-author-role]',
      '[data-testid*="message" i]',
      '[data-testid*="conversation" i]',
      'main article',
      'main [role="article"]',
      'main .markdown',
      'main .prose',
      'main [class*="message" i]',
      'main [class*="conversation" i]'
    ]);

    const extractors = {
      chatgpt: () => queryMany([
        '[data-message-author-role]',
        '[data-testid^="conversation-turn"]',
        'main article',
        'main .markdown'
      ]),
      claude: () => queryMany([
        '[data-testid*="message" i]',
        '[data-testid="user-message"]',
        '.font-claude-message',
        'main [class*="message" i]'
      ]),
      gemini: () => uniqueNodes([
        ...queryMany([
          'user-query',
          'model-response',
          'message-content',
          '[class*="query-text" i]',
          '[class*="user-query" i]',
          '[class*="prompt" i]',
          '[class*="response" i]',
          '[class*="model-response" i]',
          '[class*="markdown" i]',
          '[class*="conversation-turn" i]',
          '[data-test-id*="query" i]',
          '[data-test-id*="response" i]',
          '[data-testid*="query" i]',
          '[data-testid*="response" i]',
          'main user-query',
          'main model-response',
          'main message-content',
          'main h1',
          'main h2',
          'main h3',
          'main [role="heading"]',
          'main [aria-level]',
          'main .markdown',
          'main [dir="ltr"]',
          'main [dir="auto"]',
          'main p',
          'main li',
          'main pre',
          'main code'
        ]),
        ...geminiTextBlocks()
      ]),
      doubao: () => queryMany([
        '[data-testid*="message" i]',
        '[class*="message" i]',
        '[class*="chat" i] [class*="bubble" i]',
        'main [class*="answer" i]'
      ]),
      perplexity: () => queryMany([
        '[data-testid*="thread" i]',
        '[class*="prose" i]',
        'main [class*="answer" i]',
        'main [class*="query" i]'
      ]),
      poe: () => queryMany([
        '[class*="Message" i]',
        '[class*="ChatMessage" i]',
        'main [class*="message" i]'
      ])
    };

    return extractors[name] || generic;
  }

  function queryMany(selectors) {
    const list = [];
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach((node) => list.push(node));
      } catch {
        // Ignore selectors unsupported by current page engine.
      }
    }
    return list;
  }

  function uniqueNodes(nodes) {
    return Array.from(new Set(nodes.filter(Boolean)));
  }

  function geminiTextBlocks() {
    if (provider !== 'gemini') return [];
    const root = document.querySelector('main') || document.body;
    return Array.from(root.querySelectorAll('h1,h2,h3,[role="heading"],[aria-level],article,section,div,p,li,pre,code'))
      .filter((node) => node instanceof HTMLElement && isVisible(node))
      .filter((node) => {
        if (node.matches('button,textarea,input,nav,header,footer,aside')) return false;
        if (node.querySelector('textarea,input,[contenteditable="true"]')) return false;
        const text = cleanText(node.innerText || node.textContent || '');
        if (!text) return false;
        if (/^(你说|you said|gemini 说|gemini said)/i.test(text)) return true;
        if (text.length >= 24 && !isLikelyNavigation(node, text)) return true;
        return false;
      })
      .slice(-80);
  }

  function dedupeNested(items) {
    const result = [];
    for (const item of items) {
      const containsExisting = result.some((existing) => existing.node.contains(item.node) && existing.text.includes(item.text));
      if (containsExisting) continue;
      for (let i = result.length - 1; i >= 0; i -= 1) {
        if (item.node.contains(result[i].node) && item.text.includes(result[i].text)) result.splice(i, 1);
      }
      result.push(item);
    }
    return result;
  }

  function inferRole(node) {
    const attrRole = node.getAttribute('data-message-author-role') || node.closest('[data-message-author-role]')?.getAttribute('data-message-author-role');
    if (attrRole === 'user') return 'user';
    if (attrRole === 'assistant') return 'assistant';

    const ownText = cleanText(node.innerText || node.textContent || '').toLowerCase();
    if (/^(你说|you said)/.test(ownText)) return 'user';
    if (/^(gemini 说|gemini said)/.test(ownText)) return 'assistant';

    const tagSignal = `${node.tagName || ''} ${node.closest('user-query') ? 'user-query' : ''} ${node.closest('model-response') ? 'model-response' : ''} ${node.closest('message-content') ? 'message-content' : ''}`.toLowerCase();
    if (/user-query/.test(tagSignal)) return 'user';
    if (/model-response|message-content/.test(tagSignal)) return 'assistant';

    const testId = `${node.getAttribute('data-testid') || ''} ${node.getAttribute('data-test-id') || ''} ${node.className || ''} ${node.closest('[data-testid]')?.getAttribute('data-testid') || ''} ${node.closest('[data-test-id]')?.getAttribute('data-test-id') || ''}`.toLowerCase();
    if (/user|human|query|prompt/.test(testId)) return 'user';
    if (/assistant|model|response|answer|markdown|prose|bot|claude|gemini/.test(testId)) return 'assistant';

    const rect = node.getBoundingClientRect();
    if (rect.left > window.innerWidth * 0.42 && node.innerText.length < 1500) return 'user';
    return 'unknown';
  }


  function inferProviderFallbackRole(node, text) {
    if (provider === 'gemini') {
      const signal = `${node.tagName || ''} ${node.className || ''} ${node.getAttribute('aria-label') || ''}`.toLowerCase();
      if (/query|prompt|user/.test(signal)) return 'user';
      if (/response|model|answer|markdown|message-content/.test(signal)) return 'assistant';
      if (text.length > 80 && !isLikelyNavigation(node, text)) return 'assistant';
    }
    return 'unknown';
  }

  function isLikelyNavigation(node, text) {
    const signal = `${node.getAttribute('role') || ''} ${node.tagName || ''} ${node.className || ''}`.toLowerCase();
    if (/button|menu|nav|sidebar|header|footer|tab/.test(signal)) return true;
    const normalized = normalizeTextForHash(text);
    return /^(gemini|new chat|settings|activity|help|upgrade|apps|extensions|privacy|terms)(\s|$)/i.test(normalized);
  }

  function shouldCaptureRole(role) {
    if (role === 'user') return config.captureUser !== false;
    if (role === 'assistant') return config.captureAssistant !== false;
    return config.captureUnknown === true;
  }

  function toHookEvent(item, text, hash, reason) {
    const role = item.role === 'user' ? 'user' : item.role === 'assistant' ? 'assistant' : 'assistant';
    const eventKind = role === 'user' ? 'user_message' : 'assistant_message';
    return {
      protocolVersion: PROTOCOL_VERSION,
      source: `browser-extension:${provider}`,
      channel: 'browser-extension',
      event: `web_chat_${role}`,
      eventKind,
      direction: role === 'user' ? 'inbound' : 'outbound',
      content: text,
      sessionId,
      url: location.href,
      device: 'web',
      app: 'browser-extension',
      occurredAt: new Date().toISOString(),
      metadata: {
        provider,
        pageTitle: document.title,
        captureMode: 'auto_dom',
        scanReason: reason,
        selector: item.selector,
        role: item.role,
        textHash: hash
      },
      privacy: { consent: true, redaction: config.clientRedaction ? 'client' : 'none', pii: 'possible', retention: 'short' },
      signals: ['browser_extension', 'web_chat', `provider_${provider}`, `role_${item.role}`]
    };
  }

  function mountBadge() {
    if (document.getElementById('evomate-web-hook-badge')) return;
    const badge = document.createElement('button');
    badge.id = 'evomate-web-hook-badge';
    badge.type = 'button';
    badge.textContent = 'EvoMate listening';
    badge.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:14px',
      'z-index:2147483647',
      'border:1px solid rgba(32,230,255,.32)',
      'border-radius:999px',
      'background:rgba(3,5,10,.74)',
      'backdrop-filter:blur(14px)',
      'box-shadow:0 10px 40px rgba(0,0,0,.28)',
      'color:#8dffcc',
      'font:600 12px/1 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
      'letter-spacing:.01em',
      'padding:9px 12px',
      'cursor:pointer'
    ].join(';');
    badge.addEventListener('click', () => captureSelection().then((reply) => pulseBadge(reply?.ok ? 'ok' : 'err')));
    document.documentElement.appendChild(badge);
    updateBadge();
  }

  function updateBadge() {
    const badge = document.getElementById('evomate-web-hook-badge');
    if (!badge) return;
    badge.textContent = config?.enabled ? `EvoMate · ${provider}` : 'EvoMate paused';
    badge.style.opacity = config?.enabled ? '1' : '.46';
  }

  function pulseBadge(state) {
    const badge = document.getElementById('evomate-web-hook-badge');
    if (!badge) return;
    const labels = { send: 'EvoMate sending…', ok: 'EvoMate captured ✓', err: 'EvoMate failed !' };
    const colors = { send: '#20e6ff', ok: '#8dffcc', err: '#ff8b8b' };
    const old = badge.textContent;
    badge.textContent = labels[state] || old;
    badge.style.color = colors[state] || '#8dffcc';
    window.setTimeout(() => {
      badge.style.color = '#8dffcc';
      updateBadge();
    }, 1700);
  }

  function getSessionId() {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = `web_${provider}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  }

  function loadSeen() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]');
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  }

  function persistSeen() {
    if (seen.size > MAX_SEEN) seen = new Set(Array.from(seen).slice(-MAX_SEEN));
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen)));
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return rect.width > 24 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function cleanText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function normalizeTextForHash(text) {
    return cleanText(text).toLowerCase().replace(/\s+/g, ' ').slice(0, 3000);
  }

  function minCharsFor(role, reason) {
    if (role === 'user' && /input|send|manual/.test(String(reason || ''))) return 1;
    if (provider === 'gemini' && role === 'user') return 1;
    if (provider === 'gemini' && role === 'assistant') return Math.min(Number(config?.minChars || 12), 8);
    return Number(config?.minChars || 12);
  }

  function isNoise(text, context = {}) {
    const normalized = normalizeTextForHash(text);
    const role = context.role || 'unknown';
    if (normalized.length < minCharsFor(role, context.captureMode)) return true;
    if (/^(new chat|sign in|log in|upgrade|share|copy|regenerate|send|stop generating|问问 gemini)$/i.test(normalized)) return true;
    if (role === 'user' && normalized.length >= 1 && /auto_input|auto_dom/.test(String(context.captureMode || ''))) return false;
    if (normalized.split(' ').length < 3 && normalized.length < 40) return true;
    return false;
  }

  function describeNode(node) {
    if (!(node instanceof Element)) return '';
    const testId = node.getAttribute('data-testid');
    const role = node.getAttribute('data-message-author-role');
    const tag = node.tagName.toLowerCase();
    const cls = String(node.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return [tag, testId ? `[data-testid="${testId}"]` : '', role ? `[data-message-author-role="${role}"]` : '', cls ? `.${cls}` : ''].join('');
  }

  function detectProvider(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (host.includes('chatgpt')) return 'chatgpt';
    if (host.includes('claude')) return 'claude';
    if (host.includes('gemini') || host.includes('bard.google') || host.includes('aistudio.google')) return 'gemini';
    if (host.includes('doubao')) return 'doubao';
    if (host.includes('perplexity')) return 'perplexity';
    if (host.includes('poe.com')) return 'poe';
    if (host.includes('localhost') || host.includes('127.0.0.1')) return 'local_web';
    return 'generic_web_ai';
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
})();
