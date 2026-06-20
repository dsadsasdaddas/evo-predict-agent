#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { getJson, parseArgs, printJson } from './shared.js';

interface EvolutionState {
  assistantId?: string;
  generation?: number;
  phase?: string;
  understandingScore?: number;
  activeGenes?: BehaviorGene[];
  policy?: {
    model?: string;
    version?: number;
    totalUpdates?: number;
    explorationRate?: number;
  };
  metrics?: Record<string, number>;
  timeline?: TimelineItem[];
}

interface BehaviorGene {
  id?: string;
  label?: string;
  summary?: string;
  fitness?: number;
  weight?: number;
  signals?: string[];
}

interface TimelineItem {
  id?: string;
  type?: string;
  summary?: string;
  score?: number;
  createdAt?: string;
  geneId?: string;
  signals?: string[];
}

interface HookQueueItem {
  createdAt?: string;
  payload?: {
    source?: string;
    event?: string;
    sessionId?: string;
    content?: string;
    input?: string;
    outcome?: string;
    geneId?: string;
    metadata?: Record<string, unknown>;
  };
}

interface QueueSummary {
  name: string;
  count: number;
  latest?: HookQueueItem;
}

interface ModelSummary {
  name: string;
  path: string;
  installed: boolean;
}

interface StatusSummary {
  ok: boolean;
  apiUrl: string;
  projectRoot: string;
  state?: EvolutionState;
  activeGene?: BehaviorGene;
  latestEvent?: TimelineItem;
  hookQueues: QueueSummary[];
  models: ModelSummary[];
  error?: string;
}

const args = parseArgs();
const watch = args.watch === true;
const json = args.json === true;
const intervalMs = clamp(Number(typeof args.interval === 'string' ? args.interval : 2) * 1000, 500, 30000);

if (watch && json) {
  // JSON watch would produce a stream that is hard to consume from npm scripts; keep it explicit.
  printJson({ ok: false, error: 'watch_json_not_supported', hint: 'use --watch without --json, or --json without --watch' });
} else if (watch) {
  while (true) {
    const status = await loadStatus();
    process.stdout.write('\x1b[2J\x1b[H');
    renderStatus(status);
    await sleep(intervalMs);
  }
} else {
  const status = await loadStatus();
  if (json) printJson(status);
  else renderStatus(status);
}

async function loadStatus(): Promise<StatusSummary> {
  const apiUrl = trimSlash(process.env.EVOMATE_API_URL || 'http://localhost:8787');
  const projectRoot = resolveProjectRoot();
  const [hookQueues, models] = await Promise.all([
    loadHookQueues(projectRoot),
    Promise.resolve(loadModelSummary(projectRoot))
  ]);

  try {
    const state = await getJson<EvolutionState>('/api/evolution/state', Number(process.env.EVOMATE_STATUS_TIMEOUT_MS || 1500));
    const latestEvent = state.timeline?.[0];
    const activeGene = state.activeGenes?.find((gene) => gene.id === latestEvent?.geneId)
      ?? state.activeGenes?.[0];
    return { ok: true, apiUrl, projectRoot, state, activeGene, latestEvent, hookQueues, models };
  } catch (error) {
    return {
      ok: false,
      apiUrl,
      projectRoot,
      hookQueues,
      models,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function renderStatus(status: StatusSummary): void {
  const state = status.state;
  const metrics = state?.metrics ?? {};
  const activeGene = status.activeGene;
  const latest = status.latestEvent;

  line(`${bold('EvoMate CLI State')} ${status.ok ? green('● API online') : red('● API offline')}`);
  line(`${muted('api')}      ${status.apiUrl}`);
  line(`${muted('project')}  ${status.projectRoot}`);

  if (!status.ok) {
    line(`${muted('error')}    ${red(status.error ?? 'unknown')}`);
    line(`${muted('hint')}     npm run evomate:api`);
    renderHooksAndModels(status);
    return;
  }

  line('');
  line(`${muted('phase')}    ${state?.phase ?? 'unknown'}  ${muted('generation')} ${state?.generation ?? '-'}`);
  line(`${muted('yesness')}  ${bar(percentNumber(metrics.yesnessScore ?? state?.understandingScore ?? 0), 18)} ${percent(metrics.yesnessScore ?? state?.understandingScore)}`);
  line(`${muted('policy')}   ${state?.policy?.model ?? 'unknown'} v${state?.policy?.version ?? '-'} · updates ${state?.policy?.totalUpdates ?? 0} · explore ${percent(state?.policy?.explorationRate)}`);
  line(`${muted('gene')}     ${cyan(activeGene?.label ?? 'unknown')} ${muted(activeGene?.id ?? '')}`);
  if (activeGene?.summary) line(`${muted('why')}      ${clip(activeGene.summary, 110)}`);
  if (latest) {
    line(`${muted('latest')}  ${formatClock(latest.createdAt)} · ${clip(latest.summary ?? latest.type ?? '', 110)}`);
    if (latest.signals?.length) line(`${muted('signals')}  ${latest.signals.slice(0, 8).join(', ')}`);
  }

  renderHooksAndModels(status);

  const recent = state?.timeline?.slice(0, 5) ?? [];
  if (recent.length) {
    line('');
    line(bold('Recent Evolution'));
    for (const item of recent) {
      line(`  ${muted(formatClock(item.createdAt))} ${item.geneId ? cyan(item.geneId) : muted(item.type ?? '-')} ${clip(item.summary ?? '', 96)} ${item.score === undefined ? '' : muted(String(Number(item.score).toFixed(3)))}`.trimEnd());
    }
  }

  line('');
  line(`${muted('commands')} npm run evomate:status -- --watch   |   npm run evomate:status -- --json`);
}

function renderHooksAndModels(status: StatusSummary): void {
  line('');
  line(bold('Runtime Health'));
  const models = status.models.map((model) => `${model.installed ? green('✓') : red('×')} ${model.name}`).join('  ');
  line(`${muted('models')}   ${models}`);
  for (const queue of status.hookQueues) {
    const latest = queue.latest;
    const payload = latest?.payload;
    const event = [payload?.source, payload?.event].filter(Boolean).join(':') || '-';
    const text = payload?.input ?? payload?.content ?? payload?.outcome ?? '';
    line(`${muted(queue.name.padEnd(8))} ${String(queue.count).padStart(4)}  ${formatClock(latest?.createdAt)}  ${event}  ${clip(text, 72)}`);
  }
}

async function loadHookQueues(projectRoot: string): Promise<QueueSummary[]> {
  const hookDir = resolveProjectPath(projectRoot, process.env.EVOMATE_HOOK_QUEUE_DIR || 'memory/evomate/hooks');
  return await Promise.all(['observe', 'advisor', 'outcome'].map(async (name) => {
    const path = resolve(hookDir, `${name}.jsonl`);
    const items = await readJsonlTail(path, 1);
    return {
      name,
      count: await countLines(path),
      latest: items[0]
    };
  }));
}

async function readJsonlTail(path: string, limit: number): Promise<HookQueueItem[]> {
  try {
    const text = await readFile(path, 'utf8');
    return text.trim().split('\n').filter(Boolean).slice(-limit).reverse().flatMap((lineText) => {
      try {
        return [JSON.parse(lineText) as HookQueueItem];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

async function countLines(path: string): Promise<number> {
  try {
    const text = await readFile(path, 'utf8');
    return text ? text.trimEnd().split('\n').length : 0;
  } catch {
    return 0;
  }
}

function loadModelSummary(projectRoot: string): ModelSummary[] {
  const specs = [
    ['reward_model', 'memory/evomate/models/reward_model/preference_model.json'],
    ['policy_model', 'memory/evomate/models/policy_model/policy_model.json'],
    ['embedding_index', 'memory/evomate/models/embedding_index/embedding_index.json']
  ] as const;
  return specs.map(([name, relativePath]) => {
    const path = resolveProjectPath(projectRoot, relativePath);
    return { name, path, installed: existsSync(path) };
  });
}

function resolveProjectRoot(): string {
  if (process.env.EVOMATE_PROJECT_ROOT) return process.env.EVOMATE_PROJECT_ROOT;
  if (process.env.INIT_CWD) return process.env.INIT_CWD;
  if (process.cwd().endsWith('/packages/evomate-sidecar')) return resolve(process.cwd(), '../..');
  return process.cwd();
}

function resolveProjectPath(projectRoot: string, path: string): string {
  if (path.startsWith('/')) return path;
  return resolve(projectRoot, path);
}

function line(value = ''): void {
  process.stdout.write(`${value}\n`);
}

function percent(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

function percentNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

function bar(value: number, width: number): string {
  const filled = Math.round(clamp(value, 0, 1) * width);
  return `${green('█'.repeat(filled))}${muted('░'.repeat(width - filled))}`;
}

function formatClock(value: string | undefined): string {
  if (!value) return '--:--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function clip(value: string, max: number): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function color(code: number, value: string): string {
  if (process.env.NO_COLOR) return value;
  return `\x1b[${code}m${value}\x1b[0m`;
}

function bold(value: string): string { return color(1, value); }
function muted(value: string): string { return color(90, value); }
function green(value: string): string { return color(32, value); }
function red(value: string): string { return color(31, value); }
function cyan(value: string): string { return color(36, value); }
