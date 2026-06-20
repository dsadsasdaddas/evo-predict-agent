import {
  EVOMATE_HOOK_PROTOCOL_VERSION,
  createBrowserExtensionEvent,
  createMobileChatEvent,
  createWebChatEvent,
  type EvoMateHookEvent,
  type NormalizedEvoMateHookEvent
} from './schema.js';

export interface EvoMateHookClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  defaultSource?: string;
  defaultSessionId?: string;
  defaultUserId?: string;
  timeoutMs?: number;
}

export interface HookEventResponse {
  ok: boolean;
  protocolVersion?: string;
  count?: number;
  results?: Array<{
    route?: string;
    event?: NormalizedEvoMateHookEvent;
    result?: unknown;
  }>;
  [key: string]: unknown;
}

export class EvoMateHookClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultSource?: string;
  private readonly defaultSessionId?: string;
  private readonly defaultUserId?: string;
  private readonly timeoutMs: number;

  constructor(options: EvoMateHookClientOptions = {}) {
    this.baseUrl = (options.baseUrl || 'http://localhost:8787').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || fetch;
    this.defaultSource = options.defaultSource;
    this.defaultSessionId = options.defaultSessionId;
    this.defaultUserId = options.defaultUserId;
    this.timeoutMs = options.timeoutMs ?? 1500;
  }

  async send(event: EvoMateHookEvent | EvoMateHookEvent[]): Promise<HookEventResponse> {
    const payload = Array.isArray(event)
      ? { protocolVersion: EVOMATE_HOOK_PROTOCOL_VERSION, events: event.map((item) => this.withDefaults(item)) }
      : this.withDefaults(event);
    return this.post('/api/hook-events', payload);
  }

  async observe(event: EvoMateHookEvent): Promise<HookEventResponse> {
    return this.send({ ...event, eventKind: event.eventKind || 'user_message' });
  }

  async outcome(event: EvoMateHookEvent): Promise<HookEventResponse> {
    return this.send({ ...event, eventKind: event.eventKind || 'feedback' });
  }

  async mobileChat(event: Parameters<typeof createMobileChatEvent>[0]): Promise<HookEventResponse> {
    return this.send(createMobileChatEvent(event));
  }

  async webChat(event: Parameters<typeof createWebChatEvent>[0]): Promise<HookEventResponse> {
    return this.send(createWebChatEvent(event));
  }

  async browserExtension(event: Parameters<typeof createBrowserExtensionEvent>[0]): Promise<HookEventResponse> {
    return this.send(createBrowserExtensionEvent(event));
  }

  private withDefaults(event: EvoMateHookEvent): EvoMateHookEvent {
    return {
      ...event,
      protocolVersion: EVOMATE_HOOK_PROTOCOL_VERSION,
      source: event.source || this.defaultSource || 'api-sdk',
      sessionId: event.sessionId || this.defaultSessionId,
      userId: event.userId || this.defaultUserId,
      occurredAt: event.occurredAt || new Date().toISOString()
    };
  }

  private async post(path: string, payload: unknown): Promise<HookEventResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const text = await response.text();
      const json = text ? JSON.parse(text) as HookEventResponse : { ok: response.ok };
      if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : `evomate_hook_${response.status}`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}
