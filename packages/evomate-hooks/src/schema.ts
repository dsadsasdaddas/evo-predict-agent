export const EVOMATE_HOOK_PROTOCOL_VERSION = 'evomate.hook.v1' as const;

export type EvoMateHookChannel =
  | 'coding-agent'
  | 'mobile-chat'
  | 'web-chat'
  | 'browser-extension'
  | 'desktop'
  | 'api-sdk'
  | 'unknown';

export type EvoMateHookDirection = 'inbound' | 'outbound' | 'feedback' | 'lifecycle' | 'tool';

export type EvoMateHookEventKind =
  | 'session_start'
  | 'session_end'
  | 'user_message'
  | 'assistant_message'
  | 'advisor_request'
  | 'tool_use'
  | 'tool_result'
  | 'feedback'
  | 'copy'
  | 'regenerate'
  | 'stop'
  | 'unknown';

export type EvoMateHookRoute = 'advisor' | 'observe' | 'outcome' | 'ignore';

export type EvoMateHookOutcome = 'accepted' | 'corrected' | 'interrupted' | 'rejected' | 'undo' | 'success' | 'failure';

export interface EvoMateHookMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  id?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface EvoMateHookPrivacy {
  consent?: boolean;
  redaction?: 'none' | 'client' | 'server' | 'client_and_server';
  pii?: 'unknown' | 'none' | 'possible' | 'present';
  retention?: 'session' | 'short' | 'long';
}

export interface EvoMateHookEvent {
  protocolVersion?: typeof EVOMATE_HOOK_PROTOCOL_VERSION | string;
  source: string;
  event?: string;
  channel?: EvoMateHookChannel | string;
  eventKind?: EvoMateHookEventKind | string;
  direction?: EvoMateHookDirection | string;
  content?: string;
  messages?: EvoMateHookMessage[];
  sessionId?: string;
  userId?: string;
  workspace?: string;
  cwd?: string;
  url?: string;
  device?: string;
  app?: string;
  appVersion?: string;
  locale?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
  privacy?: EvoMateHookPrivacy;
  outcome?: EvoMateHookOutcome | string;
  kind?: 'accepted' | 'corrected' | 'interrupted' | 'rejected' | 'undo' | 'manual_score' | string;
  score?: number;
  geneId?: string;
  signals?: string[];
}

export interface NormalizedEvoMateHookEvent extends Omit<EvoMateHookEvent, 'protocolVersion' | 'channel' | 'eventKind' | 'direction' | 'metadata' | 'signals'> {
  protocolVersion: typeof EVOMATE_HOOK_PROTOCOL_VERSION;
  event: string;
  channel: EvoMateHookChannel;
  eventKind: EvoMateHookEventKind;
  direction: EvoMateHookDirection;
  metadata: Record<string, unknown>;
  signals: string[];
  route: EvoMateHookRoute;
}

export interface HookNormalizeResult {
  ok: boolean;
  events: NormalizedEvoMateHookEvent[];
  errors: string[];
}

export interface AgentObservePayload {
  source: string;
  event: string;
  workspace?: string;
  sessionId?: string;
  content?: string;
  cwd?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentOutcomePayload extends AgentObservePayload {
  kind?: 'accepted' | 'corrected' | 'interrupted' | 'rejected' | 'undo' | 'manual_score';
  outcome?: 'accepted' | 'corrected' | 'interrupted' | 'rejected' | 'undo' | 'success' | 'failure';
  score?: number;
  geneId?: string;
  signals?: string[];
}

export function normalizeHookInput(input: unknown): HookNormalizeResult {
  const rawEvents = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.events)
      ? input.events
      : [input];
  const events: NormalizedEvoMateHookEvent[] = [];
  const errors: string[] = [];

  rawEvents.forEach((raw, index) => {
    const normalized = normalizeSingleEvent(raw, index);
    if (typeof normalized === 'string') errors.push(normalized);
    else events.push(normalized);
  });

  return { ok: errors.length === 0 && events.length > 0, events, errors };
}

export function normalizeSingleEvent(raw: unknown, index = 0): NormalizedEvoMateHookEvent | string {
  if (!isRecord(raw)) return `event_${index}_not_object`;
  const source = normalizeSource(stringFrom(readFirst(raw, ['source', 'host', 'provider', 'client'])) || 'unknown');
  if (!source || source === 'unknown') return `event_${index}_source_required`;

  const event = normalizeEventName(stringFrom(readFirst(raw, ['event', 'hookEventName', 'event_name', 'type'])) || 'unknown');
  const explicitKind = stringFrom(readFirst(raw, ['eventKind', 'event_kind', 'kindName']));
  const eventKind = normalizeEventKind(explicitKind || event, raw);
  const channel = normalizeChannel(stringFrom(readFirst(raw, ['channel', 'surface', 'platform'])) || source);
  const direction = normalizeDirection(stringFrom(readFirst(raw, ['direction'])), eventKind);
  const content = normalizeContent(raw);
  const metadata = normalizeMetadata(raw);
  const messages = normalizeMessages(readFirst(raw, ['messages', 'conversation', 'turns']));
  const signals = normalizeStringList(readFirst(raw, ['signals', 'signal', 'contextSignals', 'context_signals']));
  const route = routeHookEvent({ eventKind, direction, content, outcome: stringFrom(raw.outcome), score: numberFrom(raw.score) });

  return {
    protocolVersion: EVOMATE_HOOK_PROTOCOL_VERSION,
    source,
    event,
    channel,
    eventKind,
    direction,
    content,
    messages,
    sessionId: stringFrom(readFirst(raw, ['sessionId', 'session_id', 'conversationId', 'conversation_id', 'threadId', 'thread_id'])),
    userId: stringFrom(readFirst(raw, ['userId', 'user_id', 'accountId', 'account_id'])),
    workspace: stringFrom(readFirst(raw, ['workspace', 'project', 'repo', 'cwd'])),
    cwd: stringFrom(readFirst(raw, ['cwd'])),
    url: stringFrom(readFirst(raw, ['url', 'pageUrl', 'page_url'])),
    device: stringFrom(readFirst(raw, ['device', 'deviceType', 'device_type'])),
    app: stringFrom(readFirst(raw, ['app', 'appName', 'app_name'])),
    appVersion: stringFrom(readFirst(raw, ['appVersion', 'app_version', 'version'])),
    locale: stringFrom(readFirst(raw, ['locale', 'language'])),
    occurredAt: stringFrom(readFirst(raw, ['occurredAt', 'occurred_at', 'timestamp', 'createdAt', 'created_at'])) || new Date().toISOString(),
    metadata,
    privacy: normalizePrivacy(readFirst(raw, ['privacy'])),
    outcome: normalizeOutcome(stringFrom(readFirst(raw, ['outcome', 'result']))),
    kind: normalizeFeedbackKind(stringFrom(readFirst(raw, ['kind', 'feedbackKind', 'feedback_kind']))),
    score: clampScore(numberFrom(readFirst(raw, ['score', 'rating', 'reward']))),
    geneId: stringFrom(readFirst(raw, ['geneId', 'gene_id', 'behaviorGeneId', 'behavior_gene_id'])),
    signals,
    route
  };
}

export function toAgentObservePayload(event: NormalizedEvoMateHookEvent): AgentObservePayload {
  return {
    source: event.source,
    event: event.event,
    workspace: event.workspace,
    sessionId: event.sessionId,
    content: event.content,
    cwd: event.cwd,
    metadata: {
      ...event.metadata,
      protocolVersion: event.protocolVersion,
      channel: event.channel,
      eventKind: event.eventKind,
      direction: event.direction,
      occurredAt: event.occurredAt,
      url: event.url,
      device: event.device,
      app: event.app,
      appVersion: event.appVersion,
      locale: event.locale,
      messages: event.messages,
      privacy: event.privacy
    }
  };
}

export function toAgentOutcomePayload(event: NormalizedEvoMateHookEvent): AgentOutcomePayload {
  return {
    ...toAgentObservePayload(event),
    kind: event.kind as AgentOutcomePayload['kind'] || inferFeedbackKindFromEvent(event),
    outcome: event.outcome as AgentOutcomePayload['outcome'] || inferOutcomeFromEvent(event),
    score: event.score,
    geneId: event.geneId,
    signals: event.signals
  };
}

export function routeHookEvent(input: Pick<NormalizedEvoMateHookEvent, 'eventKind' | 'direction'> & { content?: string; outcome?: string; score?: number }): EvoMateHookRoute {
  if (input.direction === 'feedback' || input.eventKind === 'feedback' || input.eventKind === 'copy' || input.eventKind === 'regenerate' || input.eventKind === 'stop' || input.outcome || typeof input.score === 'number') {
    return 'outcome';
  }
  if (input.eventKind === 'user_message' || input.eventKind === 'advisor_request') return 'advisor';
  if (input.eventKind === 'unknown' && !input.content?.trim()) return 'ignore';
  return 'observe';
}

export function createMobileChatEvent(input: Omit<EvoMateHookEvent, 'source' | 'channel'> & { source?: string }): EvoMateHookEvent {
  return { ...input, source: input.source || 'mobile-chat', channel: 'mobile-chat' };
}

export function createWebChatEvent(input: Omit<EvoMateHookEvent, 'source' | 'channel'> & { source?: string }): EvoMateHookEvent {
  return { ...input, source: input.source || 'web-chat', channel: 'web-chat' };
}

export function createBrowserExtensionEvent(input: Omit<EvoMateHookEvent, 'source' | 'channel'> & { source?: string }): EvoMateHookEvent {
  return { ...input, source: input.source || 'browser-extension', channel: 'browser-extension' };
}

function inferFeedbackKindFromEvent(event: NormalizedEvoMateHookEvent): AgentOutcomePayload['kind'] {
  if (event.eventKind === 'copy') return 'accepted';
  if (event.eventKind === 'regenerate') return 'corrected';
  if (event.eventKind === 'stop') return 'interrupted';
  if (event.outcome === 'success' || event.outcome === 'accepted') return 'accepted';
  if (event.outcome === 'failure' || event.outcome === 'rejected') return 'rejected';
  return 'manual_score';
}

function inferOutcomeFromEvent(event: NormalizedEvoMateHookEvent): AgentOutcomePayload['outcome'] {
  if (event.eventKind === 'copy') return 'accepted';
  if (event.eventKind === 'regenerate') return 'corrected';
  if (event.eventKind === 'stop') return 'interrupted';
  if (event.outcome === 'success' || event.outcome === 'failure') return event.outcome;
  return undefined;
}

function normalizeEventKind(value: string, raw: Record<string, unknown>): EvoMateHookEventKind {
  const normalized = normalizeToken(value, 'unknown');
  const aliases: Record<string, EvoMateHookEventKind> = {
    sessionstart: 'session_start',
    session_start: 'session_start',
    start: 'session_start',
    sessionend: 'session_end',
    session_end: 'session_end',
    userpromptsubmit: 'user_message',
    user_prompt_submit: 'user_message',
    usermessage: 'user_message',
    user_message: 'user_message',
    prompt: 'user_message',
    chat_message: 'user_message',
    assistantmessage: 'assistant_message',
    assistant_message: 'assistant_message',
    response: 'assistant_message',
    advisor_prepare: 'advisor_request',
    advisorrequest: 'advisor_request',
    advisor_request: 'advisor_request',
    posttooluse: 'tool_result',
    post_tool_use: 'tool_result',
    tool_result: 'tool_result',
    toolresult: 'tool_result',
    tool_use: 'tool_use',
    tooluse: 'tool_use',
    feedback: 'feedback',
    rating: 'feedback',
    thumbs_up: 'feedback',
    thumbs_down: 'feedback',
    copy: 'copy',
    copied: 'copy',
    regenerate: 'regenerate',
    retry: 'regenerate',
    stop: 'stop',
    interrupt: 'stop',
    interrupted: 'stop'
  };
  const aliased = aliases[normalized];
  if (aliased) return aliased;
  if (typeof raw.outcome === 'string' || typeof raw.score === 'number') return 'feedback';
  return 'unknown';
}

function normalizeChannel(value: string): EvoMateHookChannel {
  const normalized = normalizeToken(value, 'unknown');
  if (/codex|claude|cursor|code|coding/.test(normalized)) return 'coding-agent';
  if (/mobile|ios|android|phone/.test(normalized)) return 'mobile-chat';
  if (/browser|extension|chrome|edge|safari/.test(normalized)) return 'browser-extension';
  if (/web|site|chat_widget|widget/.test(normalized)) return 'web-chat';
  if (/desktop|electron/.test(normalized)) return 'desktop';
  if (/sdk|api/.test(normalized)) return 'api-sdk';
  return 'unknown';
}

function normalizeDirection(value: string | undefined, kind: EvoMateHookEventKind): EvoMateHookDirection {
  const normalized = value ? normalizeToken(value, 'lifecycle') : '';
  if (['inbound', 'outbound', 'feedback', 'lifecycle', 'tool'].includes(normalized)) return normalized as EvoMateHookDirection;
  if (kind === 'user_message' || kind === 'advisor_request') return 'inbound';
  if (kind === 'assistant_message') return 'outbound';
  if (kind === 'feedback' || kind === 'copy' || kind === 'regenerate' || kind === 'stop') return 'feedback';
  if (kind === 'tool_use' || kind === 'tool_result') return 'tool';
  return 'lifecycle';
}

function normalizeContent(raw: Record<string, unknown>): string | undefined {
  const direct = stringFrom(readFirst(raw, ['content', 'input', 'prompt', 'message', 'text', 'userInput', 'user_input']));
  if (direct) return direct.slice(0, 12000);
  const messages = normalizeMessages(readFirst(raw, ['messages', 'conversation', 'turns']));
  const latestUser = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim());
  const latestAny = [...messages].reverse().find((message) => message.content.trim());
  return (latestUser?.content || latestAny?.content)?.slice(0, 12000);
}

function normalizeMessages(value: unknown): EvoMateHookMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): EvoMateHookMessage[] => {
    if (!isRecord(item)) return [];
    const role = normalizeMessageRole(stringFrom(item.role) || stringFrom(item.author) || 'user');
    const content = stringFrom(item.content) || stringFrom(item.text) || stringFrom(item.message);
    if (!content) return [];
    return [{
      role,
      content: content.slice(0, 12000),
      id: stringFrom(item.id),
      createdAt: stringFrom(item.createdAt) || stringFrom(item.created_at),
      metadata: isRecord(item.metadata) ? item.metadata : undefined
    }];
  });
}

function normalizeMessageRole(value: string): EvoMateHookMessage['role'] {
  const normalized = normalizeToken(value, 'user');
  if (normalized.includes('assistant') || normalized.includes('ai')) return 'assistant';
  if (normalized.includes('system')) return 'system';
  if (normalized.includes('tool')) return 'tool';
  return 'user';
}

function normalizeMetadata(raw: Record<string, unknown>): Record<string, unknown> {
  const metadata = isRecord(raw.metadata) ? { ...raw.metadata } : {};
  for (const key of ['source', 'event', 'content', 'input', 'prompt', 'message', 'messages', 'metadata']) delete metadata[key];
  return redactValue(metadata) as Record<string, unknown>;
}

function normalizePrivacy(value: unknown): EvoMateHookPrivacy | undefined {
  if (!isRecord(value)) return undefined;
  return {
    consent: typeof value.consent === 'boolean' ? value.consent : undefined,
    redaction: normalizePrivacyEnum(value.redaction, ['none', 'client', 'server', 'client_and_server']),
    pii: normalizePrivacyEnum(value.pii, ['unknown', 'none', 'possible', 'present']),
    retention: normalizePrivacyEnum(value.retention, ['session', 'short', 'long'])
  };
}

function normalizePrivacyEnum<T extends string>(value: unknown, allowed: T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeToken(value, '');
  return allowed.includes(normalized as T) ? normalized as T : undefined;
}

function normalizeOutcome(value: string | undefined): EvoMateHookOutcome | undefined {
  if (!value) return undefined;
  const normalized = normalizeToken(value, '');
  const aliases: Record<string, EvoMateHookOutcome> = {
    ok: 'success',
    done: 'success',
    success: 'success',
    accepted: 'accepted',
    copied: 'accepted',
    bad: 'rejected',
    failed: 'failure',
    failure: 'failure',
    rejected: 'rejected',
    corrected: 'corrected',
    interrupt: 'interrupted',
    interrupted: 'interrupted',
    undo: 'undo'
  };
  return aliases[normalized];
}

function normalizeFeedbackKind(value: string | undefined): EvoMateHookEvent['kind'] | undefined {
  if (!value) return undefined;
  const normalized = normalizeToken(value, '');
  if (['accepted', 'corrected', 'interrupted', 'rejected', 'undo', 'manual_score'].includes(normalized)) return normalized;
  return undefined;
}

function normalizeEventName(value: string): string {
  return normalizeToken(value, 'unknown').slice(0, 120);
}

function normalizeSource(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.:@/-]+/g, '-').replace(/^-+|-+$/g, '');
  return (normalized || 'unknown').slice(0, 120);
}

function normalizeToken(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function normalizeStringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\s]+/) : [];
  return [...new Set(raw.map((item) => typeof item === 'string' ? normalizeToken(item, '') : '').filter(Boolean))];
}

function readFirst(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (raw[key] !== undefined) return raw[key];
  return undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? redactString(value.trim()) : undefined;
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function clampScore(value: number | undefined): number | undefined {
  if (typeof value !== 'number') return undefined;
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  return Math.max(0, Math.min(1, scaled));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[redacted:depth]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/api[_-]?key|token|secret|password|authorization/i.test(key)) return [key, '[redacted]'];
    return [key, redactValue(item, depth + 1)];
  }));
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._=-]{12,}/gi, 'Bearer [redacted]')
    .replace(/sk-(?:evomap-)?[A-Za-z0-9_-]{16,}/g, 'sk-[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^"'\s,}]{6,}/gi, '$1[redacted]');
}
