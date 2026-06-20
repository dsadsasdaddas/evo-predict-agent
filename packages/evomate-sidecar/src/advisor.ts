#!/usr/bin/env tsx
import { appendQueue, buildHookPayload, compactResponse, parseArgs, postJson, printHookFailure, printJson, readStdin } from './shared.js';

const args = parseArgs();
const stdinText = await readStdin();
const payload = buildHookPayload('advisor', args, stdinText);
const input = payload.content || '';
const hookJson = args.hookJson === true;
const hookEventName = typeof args.hookEventName === 'string' && args.hookEventName.trim()
  ? args.hookEventName.trim()
  : 'UserPromptSubmit';

if (!input.trim()) {
  if (hookJson) {
    printHookJson();
  } else {
    printJson({ ok: false, queued: false, error: 'input_required' });
  }
} else {
  try {
    const advisorPayload = {
      source: payload.source,
      event: payload.event,
      workspace: payload.workspace,
      sessionId: payload.sessionId,
      input,
      metadata: payload.metadata
    };
    const queuePath = await appendQueue('advisor', advisorPayload);
    const response = await postJson('/api/advisor/prepare', advisorPayload);
    if (hookJson) {
      printHookJson(response.advisorPrompt);
    } else if (args.text === true && response.advisorPrompt) {
      process.stdout.write(`${response.advisorPrompt}\n`);
    } else {
      printJson(compactResponse(response, { queued: false, queuePath }));
    }
  } catch (error) {
    if (hookJson) {
      printHookJson();
    } else {
      printHookFailure('advisor', error);
    }
  }
}

function printHookJson(advisorPrompt?: string): void {
  const additionalContext = limitAdditionalContext(advisorPrompt);
  if (!additionalContext) {
    printJson({});
    return;
  }

  printJson({
    hookSpecificOutput: {
      hookEventName,
      additionalContext
    }
  });
}

function limitAdditionalContext(value: string | undefined): string {
  if (!value?.trim()) return '';
  const limit = maxContextChars();
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 48)}\n\n[evomate: advisor context truncated]`;
}

function maxContextChars(): number {
  const raw = typeof args.maxContextChars === 'string'
    ? Number(args.maxContextChars)
    : Number(process.env.EVOMATE_ADVISOR_MAX_CONTEXT_CHARS || 9000);
  if (!Number.isFinite(raw)) return 9000;
  return Math.max(1000, Math.min(9800, Math.floor(raw)));
}
