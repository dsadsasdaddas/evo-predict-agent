import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { extractSignalsWithEvoMapLlm, getEvoMapLlmConfig } from './evomap-llm.js';
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
  applyFeedback,
  createInitialEvolutionState,
  EVOMATE_TECH_STACK,
  extractSignals,
  normalizeEvolutionState,
  previewFeedbackReward,
  selectBehaviorGeneDecision,
  type EvolutionState,
  type FeedbackInput,
  type RemoteJobType,
  type UserInputSignal
} from '@evomate/core';

loadLocalEnv();

const PORT = Number(process.env.EVOMATE_API_PORT || 8787);
const STATE_DIR = process.env.EVOMATE_STATE_DIR
  ? resolveFromProjectRoot(process.env.EVOMATE_STATE_DIR)
  : resolveFromProjectRoot('memory/evomate');
const STATE_FILE = resolve(STATE_DIR, 'evolution-state.json');

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

app.get('/health', (c) => c.json({
  ok: true,
  service: 'evomate-api',
  port: PORT,
  evomapLlm: Boolean(getEvoMapLlmConfig()) && process.env.EVOMAP_LLM_DISABLED !== '1'
}));

app.get('/api/tech-stack', (c) => c.json(EVOMATE_TECH_STACK));

app.get('/api/evolution/state', async (c) => {
  const state = await loadState();
  return c.json(state);
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
    predictedSatisfaction: advisor.predictedSatisfaction
  });
});

app.post('/api/agent-events/observe', async (c) => {
  const parsed = agentEventSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_agent_event', details: parsed.error.flatten() }, 400);

  const event = normalizeAgentEvent(parsed.data);
  const input = extractAgentEventContent(event);
  if (!input.trim()) {
    return c.json({
      ok: true,
      observed: false,
      reason: 'empty_content',
      mode: 'non_blocking_sidecar'
    }, 202);
  }

  const state = await loadState();
  const advisor = await prepareAdvisor(input, state, event);
  const nextState = prependTimeline(state, buildAdvisorTrace(input, event, advisor), 'strategy_decision');
  await saveState(nextState);

  return c.json({
    ok: true,
    observed: true,
    mode: 'non_blocking_sidecar',
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
    state: nextState
  });
});

app.post('/api/agent-events/outcome', async (c) => {
  const parsed = outcomeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_agent_outcome', details: parsed.error.flatten() }, 400);

  const event = normalizeAgentEvent(parsed.data);
  const content = extractAgentEventContent(event);
  const inferred = content.trim() ? extractSignals(content) : undefined;
  const feedback: FeedbackInput = {
    kind: inferFeedbackKind(parsed.data),
    text: content || `${event.source}:${event.event}`,
    score: parsed.data.score,
    geneId: parsed.data.geneId,
    signals: parsed.data.signals?.length ? parsed.data.signals : inferred?.signals
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

  return c.json({
    ok: true,
    mode: 'non_blocking_sidecar',
    source: event.source,
    event: event.event,
    workspace: event.workspace,
    sessionId: event.sessionId,
    feedback,
    reward: rewardPreview,
    gepAssets,
    state: nextState
  });
});

app.get('/api/events', async (c) => {
  const state = await loadState();
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  return c.body(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
});

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

async function saveState(state: EvolutionState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

type AgentEventInput = z.infer<typeof agentEventSchema>;
type OutcomeInput = z.infer<typeof outcomeSchema>;

interface AdvisorContext {
  source?: string;
  event?: string;
  workspace?: string;
  sessionId?: string;
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

function buildAdvisorTrace(input: string, context: AdvisorContext, advisor: Awaited<ReturnType<typeof prepareAdvisor>>): Array<EvolutionState['timeline'][number]> {
  const source = normalizeHookText(context.source, 'manual');
  const event = normalizeHookText(context.event, 'advisor_prepare');
  const signals = advisor.signal.signals;
  const semantic = advisor.signal.semantic;
  const llmLabel = advisor.signalExtraction.llm.used ? 'EvoMap LLM' : 'seed parser';
  return [
    runtimeTimelineEvent({
      type: 'advisor_injected',
      summary: `${source}:${event} injected ${advisor.gene.id} advisor prompt`,
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
      summary: `${source}:${event} captured ${input.trim().length} chars from agent/user turn`,
      score: 0.5,
      signals
    })
  ];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

async function prepareAdvisor(input: string, state: EvolutionState, context: AdvisorContext) {
  const seedSignal = extractSignals(input);
  const signalExtraction = await extractSignalsWithEvoMapLlm(input, seedSignal);
  const signal = signalExtraction.merged;
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
    trainedModelInsight
  });

  return { signalExtraction, signal, policyDecision, trainedModelInsight, gene, predictedSatisfaction, advisorPrompt };
}

function buildAdvisorPrompt(input: {
  context: AdvisorContext;
  signal: UserInputSignal;
  gene: EvolutionState['activeGenes'][number];
  predictedSatisfaction: number;
  trainedModelInsight?: Awaited<ReturnType<typeof enhanceDecisionWithTrainedModels>>['insight'];
}): string {
  const { context, signal, gene, predictedSatisfaction, trainedModelInsight } = input;
  const semantic = signal.semantic;
  const yes = dynamicYesContract(gene.id, predictedSatisfaction, semantic.confidence);
  const geneOverlay = geneBehaviorOverlay(gene.id);
  const yesPercent = Math.round(predictedSatisfaction * 100);
  const confidencePercent = Math.round(semantic.confidence * 100);
  const signals = signal.signals.slice(0, 5).join(',') || 'none';
  const modelBadge = trainedModelInsight?.loaded ? 'ML:reward+policy+memory' : 'ML:seed';

  return [
    '╭─ EvoMate Dynamic Yes · apply silently to this turn',
    `│ YES ${yesBar(predictedSatisfaction)} ${yesPercent}% ${yes.band} · ${yes.shortAutonomy}`,
    `│ MODE ${geneIcon(gene.id)} ${compactText(gene.label, 30)} · ${geneOverlay.shortShape}`,
    `│ FLOW ${runtimeFlowGlyph()} · hook→semantic→tournament→advisor→GEP`,
    `│ ACT  ${geneOverlay.actionRule}`,
    `│ ASK  ${yes.shortClarification}`,
    `│ TRACE ${normalizeHookText(context.source, 'manual')}/${normalizeHookText(context.event, 'advisor_prepare')} · ${semantic.taskType}/${semantic.intent} · risk:${semantic.riskLevel} · conf:${confidencePercent}% · ${modelBadge}`,
    `╰─ signals:${signals}`
  ].join('\n');
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
    content: input.content?.slice(0, 12000)
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
