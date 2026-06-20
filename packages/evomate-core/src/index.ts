import {
  calculateFeedbackReward,
  createInitialPolicyState,
  ensurePolicyState,
  selectBehaviorGeneWithPolicy,
  updatePolicyWithFeedback
} from './ml.js';
import type { BanditPolicyState, PolicyDecision } from './ml.js';
import { parseSemantics } from './semantic.js';
import type { SemanticParseResult } from './semantic.js';

export type AssistantPhase =
  | 'idle'
  | 'user_input_received'
  | 'evomap_recall'
  | 'gene_selection'
  | 'strategy_decision'
  | 'execute_or_answer'
  | 'observe_feedback'
  | 'reflect'
  | 'record_outcome'
  | 'update_behavior_genome'
  | 'solidify_capsule';

export type FeedbackKind = 'accepted' | 'corrected' | 'interrupted' | 'rejected' | 'undo' | 'manual_score';

export interface BehaviorGene {
  id: string;
  label: string;
  summary: string;
  category: 'repair' | 'optimize' | 'innovate' | 'explore';
  signals: string[];
  strategy: string[];
  weight: number;
  fitness: number;
  validation: string[];
}

export interface EvolutionTimelineItem {
  id: string;
  type: string;
  summary: string;
  score: number;
  createdAt: string;
  geneId?: string;
  signals?: string[];
}

export interface EvolutionMetrics {
  yesnessScore: number;
  averageReward: number;
  interactionCount: number;
  acceptedCount: number;
  correctionCount: number;
  interruptionCount: number;
  rejectionCount: number;
  undoCount: number;
  acceptanceRate: number;
  correctionRate: number;
  interruptionRate: number;
}

export interface EvolutionState {
  assistantId: string;
  generation: number;
  phase: AssistantPhase;
  understandingScore: number;
  activeGenes: BehaviorGene[];
  timeline: EvolutionTimelineItem[];
  policy: BanditPolicyState;
  metrics: EvolutionMetrics;
}

export interface UserInputSignal {
  rawInput: string;
  taskType: 'coding' | 'product' | 'research' | 'general';
  riskLevel: 'low' | 'medium' | 'high';
  signals: string[];
  semantic: SemanticParseResult;
}

export interface FeedbackInput {
  kind: FeedbackKind;
  text?: string;
  score?: number;
  geneId?: string;
  signals?: string[];
}

export const DEFAULT_BEHAVIOR_GENES: BehaviorGene[] = [
  {
    id: 'gene_ask_before_execution',
    label: 'Safe Yes：先分析后执行',
    summary: 'When execution authority is ambiguous, analyze and ask before editing files or running high-impact actions.',
    category: 'repair',
    signals: ['ambiguous_execution_permission', 'coding_task', 'user_interruption', 'high_risk_action', 'permission_sensitive'],
    strategy: [
      'Restate the task in one sentence.',
      'Classify whether the user asked for analysis, planning, or execution.',
      'For file edits, installs, pushes, or destructive actions, ask or verify intent first.',
      'After explicit confirmation, execute with concise status updates.'
    ],
    weight: 0.72,
    fitness: 0.86,
    validation: ['node scripts/validate-behavior-gene.mjs']
  },
  {
    id: 'gene_concise_direct_answer',
    label: 'Fast Yes：简洁直接',
    summary: 'Prefer concise, practical, action-oriented answers for fast-moving product/engineering strategy discussions.',
    category: 'optimize',
    signals: ['impatient_user', 'strategy_discussion', 'roadshow_planning', 'rapid_iteration'],
    strategy: [
      'Lead with conclusion.',
      'Use compact bullets.',
      'Avoid generic motivational language.',
      'End with the next concrete action.'
    ],
    weight: 0.64,
    fitness: 0.78,
    validation: ['node scripts/validate-behavior-gene.mjs']
  },
  {
    id: 'gene_mcp_first_architecture',
    label: 'Architect Yes：MCP 优先架构',
    summary: 'Treat MCP tools and GEP evolution state as the product backbone; models are replaceable reasoning workers.',
    category: 'innovate',
    signals: ['mcp_native', 'model_agnostic', 'evomap_integration', 'agent_platform', 'architecture_request'],
    strategy: [
      'Represent core capabilities as MCP tools.',
      'Keep model routing behind the orchestrator.',
      'Write user feedback and outcomes into GEP-compatible evolution memory.',
      'Expose traceable state to the frontend.'
    ],
    weight: 0.81,
    fitness: 0.88,
    validation: ['node scripts/validate-behavior-gene.mjs']
  },
  {
    id: 'gene_deep_research_first',
    label: 'Research Yes：先调查再结论',
    summary: 'When the user asks about external products, current capabilities, or ecosystem fit, verify evidence before deciding.',
    category: 'explore',
    signals: ['research_task', 'external_source_required', 'evomap_integration'],
    strategy: [
      'Check source material before forming a conclusion.',
      'Separate facts from inference.',
      'Return a crisp recommendation after evidence.',
      'Record reusable findings as Capsules when they affect future behavior.'
    ],
    weight: 0.58,
    fitness: 0.72,
    validation: ['node scripts/validate-behavior-gene.mjs']
  },
  {
    id: 'gene_visualize_first',
    label: 'Visual Yes：先可视化',
    summary: 'For architecture, roadshow, and product direction questions, make the evolution loop visible through diagrams and dashboards.',
    category: 'innovate',
    signals: ['visualization_request', 'architecture_request', 'roadshow_planning', 'strategy_discussion'],
    strategy: [
      'Convert abstract evolution into a diagram or dashboard object.',
      'Show signals, selected gene, reward, mutation, and capsule lineage.',
      'Prefer demo-friendly visual explanations over hidden backend jargon.'
    ],
    weight: 0.61,
    fitness: 0.76,
    validation: ['node scripts/validate-behavior-gene.mjs']
  },
  {
    id: 'gene_yes_engineer_policy',
    label: 'Policy Yes：学习用户协作方式',
    summary: 'Use lightweight policy learning to decide the best collaboration mode for this user and write updates into GEP assets.',
    category: 'innovate',
    signals: ['ml_policy', 'yes_engineer', 'evomap_integration', 'rapid_iteration'],
    strategy: [
      'Extract context features from the user request.',
      'Score candidate behavior genes using the personalized bandit policy.',
      'Convert feedback into reward.',
      'Record policy changes as Mutation/EvolutionEvent/ValidationReport data.'
    ],
    weight: 0.69,
    fitness: 0.8,
    validation: ['node scripts/validate-behavior-gene.mjs']
  }
];

export function createInitialEvolutionState(): EvolutionState {
  const activeGenes = DEFAULT_BEHAVIOR_GENES;
  return {
    assistantId: 'evomate-local',
    generation: 1,
    phase: 'idle',
    understandingScore: 0.42,
    activeGenes,
    policy: createInitialPolicyState(activeGenes),
    metrics: createInitialMetrics(),
    timeline: [
      {
        id: 'evt_seed_direction',
        type: 'direction_locked',
        summary: 'EvoMate direction locked: MCP-native self-evolving Yes Engineer powered by EvoMap GEP.',
        score: 0.9,
        createdAt: new Date().toISOString(),
        geneId: 'gene_mcp_first_architecture',
        signals: ['mcp_native', 'evomap_integration', 'yes_engineer']
      }
    ]
  };
}

export function normalizeEvolutionState(partial?: Partial<EvolutionState>): EvolutionState {
  const base = createInitialEvolutionState();
  if (!partial) return base;

  const activeGenes = mergeGenes(base.activeGenes, partial.activeGenes ?? []);
  const metrics = normalizeMetrics({ ...base.metrics, ...(partial.metrics ?? {}) });
  const next: EvolutionState = {
    ...base,
    ...partial,
    activeGenes,
    metrics,
    timeline: partial.timeline ?? base.timeline,
    phase: partial.phase ?? base.phase,
    policy: ensurePolicyState(partial.policy, activeGenes)
  };

  return next;
}

export function extractSignals(rawInput: string): UserInputSignal {
  const semantic = parseSemantics(rawInput);
  return {
    rawInput,
    taskType: semantic.taskType,
    riskLevel: semantic.riskLevel,
    signals: semantic.signals,
    semantic
  };
}

export function selectBehaviorGeneDecision(state: EvolutionState, signal: UserInputSignal): PolicyDecision {
  return selectBehaviorGeneWithPolicy(normalizeEvolutionState(state), signal);
}

export function selectBehaviorGene(state: EvolutionState, signal: UserInputSignal): BehaviorGene {
  return selectBehaviorGeneDecision(state, signal).selectedGene;
}

export function predictSatisfaction(state: EvolutionState, signal: UserInputSignal, gene: BehaviorGene): number {
  const decision = selectBehaviorGeneDecision(state, signal);
  const score = decision.scores.find((item) => item.geneId === gene.id)?.predictedYesness;
  if (typeof score === 'number') return score;

  const signalOverlap = gene.signals.filter((s) => signal.signals.includes(s)).length;
  const riskPenalty = signal.riskLevel === 'high' && !gene.signals.includes('high_risk_action') ? 0.18 : 0;
  const base = 0.42 + gene.fitness * 0.35 + gene.weight * 0.15 + Math.min(signalOverlap, 3) * 0.08;
  return clamp(base - riskPenalty, 0.05, 0.98);
}

export function applyFeedback(state: EvolutionState, feedback: FeedbackInput): EvolutionState {
  const normalized = normalizeEvolutionState(state);
  const policyUpdate = updatePolicyWithFeedback(normalized.policy, normalized.activeGenes, feedback);
  const delta = policyUpdate.reward.reward;
  const updatedGeneIds = new Set(policyUpdate.updatedGeneIds);

  const genes = normalized.activeGenes.map((gene) => {
    if (!updatedGeneIds.has(gene.id)) return gene;
    return {
      ...gene,
      fitness: clamp(gene.fitness + delta * 0.08, 0, 1),
      weight: clamp(gene.weight + delta * 0.06, 0, 1)
    };
  });

  const topMutation = policyUpdate.mutations[0];
  const item: EvolutionTimelineItem = {
    id: `evt_${Date.now()}`,
    type: `policy_reward_${feedback.kind}`,
    summary: feedback.text || `Reward ${policyUpdate.reward.reward.toFixed(2)} updated ${policyUpdate.updatedGeneIds.join(', ') || 'policy'}`,
    score: policyUpdate.reward.yesness,
    createdAt: new Date().toISOString(),
    geneId: feedback.geneId ?? topMutation?.geneId,
    signals: feedback.signals
  };

  return {
    ...normalized,
    generation: delta !== 0 ? normalized.generation + 1 : normalized.generation,
    phase: 'update_behavior_genome',
    understandingScore: clamp(normalized.understandingScore + delta * 0.07, 0, 1),
    activeGenes: genes,
    policy: ensurePolicyState(policyUpdate.policy, genes),
    metrics: updateMetrics(normalized.metrics, feedback, policyUpdate.reward.reward),
    timeline: [item, ...normalized.timeline].slice(0, 100)
  };
}

export function previewFeedbackReward(feedback: FeedbackInput) {
  return calculateFeedbackReward(feedback);
}

export function toGepSignals(signal: UserInputSignal | FeedbackInput): string[] {
  const source = 'rawInput' in signal ? signal.signals : signal.signals ?? [];
  return [...new Set(['evomate_behavior_evolution', ...source])];
}

export const EVOMATE_TECH_STACK = {
  frontend: ['Next.js', 'React', 'Tailwind', 'Framer Motion'],
  backend: ['Node.js', 'TypeScript', 'Hono-style API', 'state machine orchestrator'],
  ml: ['Contextual Bandit', 'Reward Learning', 'Yesness Score', 'Behavior Gene Policy'],
  mcp: ['@evomap/gep-mcp-server', 'evomate-mcp-server', 'codex-wrapper-mcp'],
  gep: ['@evomap/gep-sdk', 'Gene', 'Capsule', 'EvolutionEvent', 'Mutation', 'ValidationReport'],
  execution: ['Codex CLI', 'Codex App Server', 'model-agnostic workers'],
  storage: ['local JSON/JSONL', 'future Postgres/SQLite', '.gepx portability']
} as const;


export {
  buildRemoteCommandPlan,
  buildRemoteJobDataset,
  createRemoteEvolutionJob,
  defaultRemoteComputeTarget,
  summarizeRemoteArtifacts
} from './jobs.js';
export type {
  RemoteArtifactSummary,
  RemoteCommandPlan,
  RemoteComputeTarget,
  RemoteEvolutionJob,
  RemoteEvolutionJobInput,
  RemoteJobDataset,
  RemoteJobStatus,
  RemoteJobType,
  RemotePipelineStep,
  RemoteWorkerArtifact
} from './jobs.js';

export { parseSemantics } from './semantic.js';
export type {
  FeedbackSemantics,
  PermissionMode,
  SemanticIntent,
  SemanticParseResult,
  SemanticRiskLevel,
  SemanticTaskType,
  UserTone
} from './semantic.js';
export { normalizeExternalSemantic } from './semantic-schema.js';
export type { SemanticNormalizationResult } from './semantic-schema.js';

export {
  calculateFeedbackReward,
  createInitialPolicyState,
  ensurePolicyState,
  extractFeatures,
  FEATURE_NAMES,
  selectBehaviorGeneWithPolicy,
  updatePolicyWithFeedback
} from './ml.js';

export type {
  BanditPolicyState,
  FeatureVector,
  GenePolicyParameters,
  PolicyDecision,
  PolicyMutation,
  PolicyScore,
  PolicyUpdateResult,
  RewardBreakdown,
  RewardComponent
} from './ml.js';

function createInitialMetrics(): EvolutionMetrics {
  return {
    yesnessScore: 0.42,
    averageReward: 0,
    interactionCount: 0,
    acceptedCount: 0,
    correctionCount: 0,
    interruptionCount: 0,
    rejectionCount: 0,
    undoCount: 0,
    acceptanceRate: 0,
    correctionRate: 0,
    interruptionRate: 0
  };
}

function updateMetrics(metrics: EvolutionMetrics, feedback: FeedbackInput, reward: number): EvolutionMetrics {
  const interactionCount = metrics.interactionCount + 1;
  const acceptedCount = metrics.acceptedCount + (feedback.kind === 'accepted' || reward > 0.55 ? 1 : 0);
  const correctionCount = metrics.correctionCount + (feedback.kind === 'corrected' ? 1 : 0);
  const interruptionCount = metrics.interruptionCount + (feedback.kind === 'interrupted' ? 1 : 0);
  const rejectionCount = metrics.rejectionCount + (feedback.kind === 'rejected' ? 1 : 0);
  const undoCount = metrics.undoCount + (feedback.kind === 'undo' ? 1 : 0);
  const averageReward = clamp((metrics.averageReward * metrics.interactionCount + reward) / interactionCount, -1, 1);

  return normalizeMetrics({
    ...metrics,
    yesnessScore: clamp((averageReward + 1) / 2, 0, 1),
    averageReward,
    interactionCount,
    acceptedCount,
    correctionCount,
    interruptionCount,
    rejectionCount,
    undoCount
  });
}

function normalizeMetrics(metrics: EvolutionMetrics): EvolutionMetrics {
  const total = Math.max(1, metrics.interactionCount);
  return {
    ...metrics,
    acceptanceRate: clamp(metrics.acceptedCount / total, 0, 1),
    correctionRate: clamp(metrics.correctionCount / total, 0, 1),
    interruptionRate: clamp(metrics.interruptionCount / total, 0, 1),
    yesnessScore: clamp(metrics.yesnessScore, 0, 1),
    averageReward: clamp(metrics.averageReward, -1, 1)
  };
}

function mergeGenes(defaultGenes: BehaviorGene[], storedGenes: BehaviorGene[]): BehaviorGene[] {
  const storedById = new Map(storedGenes.map((gene) => [gene.id, gene]));
  const merged = defaultGenes.map((defaultGene) => ({
    ...defaultGene,
    ...(storedById.get(defaultGene.id) ?? {})
  }));
  for (const storedGene of storedGenes) {
    if (!defaultGenes.some((gene) => gene.id === storedGene.id)) merged.push(storedGene);
  }
  return merged;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value.toFixed(4))));
}
