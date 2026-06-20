#!/usr/bin/env tsx
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hostname, platform } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { EvoMateHookClient, type EvoMateHookEvent } from '@evomate/hooks';

const execFileAsync = promisify(execFile);
const DEFAULT_API_URL = 'http://100.70.188.115:8878';
const DEFAULT_INTERVAL_MS = 2500;
const DEFAULT_GIT_INTERVAL_MS = 5000;

type ArgMap = Record<string, string | boolean | string[]>;

interface ActiveWindowSnapshot {
  app: string;
  title: string;
}

interface GitSnapshot {
  repoRoot: string;
  branch: string;
  changed: number;
  staged: number;
  unstaged: number;
  untracked: number;
  sample: string[];
}

const args = parseArgs(process.argv.slice(2));
const command = String(args._?.[0] || 'once');
const dryRun = Boolean(args.dryRun) || process.env.EVOMATE_DRY_RUN === '1';
const apiBaseUrl = normalizeApiBaseUrl(stringArg(args.apiUrl) || process.env.EVOMATE_API_URL || DEFAULT_API_URL);
const client = new EvoMateHookClient({ baseUrl: apiBaseUrl, timeoutMs: numberArg(args.timeoutMs) || 1600 });

main().catch((error) => {
  console.error(`[evomate-local-agent] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (command === 'help' || command === '--help' || command === '-h') return printHelp();
  if (command === 'active-window') return activeWindowOnce();
  if (command === 'git') return gitOnce();
  if (command === 'once') return once();
  if (command === 'monitor') return monitor();
  if (command === 'terminal-start') return terminalStart();
  if (command === 'terminal-done') return terminalDone();
  throw new Error(`unknown command: ${command}`);
}

async function once(): Promise<void> {
  const sent: unknown[] = [];
  const active = await readActiveWindow().catch((error) => ({ error }));
  if ('error' in active) {
    sent.push(await sendEvent(activeWindowPermissionEvent(active.error)));
  } else {
    sent.push(await sendEvent(activeWindowEvent(active, 'snapshot')));
  }

  const git = await readGitSnapshot(workspaceArg()).catch(() => undefined);
  if (git) sent.push(await sendEvent(gitEvent(git, 'snapshot')));
  printJson({ ok: true, mode: dryRun ? 'dry_run' : 'sent', apiBaseUrl, sent });
}

async function activeWindowOnce(): Promise<void> {
  const active = await readActiveWindow();
  const receipt = await sendEvent(activeWindowEvent(active, 'snapshot'));
  printJson({ ok: true, active, receipt });
}

async function gitOnce(): Promise<void> {
  const git = await readGitSnapshot(workspaceArg());
  const receipt = await sendEvent(gitEvent(git, 'snapshot'));
  printJson({ ok: true, git, receipt });
}

async function monitor(): Promise<void> {
  const intervalMs = numberArg(args.intervalMs) || Number(process.env.EVOMATE_LOCAL_AGENT_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  const gitIntervalMs = numberArg(args.gitIntervalMs) || Number(process.env.EVOMATE_LOCAL_AGENT_GIT_INTERVAL_MS || DEFAULT_GIT_INTERVAL_MS);
  let previousActiveKey = '';
  let previousGitKey = '';
  let lastGitAt = 0;
  console.log(`[evomate-local-agent] monitoring api=${apiBaseUrl} interval=${intervalMs}ms dryRun=${dryRun ? '1' : '0'}`);
  console.log('[evomate-local-agent] press Ctrl+C to stop');

  while (true) {
    const now = Date.now();
    const active = await readActiveWindow().catch((error) => {
      void sendEvent(activeWindowPermissionEvent(error)).catch(() => undefined);
      return undefined;
    });
    if (active) {
      const key = `${active.app}\n${active.title}`;
      if (key && key !== previousActiveKey) {
        previousActiveKey = key;
        await sendEvent(activeWindowEvent(active, 'changed'));
      }
    }

    if (now - lastGitAt >= gitIntervalMs) {
      lastGitAt = now;
      const git = await readGitSnapshot(workspaceArg()).catch(() => undefined);
      if (git) {
        const key = JSON.stringify([git.repoRoot, git.branch, git.changed, git.staged, git.unstaged, git.untracked, git.sample]);
        if (key !== previousGitKey) {
          previousGitKey = key;
          await sendEvent(gitEvent(git, 'changed'));
        }
      }
    }

    await sleep(intervalMs);
  }
}

async function terminalStart(): Promise<void> {
  const commandText = stringArg(args.command) || stringArg(args.cmd) || '';
  const cwd = stringArg(args.cwd) || process.cwd();
  const sessionId = stringArg(args.sessionId) || terminalSessionId(cwd, commandText, Date.now());
  const event: EvoMateHookEvent = {
    protocolVersion: 'evomate.hook.v1',
    source: 'terminal:zsh',
    channel: 'desktop',
    event: 'terminal_command_start',
    eventKind: 'tool_use',
    direction: 'tool',
    sessionId,
    cwd,
    workspace: cwd,
    device: platform(),
    app: 'zsh',
    content: `Terminal command started: ${redact(commandText)}`,
    metadata: {
      command: redact(commandText),
      cwd,
      host: hostname(),
      localAgentCommand: 'terminal-start'
    },
    privacy: localPrivacy(),
    signals: ['local_agent', 'terminal_command', 'command_start', 'coding_task']
  };
  printJson({ ok: true, receipt: await sendEvent(event), sessionId });
}

async function terminalDone(): Promise<void> {
  const commandText = stringArg(args.command) || stringArg(args.cmd) || '';
  const cwd = stringArg(args.cwd) || process.cwd();
  const exitCode = numberArg(args.exitCode) ?? 0;
  const durationMs = numberArg(args.durationMs);
  const success = exitCode === 0;
  const sessionId = stringArg(args.sessionId) || terminalSessionId(cwd, commandText, Date.now());
  const event: EvoMateHookEvent = {
    protocolVersion: 'evomate.hook.v1',
    source: 'terminal:zsh',
    channel: 'desktop',
    event: 'terminal_command_done',
    eventKind: 'tool_result',
    direction: 'tool',
    outcome: success ? 'success' : 'failure',
    kind: success ? 'accepted' : 'rejected',
    score: success ? 0.72 : 0.28,
    sessionId,
    cwd,
    workspace: cwd,
    device: platform(),
    app: 'zsh',
    content: `Terminal command ${success ? 'succeeded' : 'failed'}: ${redact(commandText)}${typeof durationMs === 'number' ? ` (${Math.round(durationMs)}ms)` : ''}`,
    metadata: {
      command: redact(commandText),
      cwd,
      host: hostname(),
      exitCode,
      durationMs,
      localAgentCommand: 'terminal-done'
    },
    privacy: localPrivacy(),
    signals: ['local_agent', 'terminal_command', success ? 'command_success' : 'command_failed', 'coding_task']
  };
  printJson({ ok: true, receipt: await sendEvent(event), sessionId });
}

async function readActiveWindow(): Promise<ActiveWindowSnapshot> {
  if (platform() !== 'darwin') {
    return { app: process.env.TERM_PROGRAM || 'terminal', title: process.env.PWD || '' };
  }
  const script = [
    'tell application "System Events"',
    '  set frontApp to first application process whose frontmost is true',
    '  set appName to name of frontApp',
    '  try',
    '    set winTitle to name of front window of frontApp',
    '  on error',
    '    set winTitle to ""',
    '  end try',
    'end tell',
    'return appName & "\\t" & winTitle'
  ].join('\n');
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 1800 });
  const [app = 'unknown', title = ''] = stdout.trim().split('\t');
  return { app: redact(app), title: redact(title) };
}

async function readGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const repoRoot = (await git(['rev-parse', '--show-toplevel'], cwd)).trim();
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)).trim();
  const raw = await git(['status', '--porcelain=v1'], repoRoot);
  const lines = raw.split('\n').map((line) => line.trimEnd()).filter(Boolean);
  const staged = lines.filter((line) => line[0] && line[0] !== '?' && line[0] !== ' ').length;
  const unstaged = lines.filter((line) => line[1] && line[1] !== ' ').length;
  const untracked = lines.filter((line) => line.startsWith('??')).length;
  return {
    repoRoot,
    branch,
    changed: lines.length,
    staged,
    unstaged,
    untracked,
    sample: lines.slice(0, 8).map(redact)
  };
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 2200 });
  return stdout;
}

function activeWindowEvent(snapshot: ActiveWindowSnapshot, reason: 'snapshot' | 'changed'): EvoMateHookEvent {
  const title = snapshot.title ? ` / ${snapshot.title}` : '';
  return {
    protocolVersion: 'evomate.hook.v1',
    source: 'local-agent:active-window',
    channel: 'desktop',
    event: `active_window_${reason}`,
    eventKind: 'tool_use',
    direction: 'lifecycle',
    sessionId: sessionId('active-window'),
    workspace: workspaceArg(),
    device: platform(),
    app: 'evomate-local-agent',
    content: `Active window ${reason}: ${snapshot.app}${title}`,
    metadata: {
      app: snapshot.app,
      windowTitle: snapshot.title,
      host: hostname(),
      reason
    },
    privacy: localPrivacy(),
    signals: ['local_agent', 'active_window', 'workflow_context', inferAppSignal(snapshot.app)]
  };
}

function activeWindowPermissionEvent(error: unknown): EvoMateHookEvent {
  return {
    protocolVersion: 'evomate.hook.v1',
    source: 'local-agent:active-window',
    channel: 'desktop',
    event: 'active_window_permission_needed',
    eventKind: 'tool_result',
    direction: 'tool',
    outcome: 'failure',
    kind: 'interrupted',
    score: 0.35,
    sessionId: sessionId('active-window'),
    workspace: workspaceArg(),
    device: platform(),
    app: 'evomate-local-agent',
    content: 'Active window monitor needs macOS Accessibility permission.',
    metadata: {
      error: redact(error instanceof Error ? error.message : String(error)),
      permission: 'macos_accessibility'
    },
    privacy: localPrivacy(),
    signals: ['local_agent', 'active_window', 'permission_needed']
  };
}

function gitEvent(snapshot: GitSnapshot, reason: 'snapshot' | 'changed'): EvoMateHookEvent {
  const content = `Git ${reason}: ${snapshot.changed} changed files on ${snapshot.branch} in ${snapshot.repoRoot}`;
  return {
    protocolVersion: 'evomate.hook.v1',
    source: 'local-agent:git',
    channel: 'desktop',
    event: `git_status_${reason}`,
    eventKind: 'tool_use',
    direction: 'lifecycle',
    sessionId: sessionId('git'),
    workspace: snapshot.repoRoot,
    cwd: snapshot.repoRoot,
    device: platform(),
    app: 'git',
    content,
    metadata: {
      repoRoot: snapshot.repoRoot,
      branch: snapshot.branch,
      changed: snapshot.changed,
      staged: snapshot.staged,
      unstaged: snapshot.unstaged,
      untracked: snapshot.untracked,
      sample: snapshot.sample,
      host: hostname(),
      reason
    },
    privacy: localPrivacy(),
    signals: ['local_agent', 'git_activity', 'workspace_context', 'coding_task']
  };
}

async function sendEvent(event: EvoMateHookEvent): Promise<unknown> {
  if (dryRun) return { dryRun: true, event };
  return compactReceipt(await client.send(event));
}

function compactReceipt(receipt: unknown): unknown {
  if (!receipt || typeof receipt !== 'object') return receipt;
  const body = receipt as {
    ok?: boolean;
    count?: number;
    results?: Array<{ route?: string; event?: { source?: string; eventKind?: string; channel?: string }; result?: { observed?: boolean; event?: string } }>;
    state?: { phase?: string; timeline?: Array<{ type?: string; summary?: string; createdAt?: string }> };
  };
  return {
    ok: body.ok,
    count: body.count,
    results: body.results?.map((item) => ({
      route: item.route,
      source: item.event?.source,
      channel: item.event?.channel,
      eventKind: item.event?.eventKind,
      observed: item.result?.observed,
      event: item.result?.event
    })),
    phase: body.state?.phase,
    latest: body.state?.timeline?.[0] ? {
      type: body.state.timeline[0].type,
      summary: body.state.timeline[0].summary,
      createdAt: body.state.timeline[0].createdAt
    } : undefined
  };
}

function parseArgs(argv: string[]): ArgMap & { _: string[] } {
  const parsed: ArgMap & { _: string[] } = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }
    const trimmed = token.slice(2);
    const eq = trimmed.indexOf('=');
    const key = toCamel(eq >= 0 ? trimmed.slice(0, eq) : trimmed);
    const value = eq >= 0 ? trimmed.slice(eq + 1) : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    parsed[key] = value;
  }
  return parsed;
}

function toCamel(value: string): string {
  return value.replace(/[-_]+([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function printHelp(): void {
  console.log([
    'EvoMate Local Agent',
    '',
    'Usage:',
    '  npm run evomate:local -- once --dry-run',
    '  npm run evomate:local -- monitor',
    '  npm run evomate:local -- active-window',
    '  npm run evomate:local -- git --workspace /path/to/repo',
    '  npm run evomate:local -- terminal-start --command "npm run check" --cwd "$PWD"',
    '  npm run evomate:local -- terminal-done --command "npm run check" --exit-code 0 --duration-ms 1200',
    '',
    `Default API: ${DEFAULT_API_URL}`
  ].join('\n'));
}

function workspaceArg(): string {
  return resolve(stringArg(args.workspace) || stringArg(args.cwd) || process.env.EVOMATE_WORKSPACE || process.env.INIT_CWD || process.cwd());
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberArg(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/api\/hook-events\/?$/, '').replace(/\/+$/, '');
}

function localPrivacy(): EvoMateHookEvent['privacy'] {
  return { consent: true, redaction: 'client', pii: 'possible', retention: 'short' };
}

function sessionId(scope: string): string {
  return `local_${scope}_${hash(`${hostname()}:${workspaceArg()}`).slice(0, 10)}`;
}

function terminalSessionId(cwd: string, commandText: string, at: number): string {
  return `terminal_${hash(`${hostname()}:${cwd}:${commandText}:${at}`).slice(0, 12)}`;
}

function inferAppSignal(app: string): string {
  const normalized = app.toLowerCase();
  if (/chrome|safari|edge|arc|firefox/.test(normalized)) return 'browser_context';
  if (/terminal|iterm|warp/.test(normalized)) return 'terminal_context';
  if (/code|cursor|xcode/.test(normalized)) return 'ide_context';
  if (/codex|claude|chatgpt|gemini/.test(normalized)) return 'ai_tool_context';
  return 'desktop_context';
}

function redact(value: string): string {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._=-]{12,}/gi, 'Bearer [redacted]')
    .replace(/sk-(?:evomap-)?[A-Za-z0-9_-]{16,}/g, 'sk-[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^"'\s,}]{6,}/gi, '$1[redacted]')
    .slice(0, 1600);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
