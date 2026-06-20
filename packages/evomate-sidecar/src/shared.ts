import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type HookKind = 'observe' | 'advisor' | 'outcome';

export interface HookPayload {
  source: string;
  event: string;
  workspace?: string;
  sessionId?: string;
  content?: string;
  cwd?: string;
  metadata?: Record<string, unknown>;
  kind?: string;
  outcome?: string;
  score?: number;
  geneId?: string;
  signals?: string[];
}

export interface HookResponse {
  ok?: boolean;
  advisorPrompt?: string;
  gene?: { id?: string; label?: string };
  predictedSatisfaction?: number;
  [key: string]: unknown;
}

export function parseArgs(argv = process.argv.slice(2)): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const trimmed = token.slice(2);
    const eq = trimmed.indexOf('=');
    if (eq >= 0) {
      args[toCamel(trimmed.slice(0, eq))] = trimmed.slice(eq + 1);
      continue;
    }
    const key = toCamel(trimmed);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export async function readStdin(timeoutMs = 80): Promise<string> {
  if (process.stdin.isTTY) return '';
  return await new Promise((resolveRead) => {
    let done = false;
    let data = '';
    const finish = () => {
      if (done) return;
      done = true;
      resolveRead(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.resume();
  });
}

export function buildHookPayload(kind: HookKind, args: Record<string, string | boolean>, stdinText: string): HookPayload {
  const stdinPayload = parseStdinPayload(stdinText);
  const content = stringArg(args.content)
    ?? stringArg(args.input)
    ?? stringArg(args.prompt)
    ?? stringFrom(stdinPayload.content)
    ?? stringFrom(stdinPayload.input)
    ?? stringFrom(stdinPayload.prompt)
    ?? stringFrom(stdinPayload.message)
    ?? (!looksLikeJson(stdinText) ? stdinText.trim() : undefined);

  const workspace = stringArg(args.workspace)
    ?? stringFrom(stdinPayload.workspace)
    ?? stringArg(args.cwd)
    ?? stringFrom(stdinPayload.cwd)
    ?? process.env.EVOMATE_WORKSPACE
    ?? process.env.INIT_CWD
    ?? process.cwd();

  const metadata: Record<string, unknown> = {
    ...stdinPayload,
    hookKind: kind,
    argvSource: 'evomate-sidecar'
  };

  return redactValue({
    source: stringArg(args.source) ?? stringFrom(stdinPayload.source) ?? 'hook',
    event: stringArg(args.event) ?? stringFrom(stdinPayload.event) ?? defaultEvent(kind),
    workspace,
    sessionId: stringArg(args.sessionId) ?? stringArg(args.session) ?? stringFrom(stdinPayload.sessionId) ?? stringFrom(stdinPayload.session_id),
    content,
    cwd: stringArg(args.cwd) ?? stringFrom(stdinPayload.cwd) ?? process.cwd(),
    metadata,
    kind: stringArg(args.kind) ?? stringFrom(stdinPayload.kind),
    outcome: stringArg(args.outcome) ?? stringFrom(stdinPayload.outcome),
    score: numberArg(args.score) ?? numberFrom(stdinPayload.score),
    geneId: stringArg(args.geneId) ?? stringArg(args.gene) ?? stringFrom(stdinPayload.geneId) ?? stringFrom(stdinPayload.gene_id),
    signals: listArg(args.signals) ?? listFrom(stdinPayload.signals)
  }) as HookPayload;
}

export async function appendQueue(kind: HookKind, payload: unknown): Promise<string> {
  const queueDir = resolveProjectPath(process.env.EVOMATE_HOOK_QUEUE_DIR || 'memory/evomate/hooks');
  const queuePath = resolve(queueDir, `${kind}.jsonl`);
  await mkdir(dirname(queuePath), { recursive: true });
  await appendFile(queuePath, `${JSON.stringify({ createdAt: new Date().toISOString(), payload })}\n`, 'utf8');
  return queuePath;
}

export async function postJson<T extends HookResponse>(path: string, payload: unknown): Promise<T> {
  const baseUrl = trimSlash(process.env.EVOMATE_API_URL || 'http://localhost:8787');
  const timeoutMs = Number(process.env.EVOMATE_HOOK_TIMEOUT_MS || 900);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) as T : {} as T;
    if (!response.ok) {
      const error = typeof json.error === 'string' ? json.error : response.statusText;
      throw new Error(`evomate_api_${response.status}:${error}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T = unknown>(path: string, timeoutMs = Number(process.env.EVOMATE_HOOK_TIMEOUT_MS || 900)): Promise<T> {
  const baseUrl = trimSlash(process.env.EVOMATE_API_URL || 'http://localhost:8787');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { 'accept': 'application/json' },
      signal: controller.signal
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) as T : {} as T;
    if (!response.ok) {
      const error = isRecord(json) && typeof json.error === 'string' ? json.error : response.statusText;
      throw new Error(`evomate_api_${response.status}:${error}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export function compactResponse(response: HookResponse, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: response.ok !== false,
    geneId: response.gene?.id,
    geneLabel: response.gene?.label,
    predictedSatisfaction: response.predictedSatisfaction,
    advisorPrompt: response.advisorPrompt,
    ...extra
  };
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printHookFailure(kind: HookKind, error: unknown, extra: Record<string, unknown> = {}): void {
  printJson({
    ok: false,
    queued: true,
    hookKind: kind,
    error: error instanceof Error ? error.message : String(error),
    ...extra
  });
}

function parseStdinPayload(stdinText: string): Record<string, unknown> {
  const trimmed = stdinText.trim();
  if (!trimmed || !looksLikeJson(trimmed)) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { raw: trimmed };
  }
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
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

function defaultEvent(kind: HookKind): string {
  if (kind === 'advisor') return 'advisor_prepare';
  if (kind === 'outcome') return 'agent_outcome';
  return 'agent_observe';
}

function toCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function stringArg(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberArg(value: string | boolean | undefined): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function listArg(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function listFrom(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveProjectPath(path: string): string {
  if (path.startsWith('/')) return path;
  return resolve(process.env.EVOMATE_PROJECT_ROOT || process.env.INIT_CWD || process.cwd(), path);
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, '');
}
