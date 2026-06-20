import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BehaviorGene, EvolutionState, PolicyDecision, PolicyScore, UserInputSignal } from '@evomate/core';
import { resolveFromProjectRoot } from './paths.js';

interface RewardModel {
  model?: string;
  version?: number;
  feature_schema?: string;
  weights?: Record<string, number>;
  metrics?: Record<string, unknown>;
}

interface PolicyModel {
  model?: string;
  version?: number;
  feature_schema?: string;
  weights_by_gene?: Record<string, Record<string, number>>;
  metrics?: Record<string, unknown>;
}

interface EmbeddingIndex {
  model?: string;
  version?: number;
  dimensions?: number;
  vectors?: Array<{
    id?: string;
    geneId?: string;
    reward?: number;
    label?: number;
    signals?: string[];
    vector?: Array<[number, number]>;
  }>;
  metrics?: Record<string, unknown>;
}

interface RuntimeModels {
  rewardModel?: RewardModel;
  policyModel?: PolicyModel;
  embeddingIndex?: EmbeddingIndex;
}

export interface TrainedGeneScore {
  geneId: string;
  finalYesness: number;
  banditYesness: number;
  rewardModelYesness?: number;
  policyModelProb?: number;
  memorySimilarity?: number;
  tournamentWins?: number;
  tournamentLosses?: number;
  tournamentMargin?: number;
}

export interface TrainedModelInsight {
  loaded: boolean;
  selectedGeneId?: string;
  predictedYesness?: number;
  scores: TrainedGeneScore[];
  tournament?: GeneTournamentResult;
  installedModels: string[];
  explanation: string;
  metrics: Record<string, unknown>;
}

export interface GeneTournamentVoterDecision {
  voter: 'online_bandit' | 'reward_model' | 'policy_model' | 'memory_similarity';
  weight: number;
  leftScore: number;
  rightScore: number;
  preferredGeneId?: string;
}

export interface GeneTournamentRound {
  leftGeneId: string;
  rightGeneId: string;
  leftVotes: number;
  rightVotes: number;
  winnerGeneId?: string;
  margin: number;
  voters: GeneTournamentVoterDecision[];
}

export interface GeneTournamentStanding {
  geneId: string;
  wins: number;
  losses: number;
  ties: number;
  voteMargin: number;
  weightedBlendScore: number;
}

export interface GeneTournamentResult {
  method: 'weighted_condorcet_gene_tournament';
  winnerGeneId?: string;
  condorcetWinner: boolean;
  rounds: GeneTournamentRound[];
  standings: GeneTournamentStanding[];
}

export async function enhanceDecisionWithTrainedModels(input: {
  rawInput: string;
  state: EvolutionState;
  signal: UserInputSignal;
  decision: PolicyDecision;
}): Promise<{ decision: PolicyDecision; insight: TrainedModelInsight }> {
  const models = await loadRuntimeModels();
  const installedModels = [
    models.rewardModel ? 'reward_model' : '',
    models.policyModel ? 'policy_model' : '',
    models.embeddingIndex ? 'embedding_index' : ''
  ].filter(Boolean);

  if (!installedModels.length) {
    return {
      decision: input.decision,
      insight: {
        loaded: false,
        scores: [],
        installedModels,
        explanation: 'No trained model artifacts installed; using online contextual bandit only.',
        metrics: {}
      }
    };
  }

  const context = contextFeatures(input.rawInput, input.signal);
  const policyProbs = models.policyModel ? scorePolicyModel(models.policyModel, context, input.state.activeGenes) : {};
  const currentVector = models.embeddingIndex ? hashedEmbedding(input.rawInput, input.signal.signals, models.embeddingIndex.dimensions ?? 64) : [];
  const rawScores = input.state.activeGenes.map((gene) => {
    const base = input.decision.scores.find((item) => item.geneId === gene.id);
    const banditYesness = base?.predictedYesness ?? input.decision.predictedYesness;
    const rewardModelYesness = models.rewardModel ? scoreRewardModel(models.rewardModel, context, gene, input.signal) : undefined;
    const policyModelProb = policyProbs[gene.id];
    const memorySimilarity = models.embeddingIndex ? scoreMemory(models.embeddingIndex, currentVector, gene.id) : undefined;
    const finalYesness = clamp01(
      0.30 * banditYesness
      + 0.35 * (rewardModelYesness ?? banditYesness)
      + 0.20 * (policyModelProb ?? banditYesness)
      + 0.15 * (memorySimilarity ?? banditYesness)
    );
    return {
      geneId: gene.id,
      finalYesness,
      banditYesness,
      rewardModelYesness,
      policyModelProb,
      memorySimilarity
    };
  });
  const tournament = runGeneTournament(rawScores);
  const scores = rawScores
    .map((score) => {
      const standing = tournament.standings.find((item) => item.geneId === score.geneId);
      return {
        ...score,
        tournamentWins: standing?.wins,
        tournamentLosses: standing?.losses,
        tournamentMargin: standing?.voteMargin
      };
    })
    .sort((a, b) => {
      const left = tournament.standings.find((item) => item.geneId === a.geneId);
      const right = tournament.standings.find((item) => item.geneId === b.geneId);
      return (right?.wins ?? 0) - (left?.wins ?? 0)
        || (right?.voteMargin ?? 0) - (left?.voteMargin ?? 0)
        || b.finalYesness - a.finalYesness;
    });

  const selected = scores.find((item) => item.geneId === tournament.winnerGeneId) ?? scores[0];
  const selectedGene = selected ? input.state.activeGenes.find((gene) => gene.id === selected.geneId) : undefined;
  if (!selected || !selectedGene) {
    return {
      decision: input.decision,
      insight: {
        loaded: true,
        scores,
        tournament,
        installedModels,
        explanation: 'Trained models were installed but did not produce a selected gene.',
        metrics: collectMetrics(models)
      }
    };
  }

  const enhancedScores = scores.map((score): PolicyScore => {
    const base = input.decision.scores.find((item) => item.geneId === score.geneId);
    return {
      geneId: score.geneId,
      exploitation: base?.exploitation ?? 0,
      exploration: base?.exploration ?? 0,
      prior: base?.prior ?? 0,
      score: round(score.finalYesness * 2 - 1),
      predictedReward: round(score.finalYesness * 2 - 1),
      predictedYesness: round(score.finalYesness),
      matchedSignals: base?.matchedSignals ?? []
    };
  });

  return {
    decision: {
      ...input.decision,
      selectedGene,
      scores: enhancedScores,
      predictedYesness: round(selected.finalYesness),
      explanation: [
        input.decision.explanation,
        `Gene Tournament selected ${selectedGene.id}: wins=${selected.tournamentWins ?? 0}, margin=${round(selected.tournamentMargin ?? 0)}, blend=${pct(selected.finalYesness)}, bandit=${pct(selected.banditYesness)}, reward=${pct(selected.rewardModelYesness)}, policy=${pct(selected.policyModelProb)}, memory=${pct(selected.memorySimilarity)}.`
      ].join(' ')
    },
    insight: {
      loaded: true,
      selectedGeneId: selectedGene.id,
      predictedYesness: round(selected.finalYesness),
      scores,
      tournament,
      installedModels,
      explanation: `Gene Tournament = weighted Condorcet pairwise election across online bandit, reward model, policy model, and memory voters. ${tournament.condorcetWinner ? 'Winner beat every other gene head-to-head.' : 'No full Condorcet winner; using Copeland wins + vote margin + weighted blend tie-break.'}`,
      metrics: collectMetrics(models)
    }
  };
}

function runGeneTournament(scores: TrainedGeneScore[]): GeneTournamentResult {
  const standings = new Map<string, GeneTournamentStanding>();
  const rounds: GeneTournamentRound[] = [];
  for (const score of scores) {
    standings.set(score.geneId, {
      geneId: score.geneId,
      wins: 0,
      losses: 0,
      ties: 0,
      voteMargin: 0,
      weightedBlendScore: score.finalYesness
    });
  }

  for (let i = 0; i < scores.length; i += 1) {
    for (let j = i + 1; j < scores.length; j += 1) {
      const left = scores[i];
      const right = scores[j];
      const voters = pairwiseVoters(left, right);
      const leftVotes = round(voters
        .filter((voter) => voter.preferredGeneId === left.geneId)
        .reduce((sum, voter) => sum + voter.weight, 0));
      const rightVotes = round(voters
        .filter((voter) => voter.preferredGeneId === right.geneId)
        .reduce((sum, voter) => sum + voter.weight, 0));
      const winnerGeneId = leftVotes > rightVotes
        ? left.geneId
        : rightVotes > leftVotes
          ? right.geneId
          : left.finalYesness > right.finalYesness
            ? left.geneId
            : right.finalYesness > left.finalYesness
              ? right.geneId
              : undefined;
      const margin = round(leftVotes - rightVotes);
      rounds.push({
        leftGeneId: left.geneId,
        rightGeneId: right.geneId,
        leftVotes,
        rightVotes,
        winnerGeneId,
        margin,
        voters
      });
      const leftStanding = standings.get(left.geneId);
      const rightStanding = standings.get(right.geneId);
      if (!leftStanding || !rightStanding) continue;
      leftStanding.voteMargin = round(leftStanding.voteMargin + margin);
      rightStanding.voteMargin = round(rightStanding.voteMargin - margin);
      if (!winnerGeneId) {
        leftStanding.ties += 1;
        rightStanding.ties += 1;
      } else if (winnerGeneId === left.geneId) {
        leftStanding.wins += 1;
        rightStanding.losses += 1;
      } else {
        rightStanding.wins += 1;
        leftStanding.losses += 1;
      }
    }
  }

  const ranked = [...standings.values()].sort((a, b) => b.wins - a.wins
    || b.voteMargin - a.voteMargin
    || b.weightedBlendScore - a.weightedBlendScore);
  const winner = ranked[0];
  const maxPossibleWins = Math.max(0, scores.length - 1);
  return {
    method: 'weighted_condorcet_gene_tournament',
    winnerGeneId: winner?.geneId,
    condorcetWinner: Boolean(winner && winner.wins === maxPossibleWins),
    rounds,
    standings: ranked
  };
}

function pairwiseVoters(left: TrainedGeneScore, right: TrainedGeneScore): GeneTournamentVoterDecision[] {
  return [
    pairwiseVoter('online_bandit', 0.30, left.geneId, right.geneId, left.banditYesness, right.banditYesness),
    pairwiseVoter('reward_model', 0.35, left.geneId, right.geneId, left.rewardModelYesness ?? left.banditYesness, right.rewardModelYesness ?? right.banditYesness),
    pairwiseVoter('policy_model', 0.20, left.geneId, right.geneId, left.policyModelProb ?? left.banditYesness, right.policyModelProb ?? right.banditYesness),
    pairwiseVoter('memory_similarity', 0.15, left.geneId, right.geneId, left.memorySimilarity ?? left.banditYesness, right.memorySimilarity ?? right.banditYesness)
  ];
}

function pairwiseVoter(
  voter: GeneTournamentVoterDecision['voter'],
  weight: number,
  leftGeneId: string,
  rightGeneId: string,
  leftScore: number,
  rightScore: number
): GeneTournamentVoterDecision {
  const epsilon = 0.0001;
  return {
    voter,
    weight,
    leftScore: round(leftScore),
    rightScore: round(rightScore),
    preferredGeneId: Math.abs(leftScore - rightScore) <= epsilon
      ? undefined
      : leftScore > rightScore
        ? leftGeneId
        : rightGeneId
  };
}

async function loadRuntimeModels(): Promise<RuntimeModels> {
  const [rewardModel, policyModel, embeddingIndex] = await Promise.all([
    readJsonMaybe<RewardModel>('memory/evomate/models/reward_model/preference_model.json'),
    readJsonMaybe<PolicyModel>('memory/evomate/models/policy_model/policy_model.json'),
    readJsonMaybe<EmbeddingIndex>('memory/evomate/models/embedding_index/embedding_index.json')
  ]);
  return { rewardModel, policyModel, embeddingIndex };
}

async function readJsonMaybe<T>(relativePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(resolve(resolveFromProjectRoot('.'), relativePath), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function scoreRewardModel(model: RewardModel, context: Record<string, number>, gene: BehaviorGene, signal: UserInputSignal): number {
  const weights = model.weights ?? {};
  const features = preferenceFeatures(context, gene, signal);
  return sigmoid(dot(weights, features));
}

function scorePolicyModel(model: PolicyModel, context: Record<string, number>, genes: BehaviorGene[]): Record<string, number> {
  const weightsByGene = model.weights_by_gene ?? {};
  const logits: Record<string, number> = {};
  for (const gene of genes) {
    logits[gene.id] = dot(weightsByGene[gene.id] ?? {}, context);
  }
  return softmax(logits);
}

function scoreMemory(index: EmbeddingIndex, currentVector: Array<[number, number]>, geneId: string): number {
  const vectors = index.vectors ?? [];
  let best = 0;
  for (const item of vectors) {
    if (item.geneId !== geneId || !item.vector?.length) continue;
    const rewardMultiplier = typeof item.reward === 'number' ? (item.reward + 1) / 2 : 0.5;
    best = Math.max(best, cosineSparse(currentVector, item.vector) * rewardMultiplier);
  }
  return clamp01(best);
}

function contextFeatures(rawInput: string, signal: UserInputSignal): Record<string, number> {
  const semantic = signal.semantic;
  const features: Record<string, number> = {
    bias: 1,
    [`task:${semantic.taskType ?? signal.taskType}`]: 1,
    [`risk:${semantic.riskLevel ?? signal.riskLevel}`]: 1
  };
  if (rawInput.length <= 24) features.message_short = 1;
  if (rawInput.length >= 120) features.message_long = 1;
  for (const signalName of signal.signals) {
    features[`signal:${signalName}`] = 1;
  }
  if (/先|看看|分析|讲|解释|别|不要|没叫你|你干啥/.test(rawInput)) features['wants:analysis'] = 1;
  if (/继续|直接|开始|搞|跑|推|部署|改|做一下/.test(rawInput)) features['wants:direct_action'] = 1;
  if (/图|画|可视化|前端|界面|dashboard|驾驶舱/i.test(rawInput)) features['wants:visualization'] = 1;
  if (/查|搜索|研究|官网|调查|资料/.test(rawInput)) features['wants:research'] = 1;
  if (/路演|pitch|demo|评委|黑客松|商业|故事/i.test(rawInput)) features['wants:roadshow'] = 1;
  return features;
}

function preferenceFeatures(context: Record<string, number>, gene: BehaviorGene, signal: UserInputSignal): Record<string, number> {
  const features = { ...context, [`gene:${gene.id}`]: 1 };
  let overlap = 0;
  for (const signalName of signal.signals) {
    if (gene.signals.includes(signalName)) overlap += 1;
    features[`gene_signal:${gene.id}:${signalName}`] = 1;
  }
  features.gene_signal_overlap = overlap / 5;
  return features;
}

function hashedEmbedding(text: string, signals: string[], dimensions: number): Array<[number, number]> {
  const counts = new Map<number, number>();
  for (const token of [...tokenize(text), ...signals.map((signal) => `signal:${signal}`)]) {
    const index = stableHash(token) % dimensions;
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  const norm = Math.sqrt([...counts.values()].reduce((sum, value) => sum + value * value, 0));
  if (!norm) return [];
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([index, value]) => [index, round(value / norm)] as [number, number]);
}

function tokenize(text: string): string[] {
  const ascii = text.toLowerCase().match(/[a-zA-Z0-9_]{2,}/g) ?? [];
  const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
  const phrases = [
    [/先|看看|分析|讲|解释|别|不要|没叫你|你干啥/, 'analysis'],
    [/继续|直接|开始|搞|跑|推|部署|改|做一下/, 'direct_action'],
    [/图|画|可视化|前端|界面|dashboard|驾驶舱/i, 'visualization'],
    [/查|搜索|研究|官网|调查|资料/, 'research'],
    [/路演|pitch|demo|评委|黑客松|商业|故事/i, 'roadshow']
  ].filter(([pattern]) => (pattern as RegExp).test(text)).map(([, token]) => token as string);
  return [...ascii, ...cjk, ...phrases];
}

function stableHash(text: string): number {
  let value = 2166136261;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value >>> 0;
}

function cosineSparse(left: Array<[number, number]>, right: Array<[number, number]>): number {
  const rightMap = new Map(right.map(([index, value]) => [index, value]));
  return left.reduce((sum, [index, value]) => sum + value * (rightMap.get(index) ?? 0), 0);
}

function dot(weights: Record<string, number>, features: Record<string, number>): number {
  return Object.entries(features).reduce((sum, [key, value]) => sum + (weights[key] ?? 0) * value, 0);
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function softmax(logits: Record<string, number>): Record<string, number> {
  const values = Object.values(logits);
  const max = values.length ? Math.max(...values) : 0;
  const expEntries = Object.entries(logits).map(([key, value]) => [key, Math.exp(value - max)] as const);
  const total = expEntries.reduce((sum, [, value]) => sum + value, 0) || 1;
  return Object.fromEntries(expEntries.map(([key, value]) => [key, value / total]));
}

function collectMetrics(models: RuntimeModels): Record<string, unknown> {
  return {
    rewardModel: models.rewardModel?.metrics,
    policyModel: models.policyModel?.metrics,
    embeddingIndex: models.embeddingIndex?.metrics
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function pct(value: number | undefined): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : 'n/a';
}
