import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { extractSignalsWithEvoMapLlm, getEvoMapLlmConfig, maintainNextStepWithEvoMapLlm, type MaintainedNextStepState } from './evomap-llm.js';
import { loadLocalEnv } from './env.js';
import { recordFeedbackGepAssets } from './gep-assets.js';
import { resolveFromProjectRoot } from './paths.js';
import {
  importRemoteEvolutionArtifacts,
  listRemoteEvolutionJobs,
  readRemoteEvolutionJob,
  submitRemoteEvolutionJob
} from './remote-jobs.js';
import { enhanceDecisionWithTrainedModels } from './trained-models.js';
import {
  EVOMATE_HOOK_PROTOCOL_VERSION,
  normalizeHookInput,
  toAgentObservePayload,
  toAgentOutcomePayload,
  type NormalizedEvoMateHookEvent
} from '@evomate/hooks';
import {
  applyFeedback,
  createInitialEvolutionState,
  EVOMATE_TECH_STACK,
  extractSignals,
  normalizeEvolutionState,
  previewFeedbackReward,
  selectBehaviorGeneDecision,
  type EvolutionState,
  type FeedbackInput,
  type RemoteEvolutionJob,
  type RemoteJobType,
  type UserInputSignal
} from '@evomate/core';

loadLocalEnv();

const PORT = Number(process.env.EVOMATE_API_PORT || process.env.PORT || 8787);
const STATE_DIR = process.env.EVOMATE_STATE_DIR
  ? resolveFromProjectRoot(process.env.EVOMATE_STATE_DIR)
  : resolveFromProjectRoot('memory/evomate');
const STATE_FILE = resolve(STATE_DIR, 'evolution-state.json');
const TRAIN_COOLDOWN_MS = Number(process.env.EVOMATE_TRAIN_COOLDOWN_MS || 15_000);

const app = new Hono();
app.use('*', cors());

const feedbackSchema = z.object({
  kind: z.enum(['accepted', 'corrected', 'interrupted', 'rejected', 'undo', 'manual_score']),
  text: z.string().optional(),
  score: z.number().min(0).max(1).optional(),
  geneId: z.string().optional(),
  signals: z.array(z.string()).optional()
});

const agentMetadataSchema = z.record(z.string(), z.unknown()).optional();

const agentEventSchema = z.object({
  source: z.string().default('manual'),
  event: z.string().default('user_message'),
  workspace: z.string().optional(),
  sessionId: z.string().optional(),
  content: z.string().optional(),
  cwd: z.string().optional(),
  metadata: agentMetadataSchema
});

const advisorSchema = z.object({
  source: z.string().default('manual'),
  event: z.string().default('advisor_prepare'),
  workspace: z.string().optional(),
  sessionId: z.string().optional(),
  input: z.string().min(1),
  metadata: agentMetadataSchema
});

const outcomeSchema = agentEventSchema.extend({
  kind: feedbackSchema.shape.kind.optional(),
  outcome: z.enum(['accepted', 'corrected', 'interrupted', 'rejected', 'undo', 'success', 'failure']).optional(),
  score: z.number().min(0).max(1).optional(),
  geneId: z.string().optional(),
  signals: z.array(z.string()).optional()
});

const remoteJobSchema = z.object({
  type: z.enum(['policy_replay_eval', 'evolution_gym_eval', 'preference_train', 'embedding_build']).default('evolution_gym_eval'),
  objective: z.string().optional(),
  source: z.string().default('control_plane'),
  executeRemote: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const historyQuerySchema = z.object({
  q: z.string().optional(),
  type: z.string().optional(),
  geneId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  jobs: z.coerce.boolean().default(false)
});

const memoryRouteSchema = z.object({
  input: z.string().optional(),
  source: z.string().default('memory_router'),
  signals: z.array(z.string()).optional()
});

app.get('/health', (c) => c.json({
  ok: true,
  service: 'evomate-api',
  port: PORT,
  evomapLlm: Boolean(getEvoMapLlmConfig()) && process.env.EVOMAP_LLM_DISABLED !== '1'
}));

app.get('/api/tech-stack', (c) => c.json(EVOMATE_TECH_STACK));

app.get('/api/evolution/state', async (c) => {
  const state = await loadStateWithMaintainedNextStep();
  return c.json(state);
});

app.get('/api/evolution/next-step', async (c) => {
  const state = await loadStateWithMaintainedNextStep();
  const runtimeState = state as RuntimeEvolutionState;
  return c.json({
    ok: true,
    nextStep: runtimeState.nextStep,
    latestEventId: state.timeline[0]?.id,
    maintainedBy: runtimeState.nextStep?.source || 'missing'
  });
});

app.get('/api/evolution/result', async (c) => {
  const state = await loadStateWithMaintainedNextStep();
  const memoryRoute = await buildMemoryRoute(state as RuntimeEvolutionState);
  return c.json(buildEvolutionResultResponse(state as RuntimeEvolutionState, memoryRoute));
});

app.get('/api/memory/route', async (c) => {
  const state = await loadState();
  return c.json(await buildMemoryRoute(state as RuntimeEvolutionState));
});

app.post('/api/memory/route', async (c) => {
  const parsed = memoryRouteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_memory_route_request', details: parsed.error.flatten() }, 400);

  const state = await loadState();
  return c.json(await buildMemoryRoute(state as RuntimeEvolutionState, parsed.data));
});

app.get('/api/evolution/history', async (c) => {
  const parsed = historyQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'invalid_history_query', details: parsed.error.flatten() }, 400);

  const state = await loadState();
  const query = parsed.data.q?.trim().toLowerCase();
  const type = parsed.data.type?.trim();
  const geneId = parsed.data.geneId?.trim();
  const timeline = state.timeline
    .filter((item) => !type || item.type === type)
    .filter((item) => !geneId || item.geneId === geneId)
    .filter((item) => {
      if (!query) return true;
      return [
        item.type,
        item.summary,
        item.geneId,
        ...(item.signals ?? [])
      ].filter(Boolean).join(' ').toLowerCase().includes(query);
    })
    .slice(0, parsed.data.limit)
    .map((item) => ({
      id: item.id,
      type: item.type,
      summary: item.summary,
      score: item.score,
      geneId: item.geneId,
      signals: item.signals,
      createdAt: item.createdAt
    }));
  const jobs = parsed.data.jobs
    ? (await listRemoteEvolutionJobs()).slice(0, parsed.data.limit).map(compactRemoteJobSummary)
    : undefined;

  return c.json({
    ok: true,
    query: {
      q: parsed.data.q,
      type,
      geneId,
      limit: parsed.data.limit,
      jobs: parsed.data.jobs
    },
    totalTimeline: state.timeline.length,
    count: timeline.length,
    timeline,
    jobs
  });
});

app.post('/api/evolution/train', async (c) => {
  const parsed = remoteJobSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_train_request', details: parsed.error.flatten() }, 400);

  const state = await loadState();
  const jobType = parsed.data.type as RemoteJobType;
  const existingJob = await findReusableTrainJob(jobType, Boolean(parsed.data.executeRemote));
  if (existingJob) {
    return c.json({
      ok: true,
      action: 'train_reused',
      job: compactRemoteJob(existingJob),
      mode: 'reused',
      reused: true,
      stateSummary: compactStateSummary(state)
    });
  }

  const result = await submitRemoteEvolutionJob({
    ...parsed.data,
    type: jobType,
    source: parsed.data.source === 'control_plane' ? 'slash_train' : parsed.data.source,
    objective: parsed.data.objective || defaultTrainingObjective(jobType)
  }, state);
  const nextState = prependTimeline(state, [runtimeTimelineEvent({
    type: 'remote_job_queued',
    summary: `/train queued ${result.job.type} as ${result.job.jobId} in ${result.mode}`,
    score: 0.62,
    signals: ['remote_compute', 'background_training', result.job.type]
  })], 'reflect');
  await saveState(nextState);

  return c.json({
    ok: true,
    action: 'train_queued',
    job: compactRemoteJob(result.job),
    datasetPath: result.datasetPath,
    manifestPath: result.manifestPath,
    mode: result.mode,
    commandLog: result.commandLog,
    stateSummary: compactStateSummary(nextState)
  });
});

app.get('/api/remote-jobs', async (c) => {
  const jobs = await listRemoteEvolutionJobs();
  return c.json({ ok: true, jobs });
});

app.post('/api/remote-jobs/submit', async (c) => {
  const parsed = remoteJobSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_remote_job', details: parsed.error.flatten() }, 400);

  const state = await loadState();
  const result = await submitRemoteEvolutionJob({
    ...parsed.data,
    type: parsed.data.type as RemoteJobType
  }, state);
  await saveState(prependTimeline(state, [runtimeTimelineEvent({
    type: 'remote_job_queued',
    summary: `Remote ${result.job.type} queued as ${result.job.jobId} in ${result.mode}`,
    score: 0.55,
    signals: ['remote_compute', result.job.type]
  })], 'reflect'));
  return c.json(result);
});

app.get('/api/remote-jobs/:jobId', async (c) => {
  try {
    const job = await readRemoteEvolutionJob(c.req.param('jobId'));
    return c.json({ ok: true, job });
  } catch (err) {
    return c.json({ error: 'remote_job_not_found', details: err instanceof Error ? err.message : String(err) }, 404);
  }
});

app.post('/api/remote-jobs/:jobId/import', async (c) => {
  try {
    const result = await importRemoteEvolutionArtifacts(c.req.param('jobId'));
    const state = await loadState();
    await saveState(prependTimeline(state, [runtimeTimelineEvent({
      type: 'remote_job_imported',
      summary: `Imported ${result.job.artifactSummary?.evolutionBundleId || result.job.jobId}; validation=${Math.round((result.job.artifactSummary?.validationScore || 0) * 100)}%`,
      score: result.job.artifactSummary?.validationScore ?? 0.75,
      signals: ['remote_compute', result.job.type, 'training_artifacts']
    })], 'solidify_capsule'));
    return c.json(result);
  } catch (err) {
    return c.json({ error: 'remote_artifact_import_failed', details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post('/api/interactions/analyze', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = typeof body.input === 'string' ? body.input : '';
  if (!input.trim()) return c.json({ error: 'input_required' }, 400);

  const state = await loadState();
  const advisor = await prepareAdvisor(input, state, {
    source: typeof body.source === 'string' ? body.source : 'manual',
    event: 'interaction_analyze',
    workspace: typeof body.workspace === 'string' ? body.workspace : undefined,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined
  });
  const { signalExtraction, signal, policyDecision, trainedModelInsight, gene, predictedSatisfaction } = advisor;

  const nextState = prependTimeline(
    state,
    buildAdvisorTrace(input, { source: typeof body.source === 'string' ? body.source : 'manual', event: 'interaction_analyze' }, advisor),
    'strategy_decision'
  );
  await saveState(nextState);

  return c.json({
    semantic: signal.semantic,
    signal,
    signalExtraction,
    gene,
    policyDecision,
    trainedModelInsight,
    predictedSatisfaction,
    advisorPrompt: advisor.advisorPrompt,
    memoryRoute: compactMemoryRoute(advisor.memoryRoute),
    state: nextState
  });
});

app.post('/api/feedback', async (c) => {
  const parsed = feedbackSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_feedback', details: parsed.error.flatten() }, 400);

  const state = await loadState();
  const rewardPreview = previewFeedbackReward(parsed.data);
  const feedbackState = applyFeedback(state, parsed.data);
  const gepAssets = await recordFeedbackGepAssets({
    beforeState: state,
    afterState: feedbackState,
    feedback: parsed.data,
    reward: rewardPreview,
    prompt: parsed.data.text
  });
  const nextState = prependTimeline(feedbackState, [runtimeTimelineEvent({
    type: 'gep_assets_written',
    summary: `GEP wrote ${gepAssets.written?.map((asset: { type?: string }) => asset.type).filter(Boolean).join(' + ') || 'evolution assets'} for feedback ${parsed.data.kind}`,
    score: rewardPreview.yesness,
    geneId: parsed.data.geneId,
    signals: parsed.data.signals
  })], 'record_outcome');
  await saveState(nextState);
  return c.json({ ok: true, reward: rewardPreview, gepAssets, state: nextState });
});

app.post('/api/advisor/prepare', async (c) => {
  const parsed = advisorSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_advisor_request', details: parsed.error.flatten() }, 400);

  const state = await loadState();
  const advisor = await prepareAdvisor(parsed.data.input, state, parsed.data);
  const nextState = prependTimeline(state, buildAdvisorTrace(parsed.data.input, parsed.data, advisor), 'strategy_decision');
  await saveState(nextState);
  return c.json({
    ok: true,
    mode: 'read_only_advisor',
    source: normalizeHookText(parsed.data.source, 'manual'),
    workspace: parsed.data.workspace,
    sessionId: parsed.data.sessionId,
    advisorPrompt: advisor.advisorPrompt,
    semantic: advisor.signal.semantic,
    signal: advisor.signal,
    signalExtraction: advisor.signalExtraction,
    gene: advisor.gene,
    policyDecision: advisor.policyDecision,
    trainedModelInsight: advisor.trainedModelInsight,
    predictedSatisfaction: advisor.predictedSatisfaction,
    memoryRoute: compactMemoryRoute(advisor.memoryRoute)
  });
});

app.post('/api/hook-events', async (c) => {
  const normalized = normalizeHookInput(await c.req.json().catch(() => ({})));
  if (!normalized.ok) {
    return c.json({
      error: 'invalid_hook_event',
      protocolVersion: EVOMATE_HOOK_PROTOCOL_VERSION,
      details: normalized.errors
    }, 400);
  }

  const results: Array<Record<string, unknown>> = [];
  let latestState: EvolutionState | undefined;

  for (const hookEvent of normalized.events) {
    const dispatch = await dispatchHookEvent(hookEvent);
    if (dispatch.state) latestState = dispatch.state;
    results.push({
      route: hookEvent.route,
      event: compactHookEvent(hookEvent),
      result: compactDispatchBody(dispatch.body)
    });
  }

  return c.json({
    ok: true,
    protocolVersion: EVOMATE_HOOK_PROTOCOL_VERSION,
    mode: 'omni_hook_protocol',
    count: results.length,
    results,
    state: latestState
  });
});

app.post('/api/agent-events/observe', async (c) => {
  const parsed = agentEventSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_agent_event', details: parsed.error.flatten() }, 400);

  const result = await processAdvisorEvent(parsed.data, 'non_blocking_sidecar');
  if (result.status === 202) return c.json(result.body, 202);
  return c.json(result.body);
});

app.post('/api/agent-events/outcome', async (c) => {
  const parsed = outcomeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_agent_outcome', details: parsed.error.flatten() }, 400);

  const result = await processOutcomeEvent(parsed.data, 'non_blocking_sidecar');
  return c.json(result.body);
});

app.get('/api/events', async (c) => {
  const state = await loadState();
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  return c.body(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
});

interface DispatchResult {
  status: 200 | 202;
  body: Record<string, unknown>;
  state?: EvolutionState;
}

async function dispatchHookEvent(hookEvent: NormalizedEvoMateHookEvent): Promise<DispatchResult> {
  if (hookEvent.route === 'advisor') {
    return processAdvisorEvent(toAgentObservePayload(hookEvent), 'omni_hook_protocol');
  }
  if (hookEvent.route === 'outcome') {
    return processOutcomeEvent(toAgentOutcomePayload(hookEvent), 'omni_hook_protocol');
  }
  if (hookEvent.route === 'observe') {
    return processObserveOnlyHookEvent(hookEvent);
  }

  return {
    status: 202,
    body: {
      ok: true,
      observed: false,
      reason: 'ignored_hook_event',
      mode: 'omni_hook_protocol',
      source: hookEvent.source,
      event: hookEvent.event,
      channel: hookEvent.channel,
      eventKind: hookEvent.eventKind
    }
  };
}

async function processAdvisorEvent(rawEvent: AgentEventInput, mode: string): Promise<DispatchResult> {
  const event = normalizeAgentEvent(rawEvent);
  const content = extractAgentEventContent(event);
  if (!content.trim()) {
    return {
      status: 202,
      body: {
        ok: true,
        observed: false,
        reason: 'empty_content',
        mode
      }
    };
  }

  const state = await loadState();
  const advisor = await prepareAdvisor(content, state, event);
  const nextState = prependTimeline(state, buildAdvisorTrace(content, event, advisor), 'strategy_decision');
  await saveState(nextState);

  return {
    status: 200,
    state: nextState,
    body: {
      ok: true,
      observed: true,
      mode,
      source: event.source,
      event: event.event,
      workspace: event.workspace,
      sessionId: event.sessionId,
      advisorPrompt: advisor.advisorPrompt,
      semantic: advisor.signal.semantic,
      signal: advisor.signal,
      signalExtraction: advisor.signalExtraction,
      gene: advisor.gene,
      policyDecision: advisor.policyDecision,
      trainedModelInsight: advisor.trainedModelInsight,
      predictedSatisfaction: advisor.predictedSatisfaction,
      memoryRoute: compactMemoryRoute(advisor.memoryRoute),
      state: nextState
    }
  };
}

async function processOutcomeEvent(input: OutcomeInput, mode: string): Promise<DispatchResult> {
  const event = normalizeAgentEvent(input);
  const content = extractAgentEventContent(event);
  const inferred = content.trim() ? extractSignals(content) : undefined;
  const feedback: FeedbackInput = {
    kind: inferFeedbackKind(input),
    text: content || `${event.source}:${event.event}`,
    score: input.score,
    geneId: input.geneId,
    signals: input.signals?.length ? input.signals : inferred?.signals
  };

  const state = await loadState();
  const rewardPreview = previewFeedbackReward(feedback);
  const feedbackState = applyFeedback(state, feedback);
  const gepAssets = await recordFeedbackGepAssets({
    beforeState: state,
    afterState: feedbackState,
    feedback,
    reward: rewardPreview,
    prompt: content
  });
  const nextState = prependTimeline(feedbackState, [runtimeTimelineEvent({
    type: 'gep_assets_written',
    summary: `GEP wrote ${gepAssets.written?.map((asset: { type?: string }) => asset.type).filter(Boolean).join(' + ') || 'evolution assets'} for outcome ${feedback.kind}`,
    score: rewardPreview.yesness,
    geneId: feedback.geneId,
    signals: feedback.signals
  })], 'record_outcome');
  await saveState(nextState);

  return {
    status: 200,
    state: nextState,
    body: {
      ok: true,
      mode,
      source: event.source,
      event: event.event,
      workspace: event.workspace,
      sessionId: event.sessionId,
      feedback,
      reward: rewardPreview,
      gepAssets,
      state: nextState
    }
  };
}

async function processObserveOnlyHookEvent(hookEvent: NormalizedEvoMateHookEvent): Promise<DispatchResult> {
  const state = await loadState();
  const channelSignal = `channel_${hookEvent.channel.replace(/[^a-z0-9]+/g, '_')}`;
  const kindSignal = `hook_${hookEvent.eventKind.replace(/[^a-z0-9]+/g, '_')}`;
  const nextState = prependTimeline(state, [runtimeTimelineEvent({
    type: 'omni_hook_received',
    summary: `${hookEvent.channel}:${hookEvent.eventKind} observed from ${hookEvent.source}`,
    score: hookEvent.content?.trim() ? 0.52 : 0.42,
    signals: [...new Set(['omni_hook', channelSignal, kindSignal, ...hookEvent.signals])]
  })], 'user_input_received');
  await saveState(nextState);

  return {
    status: 200,
    state: nextState,
    body: {
      ok: true,
      observed: true,
      mode: 'omni_hook_protocol',
      source: hookEvent.source,
      event: hookEvent.event,
      channel: hookEvent.channel,
      eventKind: hookEvent.eventKind,
      route: hookEvent.route,
      state: nextState
    }
  };
}

function compactHookEvent(event: NormalizedEvoMateHookEvent): Record<string, unknown> {
  return {
    protocolVersion: event.protocolVersion,
    source: event.source,
    channel: event.channel,
    event: event.event,
    eventKind: event.eventKind,
    direction: event.direction,
    route: event.route,
    sessionId: event.sessionId,
    workspace: event.workspace,
    url: event.url,
    device: event.device,
    contentLength: event.content?.length ?? 0,
    signals: event.signals
  };
}

function compactDispatchBody(body: Record<string, unknown>): Record<string, unknown> {
  const semantic = isRecord(body.semantic) ? body.semantic : undefined;
  const gene = isRecord(body.gene) ? body.gene : undefined;
  const reward = isRecord(body.reward) ? body.reward : undefined;
  const gepAssets = isRecord(body.gepAssets) ? body.gepAssets : undefined;
  return {
    ok: body.ok,
    observed: body.observed,
    mode: body.mode,
    source: body.source,
    event: body.event,
    workspace: body.workspace,
    sessionId: body.sessionId,
    gene: gene ? { id: gene.id, label: gene.label } : undefined,
    predictedSatisfaction: body.predictedSatisfaction,
    semantic: semantic ? {
      taskType: semantic.taskType,
      intent: semantic.intent,
      riskLevel: semantic.riskLevel,
      permissionMode: semantic.permissionMode,
      confidence: semantic.confidence,
      signals: semantic.signals
    } : undefined,
    feedback: body.feedback,
    reward: reward ? { reward: reward.reward, yesness: reward.yesness, kind: reward.kind } : undefined,
    gepAssets: gepAssets ? { written: gepAssets.written } : undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function loadState(): Promise<EvolutionState> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<EvolutionState>;
    return normalizeEvolutionState(parsed);
  } catch {
    const initial = createInitialEvolutionState();
    await saveState(initial);
    return initial;
  }
}

async function saveState(state: EvolutionState, options: { maintainNextStep?: boolean } = {}): Promise<void> {
  if (options.maintainNextStep) {
    const nextState = await attachMaintainedNextStep(state);
    await persistState(nextState);
    return;
  }
  await persistState(state);
}

async function persistState(state: EvolutionState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function loadStateWithMaintainedNextStep(): Promise<RuntimeEvolutionState> {
  const state = await loadState();
  const runtimeState = state as RuntimeEvolutionState;
  const previousNextStep = runtimeState.nextStep;
  const nextState = await attachMaintainedNextStep(state);
  if (nextState.nextStep !== previousNextStep) await persistState(nextState);
  return nextState;
}

async function attachMaintainedNextStep(state: EvolutionState): Promise<RuntimeEvolutionState> {
  const runtimeState = state as RuntimeEvolutionState;
  const latestEventId = state.timeline[0]?.id;
  const hasLlmConfig = Boolean(getEvoMapLlmConfig())
    && process.env.EVOMATE_NEXT_STATE_DISABLED !== '1'
    && process.env.EVOMATE_NEXT_STATE_DISABLED !== 'true'
    && process.env.EVOMAP_LLM_DISABLED !== '1'
    && process.env.EVOMAP_LLM_DISABLED !== 'true';
  const current = runtimeState.nextStep;
  const currentMatchesLatest = latestEventId && current?.inputEventId === latestEventId;
  const cachedStateStillValid = currentMatchesLatest && (
    current?.used
    || (!hasLlmConfig && current?.enabled === false)
  );
  if (cachedStateStillValid) return runtimeState;
  runtimeState.nextStep = await maintainNextStepWithEvoMapLlm(state);
  return runtimeState;
}

function buildEvolutionResultResponse(state: RuntimeEvolutionState, memoryRoute: MemoryRouteResponse) {
  const nextStep = state.nextStep;
  const latest = state.timeline[0];
  const feedbackEvent = state.timeline.find((item) => /feedback|policy_reward|outcome|corrected|interrupted|undo|手机端反馈/i.test(`${item.type} ${item.summary}`));
  const mutationEvent = state.timeline.find((item) => /gep_assets_written|mutation|capsule|evolutionevent|remote_job_imported/i.test(`${item.type} ${item.summary}`));
  const visible = nextStep?.visibleEvolution;
  const activeGene = activeGeneLabelFromState(state);
  const beforeScore = clampScore((nextStep?.confidence ?? latest?.score ?? 0.62) - 0.22);
  const afterScore = clampScore(Math.max(nextStep?.confidence ?? latest?.score ?? 0.72, beforeScore + 0.18));
  const mutation = nextStep?.mutation
    || nextStep?.gepAsset?.mutation
    || inferResultMutationFromTimeline(state.timeline, activeGene);

  return {
    ok: true,
    schemaVersion: 'evomate.evolution_result.v1',
    generatedAt: new Date().toISOString(),
    maintainedBy: nextStep?.source ?? 'missing',
    usedClaude: nextStep?.source === 'evomap_claude' && nextStep.used === true,
    enabled: nextStep?.enabled ?? false,
    model: nextStep?.model,
    mode: mutationEvent || nextStep?.gepAsset ? 'live_proof' : 'ready',
    latestEventId: latest?.id,
    before: {
      title: 'Before',
      body: visible?.before ?? '进化前：Agent 按通用助手习惯行动，还没有完全贴合这个用户的工作方式。',
      score: beforeScore
    },
    feedback: {
      text: feedbackEvent?.summary ?? visible?.proof ?? '等待用户反馈按钮或 hook outcome 给这次行为打分。',
      eventId: feedbackEvent?.id,
      score: feedbackEvent?.score
    },
    mutation: {
      text: mutation,
      eventId: mutationEvent?.id,
      asset: nextStep?.gepAsset
    },
    after: {
      title: activeGene,
      body: visible?.after ?? nextStep?.nextStep ?? `进化后：下一次相似场景优先复用 ${activeGene} 的行为策略。`,
      score: afterScore
    },
    nextAdvisor: nextStep?.nextStep ?? '下一次相似任务会先召回 GEP 经验，再选择行为基因。',
    demoAction: visible?.demoAction ?? '发送下一条相似 hook，然后观察 Gene、Mutation 和 Advisor 文案变化。',
    proof: [
      { label: 'Gene', value: activeGene, ok: Boolean(activeGene) },
      { label: 'Mutation', value: mutationEvent || nextStep?.mutation ? 'written' : 'pending', ok: Boolean(mutationEvent || nextStep?.mutation) },
      { label: 'Capsule', value: String(memoryRoute.gepProof.capsules), ok: memoryRoute.gepProof.capsules > 0 },
      { label: 'Event', value: String(memoryRoute.gepProof.events || state.timeline.length), ok: state.timeline.length > 0 }
    ],
    evomapSharing: nextStep?.evomapSharing,
    nextStep
  };
}

function activeGeneLabelFromState(state: EvolutionState): string {
  const gene = state.activeGenes[0] as unknown as Record<string, unknown> | undefined;
  return typeof gene?.label === 'string'
    ? gene.label.replace(/：.*$/, '')
    : typeof gene?.id === 'string'
      ? gene.id.replace(/^gene_/, '').replace(/_/g, ' ')
      : 'Behavior Gene';
}

function inferResultMutationFromTimeline(timeline: EvolutionState['timeline'], activeGene: string): string {
  const text = timeline.map((item) => `${item.type} ${item.summary} ${(item.signals || []).join(' ')}`).join(' ').toLowerCase();
  if (/too_risky|ask_before|冒进|先确认/.test(text)) return 'Mutation: high-risk execution must ask first for this user.';
  if (/too_shallow|deeper|深入|太浅/.test(text)) return 'Mutation: shallow answers are penalized; use deeper reasoning before action.';
  if (/too_verbose|prefer_concise|啰嗦|更短|直接|too_slow|prefer_fast|更快/.test(text)) return 'Mutation: coding/product tasks should prefer direct execution and concise reporting.';
  return `Mutation: strengthen ${activeGene} when similar signals reappear.`;
}

type AgentEventInput = z.infer<typeof agentEventSchema>;
type OutcomeInput = z.infer<typeof outcomeSchema>;
type RuntimeEvolutionState = EvolutionState & { nextStep?: MaintainedNextStepState };
type MemoryRouteInput = z.infer<typeof memoryRouteSchema>;
type MemoryExpertId = 'episodic' | 'procedural' | 'validation' | 'repo' | 'preference' | 'policy';
type MemoryExpertStatus = 'active' | 'ready' | 'cold';

interface MemoryRecall {
  id: string;
  type: MemoryExpertId | 'failure';
  title: string;
  body: string;
  source: string;
  confidence: number;
}

interface MemoryExpertRoute {
  id: MemoryExpertId;
  label: string;
  role: string;
  score: number;
  status: MemoryExpertStatus;
  evidence: string;
  signals: string[];
  memories: MemoryRecall[];
}

interface MemoryRouteResponse {
  ok: true;
  schemaVersion: 'evomate.memory_router.v1';
  mode: 'engineering_moe';
  activeExpert: MemoryExpertId;
  confidence: number;
  experts: MemoryExpertRoute[];
  recalledMemories: MemoryRecall[];
  routePlan: string[];
  gepProof: {
    genes: number;
    capsules: number;
    events: number;
    latestAsset?: string;
    validationReady: boolean;
  };
  latestEventId?: string;
  generatedAt: string;
}

interface AdvisorContext {
  source?: string;
  event?: string;
  workspace?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

type TimelineEventInput = {
  type: string;
  summary: string;
  score?: number;
  geneId?: string;
  signals?: string[];
};

function runtimeTimelineEvent(input: TimelineEventInput): EvolutionState['timeline'][number] {
  return {
    id: `evt_${input.type}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type: input.type,
    summary: input.summary,
    score: clampScore(input.score ?? 0.5),
    createdAt: new Date().toISOString(),
    geneId: input.geneId,
    signals: input.signals
  };
}

function prependTimeline(state: EvolutionState, events: Array<EvolutionState['timeline'][number]>, phase: EvolutionState['phase']): EvolutionState {
  return {
    ...state,
    phase,
    timeline: [...events, ...state.timeline].slice(0, 100)
  };
}

async function findReusableTrainJob(type: RemoteJobType, executeRemote: boolean): Promise<RemoteEvolutionJob | undefined> {
  if (!TRAIN_COOLDOWN_MS || TRAIN_COOLDOWN_MS < 1) return undefined;
  const now = Date.now();
  const jobs = await listRemoteEvolutionJobs();
  return jobs.find((job) => (
    job.type === type
    && job.target?.executeRemote === executeRemote
    && ['queued', 'syncing', 'running'].includes(job.status)
    && now - Date.parse(job.createdAt) <= TRAIN_COOLDOWN_MS
  ));
}

function compactRemoteJob(job: RemoteEvolutionJob): Record<string, unknown> {
  return {
    jobId: job.jobId,
    type: job.type,
    status: job.status,
    objective: job.objective,
    source: job.source,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    datasetPath: job.datasetPath,
    artifactPath: job.artifactPath,
    error: job.error,
    target: job.target ? {
      host: job.target.host,
      port: job.target.port,
      user: job.target.user,
      rootDir: job.target.rootDir,
      executeRemote: job.target.executeRemote
    } : undefined,
    pipeline: job.pipeline,
    artifactSummary: job.artifactSummary
  };
}

function compactRemoteJobSummary(job: RemoteEvolutionJob): Record<string, unknown> {
  return {
    jobId: job.jobId,
    type: job.type,
    status: job.status,
    source: job.source,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    mode: job.target?.executeRemote ? 'ssh' : 'dry_run',
    artifactSummary: job.artifactSummary ? {
      validationScore: job.artifactSummary.validationScore,
      suggestedMutationCount: job.artifactSummary.suggestedMutationCount,
      evolutionBundleId: job.artifactSummary.evolutionBundleId
    } : undefined
  };
}

function compactStateSummary(state: EvolutionState): Record<string, unknown> {
  return {
    assistantId: state.assistantId,
    generation: state.generation,
    phase: state.phase,
    understandingScore: state.understandingScore,
    metrics: state.metrics,
    latestTimeline: state.timeline.slice(0, 5).map((item) => ({
      id: item.id,
      type: item.type,
      summary: item.summary,
      score: item.score,
      geneId: item.geneId,
      signals: item.signals,
      createdAt: item.createdAt
    })),
    activeGenes: state.activeGenes.slice(0, 8).map((gene) => ({
      id: gene.id,
      label: gene.label,
      weight: gene.weight,
      fitness: gene.fitness
    }))
  };
}

async function buildMemoryRoute(state: RuntimeEvolutionState, routeInput?: MemoryRouteInput): Promise<MemoryRouteResponse> {
  const timeline = state.timeline.filter((item) => !/roadshow/i.test(item.summary)).slice(0, 100);
  const latest = timeline[0];
  const inferred = routeInput?.input?.trim() ? extractSignals(routeInput.input) : undefined;
  const inputSignals = uniqueSignals([
    ...(routeInput?.signals ?? []),
    ...(inferred?.signals ?? [])
  ]);
  const routeSignals = uniqueSignals([
    ...(latest?.signals ?? []),
    ...inputSignals
  ]);

  const episodicEvents = timeline.filter((item) => /hook|advisor|semantic|omni/i.test(item.type));
  const proceduralEvents = timeline.filter((item) => /gep|capsule|mutation|remote_job_imported|recipe|workflow/i.test(memorySearchText(item)));
  const validationEvents = timeline.filter((item) => /validation|command|tool_result|policy_reward|feedback|outcome|failed|success|check|build/i.test(memorySearchText(item)));
  const repoEvents = timeline.filter((item) => /git|terminal|local-agent|workspace|file|command|repo/i.test(memorySearchText(item)));
  const preferenceEvents = timeline.filter((item) => /corrected|accepted|interrupted|rejected|undo|prefer|too_|feedback|不懂|啰嗦|太慢|冒进/i.test(memorySearchText(item)));
  const policyEvents = timeline.filter((item) => /tournament|gene|policy|reward|yesness|bandit/i.test(memorySearchText(item)));
  const topGene = [...state.activeGenes].sort((a, b) => (b.fitness + b.weight) - (a.fitness + a.weight))[0];
  const activeExpert = pickMemoryExpert(latest, inputSignals, routeInput?.input);
  const gepCounts = await readGepAssetCounts();

  const memories: MemoryRecall[] = [
    latest ? timelineMemory(latest, 'episodic', 'Latest live turn', 0.72) : undefined,
    firstMemory(proceduralEvents, 'procedural', 'Reusable procedure / GEP trace', 0.76),
    firstMemory(validationEvents, 'validation', 'Validation evidence', 0.74),
    firstMemory(repoEvents, 'repo', 'Repository / local workflow', 0.7),
    firstMemory(preferenceEvents, 'preference', 'User preference signal', 0.78),
    topGene ? {
      id: `mem_gene_${topGene.id}`,
      type: 'policy',
      title: 'Current behavior gene',
      body: `${topGene.label}: ${topGene.summary}`,
      source: topGene.id,
      confidence: clampScore((topGene.fitness + topGene.weight) / 2)
    } : undefined
  ].filter((item): item is MemoryRecall => Boolean(item));

  const experts: MemoryExpertRoute[] = [
    makeMemoryExpert({
      id: 'episodic',
      activeExpert,
      label: 'Episodic',
      role: '最近会话、hook、工具调用和用户上下文',
      baseScore: 0.48,
      events: episodicEvents,
      signals: routeSignals,
      memories
    }),
    makeMemoryExpert({
      id: 'procedural',
      activeExpert,
      label: 'Procedural',
      role: '把做事方法沉淀成 GEP Capsule / workflow recipe',
      baseScore: 0.52,
      events: proceduralEvents,
      signals: routeSignals,
      memories
    }),
    makeMemoryExpert({
      id: 'validation',
      activeExpert,
      label: 'Validation',
      role: '测试、命令结果、失败样本和可复用约束',
      baseScore: 0.46,
      events: validationEvents,
      signals: routeSignals,
      memories
    }),
    makeMemoryExpert({
      id: 'repo',
      activeExpert,
      label: 'Repo',
      role: '项目结构、文件变更、Git/Terminal 活动',
      baseScore: 0.42,
      events: repoEvents,
      signals: routeSignals,
      memories
    }),
    makeMemoryExpert({
      id: 'preference',
      activeExpert,
      label: 'Preference',
      role: '用户口味、禁忌、纠正、yes/no 反馈',
      baseScore: 0.5,
      events: preferenceEvents,
      signals: routeSignals,
      memories
    }),
    makeMemoryExpert({
      id: 'policy',
      activeExpert,
      label: 'Policy',
      role: '行为基因、bandit、reward 和 yesness 策略',
      baseScore: 0.5,
      events: policyEvents,
      signals: routeSignals,
      memories
    })
  ].sort((a, b) => {
    if (a.id === activeExpert) return -1;
    if (b.id === activeExpert) return 1;
    return b.score - a.score;
  });

  const active = experts.find((expert) => expert.id === activeExpert) ?? experts[0];
  const recalledMemories = [...memories]
    .sort((a, b) => {
      if (a.type === activeExpert) return -1;
      if (b.type === activeExpert) return 1;
      return b.confidence - a.confidence;
    })
    .slice(0, 5);

  return {
    ok: true,
    schemaVersion: 'evomate.memory_router.v1',
    mode: 'engineering_moe',
    activeExpert,
    confidence: active.score,
    experts,
    recalledMemories,
    routePlan: [
      `retrieve:${activeExpert} · ${active.evidence}`,
      `route:${routeSignals.slice(0, 4).join(', ') || 'latest_timeline'}`,
      `execute:${topGene?.id ?? state.activeGenes[0]?.id ?? 'default_gene'} · ${state.nextStep?.stage ?? state.phase}`,
      'solidify: feedback/outcome -> GEP Mutation + EvolutionEvent + Capsule when stable'
    ],
    gepProof: {
      genes: Math.max(state.activeGenes.length, gepCounts.genes),
      capsules: gepCounts.capsules || proceduralEvents.length,
      events: gepCounts.events || timeline.filter((item) => /gep|mutation|capsule/i.test(memorySearchText(item))).length,
      latestAsset: gepCounts.latestAsset ?? firstMemory(proceduralEvents, 'procedural', 'Latest GEP trace', 0.7)?.body,
      validationReady: validationEvents.length > 0 || gepCounts.events > 0
    },
    latestEventId: latest?.id,
    generatedAt: new Date().toISOString()
  };
}

function makeMemoryExpert(input: {
  id: MemoryExpertId;
  activeExpert: MemoryExpertId;
  label: string;
  role: string;
  baseScore: number;
  events: EvolutionState['timeline'];
  signals: string[];
  memories: MemoryRecall[];
}): MemoryExpertRoute {
  const eventScore = Math.min(0.24, input.events.length * 0.035);
  const signalScore = Math.min(0.12, input.signals.filter((signal) => signalMatchesExpert(signal, input.id)).length * 0.04);
  const activeBoost = input.id === input.activeExpert ? 0.2 : 0;
  const score = clampScore(input.baseScore + eventScore + signalScore + activeBoost);
  const memoryMatches = input.memories.filter((memory) => memory.type === input.id).slice(0, 2);
  return {
    id: input.id,
    label: input.label,
    role: input.role,
    score,
    status: input.id === input.activeExpert ? 'active' : input.events.length || memoryMatches.length ? 'ready' : 'cold',
    evidence: cleanMemoryText(input.events[0]?.summary || memoryMatches[0]?.body || 'waiting for matching signal'),
    signals: input.signals.filter((signal) => signalMatchesExpert(signal, input.id)).slice(0, 5),
    memories: memoryMatches
  };
}

function pickMemoryExpert(event?: EvolutionState['timeline'][number], signals: string[] = [], input = ''): MemoryExpertId {
  const inputExpert = input.trim() ? pickMemoryExpertFromText(input.toLowerCase()) : undefined;
  if (inputExpert) return inputExpert;
  const signalExpert = signals.length ? pickMemoryExpertFromText(signals.join(' ').toLowerCase()) : undefined;
  if (signalExpert) return signalExpert;
  return pickMemoryExpertFromText(memorySearchText(event).toLowerCase()) ?? 'episodic';
}

function pickMemoryExpertFromText(text: string): MemoryExpertId | undefined {
  if (/不懂|啰嗦|太慢|冒进|少废话|直接|简洁|prefer|too_verbose|too_slow|too_shallow|too_risky|concise|fast/.test(text)) return 'preference';
  if (/validation|command|tool_result|failed|success|check|build|test|error|验证|测试|检查|失败|报错|构建/.test(text)) return 'validation';
  if (/gep|capsule|mutation|recipe|workflow|remote_job_imported|procedure/.test(text)) return 'procedural';
  if (/git|terminal|local-agent|workspace|file|repo|diff/.test(text)) return 'repo';
  if (/corrected|accepted|interrupted|rejected|undo|prefer|too_|feedback|不懂|啰嗦|太慢|冒进/.test(text)) return 'preference';
  if (/tournament|gene|policy|reward|yesness|bandit/.test(text)) return 'policy';
  if (/hook|browser|mobile|codex|claude|gemini|chat|message|turn/.test(text)) return 'episodic';
  return undefined;
}

function signalMatchesExpert(signal: string, expert: MemoryExpertId): boolean {
  const text = signal.toLowerCase();
  switch (expert) {
    case 'episodic':
      return /hook|message|browser|mobile|codex|claude|gemini|chat|turn/.test(text);
    case 'procedural':
      return /gep|capsule|mutation|workflow|architecture|mcp|procedure|remote_compute/.test(text);
    case 'validation':
      return /validation|command|test|build|risk|permission|outcome|failure/.test(text);
    case 'repo':
      return /git|terminal|repo|workspace|file|local|desktop/.test(text);
    case 'preference':
      return /prefer|too|feedback|correction|accepted|interrupted|concise|fast|shallow/.test(text);
    case 'policy':
      return /gene|policy|reward|yesness|bandit|strategy/.test(text);
    default:
      return false;
  }
}

function firstMemory(
  events: EvolutionState['timeline'],
  type: MemoryRecall['type'],
  title: string,
  confidence: number
): MemoryRecall | undefined {
  const event = events[0];
  return event ? timelineMemory(event, type, title, confidence) : undefined;
}

function timelineMemory(
  event: EvolutionState['timeline'][number],
  type: MemoryRecall['type'],
  title: string,
  confidence: number
): MemoryRecall {
  return {
    id: `mem_${event.id}`,
    type,
    title,
    body: cleanMemoryText(event.summary),
    source: event.type,
    confidence: clampScore((event.score + confidence) / 2)
  };
}

function uniqueSignals(signals: string[]): string[] {
  return [...new Set(signals.map((signal) => signal.trim()).filter(Boolean))].slice(0, 16);
}

function memorySearchText(event?: EvolutionState['timeline'][number]): string {
  if (!event) return '';
  return `${event.type} ${event.summary} ${(event.signals ?? []).join(' ')}`;
}

function cleanMemoryText(text: string): string {
  return text.replace(/^Roadshow\s+/i, '').replace(/\broadshow\b/gi, 'demo').trim();
}

async function readGepAssetCounts(): Promise<{ genes: number; capsules: number; events: number; latestAsset?: string }> {
  const assetsDir = process.env.GEP_ASSETS_DIR ? resolveFromProjectRoot(process.env.GEP_ASSETS_DIR) : resolveFromProjectRoot('assets');
  const [genes, capsules, events] = await Promise.all([
    readJsonCollectionCount(resolve(assetsDir, 'genes.json'), 'genes'),
    readJsonCollectionCount(resolve(assetsDir, 'capsules.json'), 'capsules'),
    readJsonlAssetCount(resolve(assetsDir, 'events.jsonl'))
  ]);
  return {
    genes,
    capsules,
    events: events.count,
    latestAsset: events.latestAsset
  };
}

async function readJsonCollectionCount(path: string, key: string): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
    if (isRecord(parsed) && Array.isArray(parsed[key])) return parsed[key].length;
  } catch {
    return 0;
  }
  return 0;
}

async function readJsonlAssetCount(path: string): Promise<{ count: number; latestAsset?: string }> {
  try {
    const lines = (await readFile(path, 'utf8')).split('\n').map((line) => line.trim()).filter(Boolean);
    const latestRaw = lines.at(-1);
    let latestAsset: string | undefined;
    if (latestRaw) {
      const parsed = JSON.parse(latestRaw) as unknown;
      if (isRecord(parsed)) {
        const type = typeof parsed.type === 'string' ? parsed.type : 'GEPAsset';
        const id = typeof parsed.id === 'string' ? parsed.id : (typeof parsed.asset_id === 'string' ? parsed.asset_id : 'latest');
        latestAsset = `${type}:${id}`;
      }
    }
    return { count: lines.length, latestAsset };
  } catch {
    return { count: 0 };
  }
}

function defaultTrainingObjective(type: RemoteJobType): string {
  switch (type) {
    case 'preference_train':
      return 'Train reward/preference model from recent EvoMate outcomes and canonical Yes Engineer samples.';
    case 'embedding_build':
      return 'Build memory retrieval index from EvoMate timeline, feedback, and GEP-compatible evolution assets.';
    case 'policy_replay_eval':
      return 'Replay recent policy decisions and score behavior gene choices against recorded outcomes.';
    case 'evolution_gym_eval':
    default:
      return 'Run EvoMate evolution gym evaluation over behavior genes, policy, reward, and memory signals.';
  }
}

function buildAdvisorTrace(input: string, context: AdvisorContext, advisor: Awaited<ReturnType<typeof prepareAdvisor>>): Array<EvolutionState['timeline'][number]> {
  const source = normalizeHookText(context.source, 'manual');
  const event = normalizeHookText(context.event, 'advisor_prepare');
  const signals = uniqueSignals([
    ...advisor.signal.signals,
    advisor.memoryRoute?.activeExpert ? `memory_${advisor.memoryRoute.activeExpert}` : '',
    'memory_moe_routed'
  ]);
  const semantic = advisor.signal.semantic;
  const llmLabel = advisor.signalExtraction.llm.used ? 'EvoMap LLM' : 'seed parser';
  const memoryTag = advisor.memoryRoute ? ` via memory:${advisor.memoryRoute.activeExpert}` : '';
  return [
    runtimeTimelineEvent({
      type: 'advisor_injected',
      summary: `${source}:${event} injected ${advisor.gene.id} advisor prompt${memoryTag}`,
      score: advisor.predictedSatisfaction,
      geneId: advisor.gene.id,
      signals
    }),
    runtimeTimelineEvent({
      type: 'tournament_completed',
      summary: `Gene tournament selected ${advisor.gene.id}; yesness=${Math.round(advisor.predictedSatisfaction * 100)}%`,
      score: advisor.predictedSatisfaction,
      geneId: advisor.gene.id,
      signals
    }),
    runtimeTimelineEvent({
      type: 'semantic_parsed',
      summary: `${llmLabel} parsed task=${semantic.taskType}, intent=${semantic.intent}, risk=${semantic.riskLevel}, permission=${semantic.permissionMode}`,
      score: semantic.confidence,
      geneId: advisor.gene.id,
      signals
    }),
    runtimeTimelineEvent({
      type: 'hook_received',
      summary: `${source}:${event} · "${compactTimelineExcerpt(input)}" · ${input.trim().length} chars`,
      score: 0.5,
      signals
    })
  ];
}

function compactTimelineExcerpt(input: string): string {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'empty turn';
  const limit = 72;
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

async function prepareAdvisor(input: string, state: EvolutionState, context: AdvisorContext) {
  const seedSignal = extractSignals(input);
  const signalExtraction = shouldUseFastAdvisor(context)
    ? {
      seed: seedSignal,
      llm: {
        source: 'evomap_llm' as const,
        used: false,
        enabled: false,
        signals: [],
        error: 'fast_advisor_mode'
      },
      merged: seedSignal
    }
    : await extractSignalsWithEvoMapLlm(input, seedSignal);
  const signal = signalExtraction.merged;
  const memoryRoute = await buildMemoryRoute(state as RuntimeEvolutionState, {
    input,
    source: normalizeHookText(context.source, 'advisor'),
    signals: signal.signals
  });
  const baseDecision = selectBehaviorGeneDecision(state, signal);
  const { decision: policyDecision, insight: trainedModelInsight } = await enhanceDecisionWithTrainedModels({
    rawInput: input,
    state,
    signal,
    decision: baseDecision
  });
  const gene = policyDecision.selectedGene;
  const predictedSatisfaction = policyDecision.predictedYesness;
  const advisorPrompt = buildAdvisorPrompt({
    context,
    signal,
    gene,
    predictedSatisfaction,
    trainedModelInsight,
    memoryRoute
  });

  return { signalExtraction, signal, policyDecision, trainedModelInsight, gene, predictedSatisfaction, memoryRoute, advisorPrompt };
}

function shouldUseFastAdvisor(context: AdvisorContext): boolean {
  const metadata = context.metadata;
  return Boolean(
    metadata
    && (
      metadata.evomateFastSmoke === true
      || metadata.fastAdvisor === true
      || metadata.skipLlm === true
    )
  );
}

function buildAdvisorPrompt(input: {
  context: AdvisorContext;
  signal: UserInputSignal;
  gene: EvolutionState['activeGenes'][number];
  predictedSatisfaction: number;
  trainedModelInsight?: Awaited<ReturnType<typeof enhanceDecisionWithTrainedModels>>['insight'];
  memoryRoute?: MemoryRouteResponse;
}): string {
  const { context, signal, gene, predictedSatisfaction, trainedModelInsight, memoryRoute } = input;
  const semantic = signal.semantic;
  const yes = dynamicYesContract(gene.id, predictedSatisfaction, semantic.confidence);
  const geneOverlay = geneBehaviorOverlay(gene.id);
  const yesPercent = Math.round(predictedSatisfaction * 100);
  const confidencePercent = Math.round(semantic.confidence * 100);
  const signals = signal.signals.slice(0, 5).join(',') || 'none';
  const modelBadge = trainedModelInsight?.loaded ? 'ML:reward+policy+memory' : 'ML:seed';
  const memoryLine = advisorMemoryLine(memoryRoute);
  const gepLine = advisorGepLine(memoryRoute);

  return [
    '╭─ EvoMate Dynamic Yes · apply silently to this turn',
    `│ YES ${yesBar(predictedSatisfaction)} ${yesPercent}% ${yes.band} · ${yes.shortAutonomy}`,
    `│ MODE ${geneIcon(gene.id)} ${compactText(gene.label, 30)} · ${geneOverlay.shortShape}`,
    memoryLine,
    gepLine,
    `│ FLOW ${runtimeFlowGlyph()} · hook→semantic→tournament→advisor→GEP`,
    `│ ACT  ${geneOverlay.actionRule}`,
    `│ ASK  ${yes.shortClarification}`,
    `│ TRACE ${normalizeHookText(context.source, 'manual')}/${normalizeHookText(context.event, 'advisor_prepare')} · ${semantic.taskType}/${semantic.intent} · risk:${semantic.riskLevel} · conf:${confidencePercent}% · ${modelBadge}`,
    `╰─ signals:${signals}`
  ].join('\n');
}

function advisorMemoryLine(memoryRoute?: MemoryRouteResponse): string {
  if (!memoryRoute) return '│ MEM  no-route · use current turn only';
  const topMemory = memoryRoute.recalledMemories[0];
  const active = memoryRoute.experts.find((expert) => expert.id === memoryRoute.activeExpert);
  const expert = `${memoryRoute.activeExpert}:${Math.round(memoryRoute.confidence * 100)}%`;
  const evidence = compactText(topMemory?.body || active?.evidence || 'no memory recalled', 92);
  return `│ MEM  ${expert} · ${evidence}`;
}

function advisorGepLine(memoryRoute?: MemoryRouteResponse): string {
  if (!memoryRoute) return '│ GEP  pending · no asset proof yet';
  const proof = memoryRoute.gepProof;
  const latest = proof.latestAsset ? ` · latest:${compactText(proof.latestAsset, 44)}` : '';
  return `│ GEP  genes:${proof.genes} capsules:${proof.capsules} events:${proof.events}${latest}`;
}

function compactMemoryRoute(memoryRoute: MemoryRouteResponse): Record<string, unknown> {
  return {
    schemaVersion: memoryRoute.schemaVersion,
    mode: memoryRoute.mode,
    activeExpert: memoryRoute.activeExpert,
    confidence: memoryRoute.confidence,
    experts: memoryRoute.experts.slice(0, 4).map((expert) => ({
      id: expert.id,
      label: expert.label,
      score: expert.score,
      status: expert.status,
      evidence: compactText(expert.evidence, 160)
    })),
    recalledMemories: memoryRoute.recalledMemories.slice(0, 4).map((memory) => ({
      type: memory.type,
      title: memory.title,
      body: compactText(memory.body, 180),
      source: memory.source,
      confidence: memory.confidence
    })),
    routePlan: memoryRoute.routePlan,
    gepProof: memoryRoute.gepProof,
    latestEventId: memoryRoute.latestEventId
  };
}

function yesBar(value: number): string {
  const cells = 10;
  const filled = Math.max(0, Math.min(cells, Math.round(clampScore(value) * cells)));
  return `${'█'.repeat(filled)}${'░'.repeat(cells - filled)}`;
}

function runtimeFlowGlyph(): string {
  return '[■ hook][■ sem][■ vote][■ inject][□ gep][□ train]';
}

function geneIcon(geneId: string): string {
  switch (geneId) {
    case 'gene_ask_before_execution': return '🛡';
    case 'gene_concise_direct_answer': return '⚡';
    case 'gene_mcp_first_architecture': return '🧩';
    case 'gene_deep_research_first': return '🔎';
    case 'gene_visualize_first': return '◩';
    case 'gene_yes_engineer_policy': return '🧬';
    default: return '●';
  }
}

function compactText(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function dynamicYesContract(predictedGeneId: string, predictedSatisfaction: number, semanticConfidence: number) {
  const yes = clampScore(predictedSatisfaction);
  const confidence = clampScore(semanticConfidence);
  const band = yes >= 0.78 ? 'High Yes' : yes >= 0.58 ? 'Guided Yes' : yes >= 0.42 ? 'Cautious Yes' : 'Low Yes / Repair';
  const autonomy = yes >= 0.78
    ? 'proceed directly on safe/reversible work; narrate compactly'
    : yes >= 0.58
      ? 'advance with a short plan; ask only for meaningful ambiguity'
      : yes >= 0.42
        ? 'reduce assumptions; confirm before edits or irreversible actions'
        : 'repair trust first; ask a focused question or restate intent';
  const clarification = confidence < 0.5 || yes < 0.45
    ? 'high — ask one focused question if intent/tool/risk is unclear'
    : predictedGeneId === 'gene_ask_before_execution'
      ? 'medium-high — inspect/explain before editing or high-impact commands'
      : 'low — continue unless blocked by risk or missing credentials';
  const executionRule = yes >= 0.58
    ? 'take the next concrete step when safe; otherwise state the exact blocker'
    : 'avoid premature execution; first align on intent and expected output';
  const confidenceRule = confidence >= 0.7
    ? 'trust the selected behavior mode and act decisively'
    : confidence >= 0.5
      ? 'follow the selected mode but keep assumptions explicit'
      : 'treat the semantic parse as weak; infer from the user message and verify if needed';

  const shortAutonomy = yes >= 0.78
    ? 'act directly when safe'
    : yes >= 0.58
      ? 'short plan → act'
      : yes >= 0.42
        ? 'confirm before risky edits'
        : 'repair trust first';
  const shortClarification = confidence < 0.5 || yes < 0.45
    ? 'ask 1 focused question if unclear'
    : predictedGeneId === 'gene_ask_before_execution'
      ? 'verify before edits/high-impact commands'
      : 'do not ask unless blocked';

  return { band, autonomy, clarification, executionRule, confidenceRule, shortAutonomy, shortClarification };
}

function geneBehaviorOverlay(geneId: string): { shortShape: string; actionRule: string } {
  switch (geneId) {
    case 'gene_ask_before_execution':
      return {
        shortShape: 'analysis-first',
        actionRule: 'inspect/read-only first; verify before writes'
      };
    case 'gene_concise_direct_answer':
      return {
        shortShape: 'fast-direct',
        actionRule: 'give next concrete action; minimize theory'
      };
    case 'gene_mcp_first_architecture':
      return {
        shortShape: 'architecture-first',
        actionRule: 'map MCP/EvoMap layers before code details'
      };
    case 'gene_deep_research_first':
      return {
        shortShape: 'research-first',
        actionRule: 'verify sources; separate fact/inference'
      };
    case 'gene_visualize_first':
      return {
        shortShape: 'visual-first',
        actionRule: 'diagram/state view before dense prose'
      };
    case 'gene_yes_engineer_policy':
      return {
        shortShape: 'evolution-first',
        actionRule: 'route via policy/reward/memory/GEP updates'
      };
    default:
      return {
        shortShape: 'direct-with-assumptions',
        actionRule: 'use safest available tool path'
      };
  }
}

function normalizeAgentEvent(input: AgentEventInput): AgentEventInput {
  return {
    ...input,
    source: normalizeHookText(input.source, 'manual'),
    event: normalizeHookText(input.event, 'user_message'),
    workspace: input.workspace || input.cwd,
    sessionId: input.sessionId ? normalizeHookText(input.sessionId, 'local_session', 120) : undefined,
    content: input.content?.slice(0, 12000),
    metadata: input.metadata
  };
}

function extractAgentEventContent(event: AgentEventInput): string {
  const metadata = event.metadata ?? {};
  const candidates: unknown[] = [
    event.content,
    metadata.input,
    metadata.prompt,
    metadata.message,
    metadata.user_input,
    metadata.userInput,
    metadata.text,
    metadata.command
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.slice(0, 12000);
  }
  return '';
}

function inferFeedbackKind(input: OutcomeInput): FeedbackInput['kind'] {
  if (input.kind) return input.kind;
  if (typeof input.score === 'number') return 'manual_score';
  switch (input.outcome) {
    case 'accepted':
    case 'success':
      return 'accepted';
    case 'corrected':
    case 'failure':
      return 'corrected';
    case 'interrupted':
      return 'interrupted';
    case 'rejected':
      return 'rejected';
    case 'undo':
      return 'undo';
    default:
      break;
  }

  const event = `${input.event ?? ''}`.toLowerCase();
  if (/interrupt|cancel|stop|abort/.test(event)) return 'interrupted';
  if (/reject|deny/.test(event)) return 'rejected';
  if (/undo|revert|rollback/.test(event)) return 'undo';
  if (/error|fail|exception/.test(event)) return 'corrected';
  return 'accepted';
}

function normalizeHookText(value: unknown, fallback: string, maxLength = 80): string {
  const normalized = typeof value === 'string' ? value.trim().replace(/[^\w:./@-]+/g, '_') : '';
  return (normalized || fallback).slice(0, maxLength);
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`EvoMate API listening on http://localhost:${info.port}`);
});
