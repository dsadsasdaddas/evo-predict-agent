'use client';

import {
  BrainCircuit,
  Cpu,
  GitBranch,
  History,
  Layers3,
  Network,
  Play,
  RadioTower,
  RefreshCcw,
  Smartphone,
  Zap
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, HOSTED_API_URL, fetchEvolutionHistory, fetchEvolutionState, fetchMemoryRoute, queueTraining, sendFeedback } from '@/lib/evomate-api';
import type {
  EvolutionHistory,
  EvolutionState,
  EvolutionTimelineItem,
  FeedbackKind,
  LiveStatus,
  MemoryRouteResponse,
  TrainResponse
} from '@/lib/types';

type GeneMeta = {
  id: string;
  name: string;
  title: string;
  action: string;
  score: number;
};

type PipelineStage = {
  key: string;
  title: string;
  detail: string;
  types: string[];
  icon: ReactNode;
};

type HookBroadcastDetail = {
  receipt?: { ok?: boolean; status?: number; at?: string; count?: number };
  events?: Array<{ source?: string; eventKind?: string; occurredAt?: string; contentPreview?: string }>;
};

type LiveModel = {
  state: EvolutionState | null;
  history: EvolutionHistory | null;
  memoryRoute: MemoryRouteResponse | null;
  status: LiveStatus;
  lastError: string | null;
  lastUpdatedAt: string | null;
  refresh: () => Promise<void>;
  feedback: (kind: FeedbackKind, text?: string, score?: number, signals?: string[]) => Promise<void>;
  train: (type?: 'preference_train' | 'policy_replay_eval' | 'evolution_gym_eval' | 'embedding_build') => Promise<void>;
  busy: 'feedback' | 'train' | null;
  trainReceipt: TrainResponse | null;
};

type FeedbackPreset = {
  id: string;
  label: string;
  caption: string;
  kind: FeedbackKind;
  score: number;
  signals: string[];
  text: string;
  tone: 'positive' | 'negative' | 'caution' | 'neutral';
};

const geneCatalog: GeneMeta[] = [
  {
    id: 'gene_mcp_first_architecture',
    name: 'Architect Yes',
    title: 'MCP 优先架构',
    action: '先映射 EvoMap/MCP/训练层，再写代码。',
    score: 0.88
  },
  {
    id: 'gene_ask_before_execution',
    name: 'Safe Yes',
    title: '风险确认型',
    action: '高风险修改前先确认，低风险直接推进。',
    score: 0.86
  },
  {
    id: 'gene_concise_direct_answer',
    name: 'Fast Yes',
    title: '快速执行型',
    action: '减少废话，直接给下一步和结果。',
    score: 0.78
  },
  {
    id: 'gene_deep_research_first',
    name: 'Research Yes',
    title: '证据优先型',
    action: '遇到外部事实先查证，再给方案。',
    score: 0.72
  },
  {
    id: 'gene_visualize_first',
    name: 'Visual Yes',
    title: '可视化优先型',
    action: '复杂概念先画图，方便路演理解。',
    score: 0.76
  },
  {
    id: 'gene_yes_engineer_policy',
    name: 'Policy Yes',
    title: '策略学习型',
    action: '把用户反馈写入 GEP 和训练集。',
    score: 0.8
  }
];

const pipeline: PipelineStage[] = [
  {
    key: 'hook',
    title: 'Hook',
    detail: '捕获用户/工具事件',
    types: ['hook_received', 'omni_hook_received'],
    icon: <RadioTower />
  },
  {
    key: 'semantic',
    title: 'Semantic',
    detail: '解析意图/风险/语气',
    types: ['semantic_parsed'],
    icon: <BrainCircuit />
  },
  {
    key: 'vote',
    title: 'Tournament',
    detail: '行为基因两两对决',
    types: ['tournament_completed'],
    icon: <GitBranch />
  },
  {
    key: 'inject',
    title: 'Advisor',
    detail: '注入当前回合建议',
    types: ['advisor_injected'],
    icon: <Zap />
  },
  {
    key: 'gep',
    title: 'GEP Memory',
    detail: '写入进化资产',
    types: ['gep_assets_written', 'remote_job_imported'],
    icon: <Layers3 />
  },
  {
    key: 'train',
    title: 'Train',
    detail: '后台训练/索引构建',
    types: ['remote_job_queued'],
    icon: <Cpu />
  }
];

const feedbackPresets: FeedbackPreset[] = [
  {
    id: 'hit',
    label: '命中我',
    caption: '方向正确',
    kind: 'accepted',
    score: 0.92,
    signals: ['intent_hit', 'preferred_behavior_reinforced'],
    text: '手机端反馈：这次命中我的意图，保持这个行为策略。',
    tone: 'positive'
  },
  {
    id: 'miss',
    label: '不懂我',
    caption: '意图偏了',
    kind: 'corrected',
    score: 0.18,
    signals: ['intent_miss', 'needs_clarification'],
    text: '手机端反馈：这次没有理解我的真实意图，下次先澄清再行动。',
    tone: 'negative'
  },
  {
    id: 'slow',
    label: '太慢',
    caption: '更快执行',
    kind: 'corrected',
    score: 0.36,
    signals: ['too_slow', 'prefer_fast_execution'],
    text: '手机端反馈：这次推进太慢，下次减少解释，更快给可执行结果。',
    tone: 'neutral'
  },
  {
    id: 'shallow',
    label: '太浅',
    caption: '需要深入',
    kind: 'corrected',
    score: 0.42,
    signals: ['too_shallow', 'prefer_deeper_reasoning'],
    text: '手机端反馈：这次分析太浅，下次需要更深入的推理和方案。',
    tone: 'neutral'
  },
  {
    id: 'risky',
    label: '太冒进',
    caption: '先确认',
    kind: 'interrupted',
    score: 0.16,
    signals: ['too_risky', 'ask_before_execution'],
    text: '手机端反馈：这次太冒进，涉及风险或大改动时先确认。',
    tone: 'caution'
  },
  {
    id: 'verbose',
    label: '太啰嗦',
    caption: '更简洁',
    kind: 'corrected',
    score: 0.32,
    signals: ['too_verbose', 'prefer_concise_answer'],
    text: '手机端反馈：这次太啰嗦，下次更短更直接。',
    tone: 'neutral'
  },
  {
    id: 'undo',
    label: '撤回',
    caption: '反向学习',
    kind: 'undo',
    score: 0.05,
    signals: ['undo_requested', 'strong_negative_outcome'],
    text: '手机端反馈：这次需要撤回，作为强负反馈写入策略。',
    tone: 'negative'
  }
];

export function MobileObserver() {
  const model = useEvoMateLive();
  const derived = useDerivedState(model.state, model.history);
  const animatedYesness = useAnimatedNumber(derived.yesness);
  const [selectedFlowKey, setSelectedFlowKey] = useState(pipeline[0].key);
  const [feedbackExpanded, setFeedbackExpanded] = useState(true);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#03050a] text-white">
      <ConsoleBackground />
      <HookImpactFx event={derived.latestHook} />
      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-[480px] flex-col px-4 pb-72 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
              <Smartphone className="h-4 w-4 text-white/58" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-[-0.04em]">EvoMate Pocket</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">agent evolution remote</p>
            </div>
          </div>
          <LiveBadge status={model.status} />
        </div>

        <HookSourceCard event={derived.latestHook} status={model.status} onRefresh={model.refresh} />

        <HookBeacon event={derived.latestHook} status={model.status} />

        <EvolutionGraphEntry event={derived.latest} yesness={derived.yesness} activeGeneName={derived.activeGene.name} />

        <MemoryMoEPanel derived={derived} memoryRoute={model.memoryRoute} />

        <section className="mt-4 overflow-hidden rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[#8dffcc]/75">yes pulse</p>
              <h1 className="mt-2 text-6xl font-semibold leading-none tracking-[-0.09em] text-white">{pct(animatedYesness)}</h1>
              <p className="mt-2 text-sm text-white/48">{derived.activeGene.name} · {yesMode(derived.yesness)}</p>
            </div>
            <PulseOrb yesness={animatedYesness} status={model.status} eventKey={`${derived.latest?.id || 'idle'}:${pct(derived.yesness)}`} />
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-[#8dffcc] transition-all duration-500"
              style={{ width: `${Math.max(8, animatedYesness * 100)}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <MobileStat label="Gene" value={derived.activeGene.name} />
            <MobileStat label="Phase" value={derived.phase.replace(/_/g, ' ')} />
            <MobileStat label="Events" value={`${derived.totalEvents}`} />
          </div>
        </section>

        <section className="mt-4 rounded-[26px] border border-white/[0.08] bg-[#070b12]/88 p-4">
          <SectionHeader icon={<Network />} title="Current Flow" subtitle={derived.latest ? timeAgo(derived.latest.createdAt) : 'waiting'} />
          <div className="mt-4 grid gap-2">
            {pipeline.map((stage) => {
              const state = stageState(stage, derived.timeline);
              const selected = selectedFlowKey === stage.key;
              return (
                <div key={stage.key} className={`overflow-hidden rounded-2xl border transition duration-500 ${selected ? 'border-white/[0.14] bg-white/[0.045]' : stage.key === 'hook' && isHookFresh(derived.latestHook) ? 'evomate-hook-card border-[#20e6ff]/30 bg-[#20e6ff]/[0.065]' : 'border-white/[0.07] bg-white/[0.03]'}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedFlowKey(selected ? '' : stage.key)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                    aria-expanded={selected}
                  >
                    <span className={`flex h-7 w-7 items-center justify-center rounded-xl border ${state === 'active' ? 'border-[#20e6ff]/32 bg-[#20e6ff]/10 text-[#20e6ff]' : state === 'done' ? 'border-white/10 bg-white/[0.035] text-white/45' : 'border-white/10 bg-white/[0.03] text-white/30'} [&>svg]:h-3.5 [&>svg]:w-3.5`}>
                      {stage.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white">{stage.title}</p>
                      <p className="truncate text-xs text-white/35">{stage.detail}</p>
                    </div>
                    <span className={`text-xs ${selected ? 'text-white/58' : 'text-white/35'}`}>{selected ? 'open' : state === 'active' ? 'now' : state === 'done' ? 'done' : 'wait'}</span>
                  </button>
                  {selected && <FlowStageDetail stage={stage} derived={derived} state={state} />}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-4 rounded-[26px] border border-white/[0.08] bg-[#070b12]/88 p-4">
          <SectionHeader icon={<History />} title="Live Log" subtitle={`${derived.timeline.length} events`} />
          <div className="mt-4 space-y-2">
            {derived.timeline.length ? derived.timeline.slice(0, 6).map((item) => (
              <div key={item.id} className={`rounded-2xl border p-3 transition duration-500 ${isHookEvent(item) ? 'border-[#20e6ff]/22 bg-[#20e6ff]/[0.045] shadow-[0_0_28px_rgba(32,230,255,0.07)]' : 'border-white/[0.06] bg-black/20'}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-[#20e6ff]/60">{compactType(item.type)}</span>
                  <span className="text-[10px] text-white/32">{formatClock(item.createdAt)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/58">{item.summary}</p>
              </div>
            )) : (
              <div className="rounded-2xl border border-white/[0.06] bg-black/20 p-4 text-sm text-white/42">等待 Codex hook 写入事件。</div>
            )}
          </div>
        </section>

        <section className="mt-4 rounded-[26px] border border-white/[0.08] bg-[#070b12]/88 p-4">
          <SectionHeader icon={<Cpu />} title="Training" subtitle={trainingSubtitle(model.trainReceipt, derived.latestJobStatus)} />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <MobileStat label="Reward" value="online" />
            <MobileStat label="Policy" value={derived.latestJobStatus || 'ready'} />
            <MobileStat label="Memory" value={derived.embeddingStatus} />
          </div>
        </section>

        {model.lastError && (
          <p className="mt-4 rounded-2xl border border-[#ff8b8b]/18 bg-[#ff8b8b]/[0.06] p-3 text-xs leading-5 text-[#ffb0b0]">
            {model.lastError}
          </p>
        )}

        <FeedbackLoopDock
          expanded={feedbackExpanded}
          onToggle={() => setFeedbackExpanded((value) => !value)}
          model={model}
        />
      </section>
    </main>
  );
}

function useEvoMateLive(): LiveModel {
  const [state, setState] = useState<EvolutionState | null>(null);
  const [history, setHistory] = useState<EvolutionHistory | null>(null);
  const [memoryRoute, setMemoryRoute] = useState<MemoryRouteResponse | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<LiveModel['busy']>(null);
  const [trainReceipt, setTrainReceipt] = useState<TrainResponse | null>(null);
  const stateStamp = useRef('');

  const refresh = useCallback(async () => {
    try {
      const [nextState, nextHistory, nextMemoryRoute] = await Promise.all([
        fetchEvolutionState(),
        fetchEvolutionHistory(24, true),
        fetchMemoryRoute().catch(() => null)
      ]);
      const latest = nextState.timeline?.[0];
      const stamp = [nextState.generation, nextState.phase, latest?.id, latest?.createdAt, nextState.metrics?.yesnessScore].join(':');
      setState(nextState);
      setHistory(nextHistory);
      setMemoryRoute(nextMemoryRoute);
      setStatus('live');
      setLastError(null);
      if (stamp !== stateStamp.current) {
        stateStamp.current = stamp;
        setLastUpdatedAt(latest?.createdAt || new Date().toISOString());
      }
    } catch (error) {
      setStatus('offline');
      setLastError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (!cancelled) await refresh();
    }
    tick();
    const timer = window.setInterval(tick, 1400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const feedback = useCallback(async (kind: FeedbackKind, text?: string, score?: number, signals?: string[]) => {
    const latestGene = state?.timeline?.find((item) => item.geneId)?.geneId;
    const latestSignals = state?.timeline?.find((item) => item.signals?.length)?.signals;
    const mergedSignals = [...new Set([...(latestSignals ?? []), ...(signals ?? [])])];
    setBusy('feedback');
    try {
      const result = await sendFeedback({ kind, text, score, geneId: latestGene, signals: mergedSignals });
      if (result.state) setState(result.state);
      await refresh();
    } catch (error) {
      setStatus('offline');
      setLastError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [refresh, state]);

  const train = useCallback(async (type: 'preference_train' | 'policy_replay_eval' | 'evolution_gym_eval' | 'embedding_build' = 'preference_train') => {
    setBusy('train');
    try {
      const result = await queueTraining(type);
      setTrainReceipt(result);
      await refresh();
    } catch (error) {
      setStatus('offline');
      setLastError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  return { state, history, memoryRoute, status, lastError, lastUpdatedAt, refresh, feedback, train, busy, trainReceipt };
}

function useDerivedState(state: EvolutionState | null, history: EvolutionHistory | null) {
  return useMemo(() => {
    const timeline = (history?.timeline?.length ? history.timeline : state?.timeline ?? []).slice(0, 24);
    const latest = timeline[0];
    const latestGeneId = timeline.find((item) => item.geneId)?.geneId;
    const activeGene = geneCatalog.find((gene) => gene.id === latestGeneId) ?? geneCatalog[0];
    const tournament = timeline.find((item) => item.type === 'tournament_completed');
    const yesFromTournament = extractPercent(tournament?.summary);
    const yesness = clamp(
      yesFromTournament ?? state?.metrics?.yesnessScore ?? timeline.find((item) => typeof item.score === 'number' && item.geneId)?.score ?? activeGene.score,
      0.02,
      0.98
    );
    const jobs = history?.jobs ?? [];
    const latestJob = jobs[0];
    const latestHook = timeline.find(isHookEvent);
    return {
      timeline,
      latest,
      latestHook,
      activeGene,
      yesness,
      phase: state?.phase ?? 'strategy_decision',
      totalEvents: history?.totalTimeline ?? state?.timeline?.length ?? timeline.length,
      latestJobStatus: latestJob?.status,
      embeddingStatus: jobs.some((job) => job.type === 'embedding_build' && job.status !== 'completed') ? 'building' : 'ready'
    };
  }, [history, state]);
}

function useAnimatedNumber(value: number) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);

  useEffect(() => {
    const from = displayRef.current;
    const delta = value - from;
    if (Math.abs(delta) < 0.002) {
      displayRef.current = value;
      setDisplay(value);
      return;
    }

    const duration = 680;
    const start = window.performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + delta * eased;
      displayRef.current = next;
      setDisplay(next);
      if (progress < 1) raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [value]);

  return display;
}

function FlowStageDetail({
  stage,
  derived,
  state
}: {
  stage: PipelineStage;
  derived: ReturnType<typeof useDerivedState>;
  state: 'idle' | 'done' | 'active';
}) {
  const event = stageEvent(stage, derived.timeline);
  const detail = stageReadableDetail(stage.key, derived, event);

  return (
    <div className="evomate-flow-detail border-t border-white/[0.06] px-3 pb-3 pt-2">
      <div className="evomate-detail-rise grid grid-cols-2 gap-2">
        <FlowMiniStat label="State" value={state} tone={state === 'active' ? 'cyan' : 'muted'} />
        <FlowMiniStat label="Updated" value={event ? timeAgo(event.createdAt) : 'no receipt'} />
      </div>
      <FlowStageMotion stage={stage} state={state} score={event?.score ?? derived.yesness} winner={derived.activeGene.name} />
      <div className="evomate-detail-rise mt-2 rounded-2xl border border-white/[0.06] bg-black/20 p-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/28">{detail.label}</p>
        <p className="mt-1 text-sm leading-6 text-white/66">{detail.primary}</p>
        <p className="mt-2 text-xs leading-5 text-white/38">{detail.secondary}</p>
      </div>
      {event && (
        <div className="evomate-detail-rise mt-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#20e6ff]/60">{compactType(event.type)}</span>
            {typeof event.score === 'number' && <span className="text-[10px] text-white/38">{pct(event.score)}</span>}
          </div>
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-white/48">{event.summary}</p>
        </div>
      )}
    </div>
  );
}

function FlowStageMotion({
  stage,
  state,
  score,
  winner
}: {
  stage: PipelineStage;
  state: 'idle' | 'done' | 'active';
  score?: number;
  winner?: string;
}) {
  const running = state === 'active';
  const height = stage.key === 'vote' ? 'h-24' : 'h-16';
  return (
    <div className={`evomate-detail-rise mt-2 overflow-hidden rounded-2xl border border-white/[0.06] bg-black/18 p-3 ${state === 'idle' ? 'opacity-55' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/28">{stage.title} motion</span>
        <span className={`text-[10px] ${running ? 'text-[#20e6ff]' : 'text-white/34'}`}>{running ? 'running' : state}</span>
      </div>
      <div className={`relative mt-3 ${height} overflow-hidden rounded-2xl border border-white/[0.055] bg-[#050810]/90`}>
        <div className="absolute inset-x-5 top-1/2 h-px -translate-y-1/2 bg-white/[0.08]" />
        <div className="absolute left-5 right-5 top-1/2 h-px -translate-y-1/2 overflow-hidden">
          <span className="evomate-stage-packet absolute left-0 top-0 h-px w-1/3 bg-[#20e6ff]/80" />
        </div>
        <StageMotionVariant stageKey={stage.key} score={score} winner={winner} />
      </div>
    </div>
  );
}

function StageMotionVariant({ stageKey, score, winner }: { stageKey: string; score?: number; winner?: string }) {
  if (stageKey === 'semantic') {
    return (
      <div className="absolute inset-0 flex items-center justify-center gap-2">
        {['intent', 'risk', 'tone'].map((label, index) => (
          <span
            key={label}
            className="evomate-semantic-chip rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[10px] text-white/46"
            style={{ animationDelay: `${index * 180}ms` }}
          >
            {label}
          </span>
        ))}
      </div>
    );
  }

  if (stageKey === 'vote') {
    return (
      <div className="absolute inset-0 p-2">
        <div className="grid grid-cols-4 gap-1">
          {['bandit', 'reward', 'policy', 'memory'].map((voter, index) => (
            <span
              key={voter}
              className="evomate-voter-chip truncate rounded-full border border-white/[0.07] bg-white/[0.035] px-2 py-1 text-center text-[9px] text-white/38"
              style={{ animationDelay: `${index * 120}ms` }}
            >
              {voter}
            </span>
          ))}
        </div>
        <div className="absolute inset-x-3 top-[39px] flex items-center justify-between gap-2">
          <span className="evomate-duel-card rounded-xl border border-white/[0.07] bg-white/[0.035] px-2.5 py-1.5 text-[10px] text-white/50">gene A</span>
          <span className="evomate-duel-vs rounded-full border border-[#20e6ff]/18 bg-[#20e6ff]/[0.06] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#20e6ff]/70">duel</span>
          <span className="evomate-duel-card rounded-xl border border-white/[0.07] bg-white/[0.035] px-2.5 py-1.5 text-[10px] text-white/50">gene B</span>
          <span className="evomate-duel-card hidden rounded-xl border border-white/[0.07] bg-white/[0.035] px-2.5 py-1.5 text-[10px] text-white/50 sm:inline">gene C</span>
        </div>
        <div className="absolute inset-x-3 bottom-2 flex items-center justify-between rounded-xl border border-[#8dffcc]/14 bg-[#8dffcc]/[0.055] px-3 py-1.5">
          <span className="truncate text-[10px] text-[#d8ffe9]">winner · {winner || 'selected gene'}</span>
          <span className="ml-2 shrink-0 text-[10px] text-[#8dffcc]/75">{pct(score)}</span>
        </div>
      </div>
    );
  }

  if (stageKey === 'inject') {
    return (
      <div className="absolute inset-0 flex items-center justify-between px-5">
        <span className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] text-white/46">advisor</span>
        <span className="evomate-inject-beam h-px flex-1 bg-[#20e6ff]/60" />
        <span className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] text-white/46">codex</span>
      </div>
    );
  }

  if (stageKey === 'gep') {
    return (
      <div className="absolute inset-0 flex items-center justify-center gap-2 px-4">
        {[
          ['feedback', 'pending'],
          ['outcome', 'pending'],
          ['mutation', 'slot']
        ].map(([label, status], index) => (
          <div
            key={label}
            className="evomate-gep-card min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.035] px-2.5 py-2"
            style={{ animationDelay: `${index * 150}ms` }}
          >
            <p className="truncate text-[9px] uppercase tracking-[0.12em] text-white/30">{label}</p>
            <p className="mt-1 truncate text-[10px] text-white/52">{status}</p>
          </div>
        ))}
        <span className="evomate-gep-write absolute bottom-2 left-6 right-6 h-px bg-[#20e6ff]/45" />
      </div>
    );
  }

  if (stageKey === 'train') {
    return (
      <div className="absolute inset-0 flex items-center justify-center gap-2">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className="evomate-train-bar w-2 rounded-full bg-[#8dffcc]/58"
            style={{ animationDelay: `${index * 110}ms` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="evomate-hook-radar relative h-10 w-10 rounded-full border border-[#20e6ff]/28">
        <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#20e6ff]/80" />
      </span>
      <span className="ml-5 text-[10px] uppercase tracking-[0.18em] text-white/32">capturing signal</span>
    </div>
  );
}

function FlowMiniStat({ label, value, tone = 'muted' }: { label: string; value: string; tone?: 'mint' | 'cyan' | 'muted' }) {
  const color = tone === 'mint' ? 'text-[#8dffcc]' : tone === 'cyan' ? 'text-[#20e6ff]' : 'text-white/62';
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-black/18 px-3 py-2">
      <p className="text-[9px] uppercase tracking-[0.16em] text-white/26">{label}</p>
      <p className={`mt-0.5 truncate text-xs font-medium ${color}`}>{value}</p>
    </div>
  );
}

function HookImpactFx({ event }: { event?: EvolutionTimelineItem }) {
  const [impact, setImpact] = useState<EvolutionTimelineItem | null>(null);
  const clearTimer = useRef<number | null>(null);

  const triggerImpact = useCallback((nextImpact: EvolutionTimelineItem) => {
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    setImpact(nextImpact);
    clearTimer.current = window.setTimeout(() => setImpact(null), 4200);
  }, []);

  useEffect(() => {
    if (!event || !isHookEvent(event) || !isHookFresh(event, 30000)) return;
    triggerImpact(event);
  }, [event?.id, triggerImpact]);

  useEffect(() => {
    function onBroadcast(raw: Event) {
      const detail = (raw as CustomEvent<HookBroadcastDetail>).detail;
      const first = detail?.events?.[0];
      triggerImpact({
        id: `evt_browser_broadcast_${Date.now()}`,
        type: 'omni_hook_received',
        createdAt: detail?.receipt?.at || first?.occurredAt || new Date().toISOString(),
        summary: `${first?.source || 'browser-extension'}:${first?.eventKind || 'message'} captured from live browser tab`,
        score: 0.72,
        signals: ['omni_hook', 'channel_browser_extension', `hook_${first?.eventKind || 'message'}`]
      });
    }
    window.addEventListener('evomate-hook-captured', onBroadcast as EventListener);
    return () => {
      window.removeEventListener('evomate-hook-captured', onBroadcast as EventListener);
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    };
  }, [triggerImpact]);

  if (!impact) return null;
  const local = isLocalActivityEvent(impact);

  return (
    <div key={impact.id} className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div className={`absolute inset-0 ${local ? 'evomate-local-screen-flash' : 'evomate-hook-screen-flash'}`} />
      <div className="evomate-hook-edge-pulse absolute right-0 top-20 h-44 w-px bg-[#20e6ff]/65 shadow-[0_0_34px_rgba(32,230,255,0.6)]" />
      <div className="absolute inset-x-4 top-4 mx-auto w-[min(360px,calc(100vw-28px))] overflow-hidden rounded-[22px] border border-[#20e6ff]/34 bg-[#06101a]/90 p-3 shadow-[0_20px_80px_rgba(32,230,255,0.18)] backdrop-blur-xl evomate-hook-toast">
        <div className="absolute inset-x-0 top-0 h-px bg-[#20e6ff]/65 evomate-hook-toast-progress" />
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-[#20e6ff]/24 bg-[#20e6ff]/10 text-[#20e6ff]">
            <RadioTower className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-[0.2em] text-[#20e6ff]/78">hook captured</p>
            <p className="mt-0.5 truncate text-[13px] font-semibold text-white">{hookTitle(impact)}</p>
            <p className="mt-0.5 truncate text-[11px] text-white/52">{impact.summary}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function HookSourceCard({
  event,
  status,
  onRefresh
}: {
  event?: EvolutionTimelineItem;
  status: LiveStatus;
  onRefresh: () => void;
}) {
  const display = hookDisplay(event, status);
  const fresh = isHookFresh(event);

  return (
    <section className={`mt-4 overflow-hidden rounded-[28px] border p-4 transition duration-500 ${fresh ? 'evomate-hook-card border-white/[0.14] bg-white/[0.045]' : 'border-white/[0.08] bg-[#070b12]/88'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] border border-[#20e6ff]/24 bg-[#20e6ff]/[0.08] text-[#20e6ff]">
            <RadioTower className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[28px] font-semibold leading-none tracking-[-0.075em] text-white">
              {display.title}
            </h1>
            <p className="mt-1 truncate text-xs text-white/38">{display.compactMeta}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-white/58">Cloud</span>
          <button
            onClick={onRefresh}
            className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.035] text-white/38 transition hover:border-[#20e6ff]/30 hover:text-[#20e6ff]"
            aria-label="refresh"
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-white/[0.055] bg-black/15 px-3 py-2">
        <p className="line-clamp-1 text-xs leading-5 text-white/42">{display.preview}</p>
      </div>
    </section>
  );
}


function EvolutionGraphEntry({
  event,
  yesness,
  activeGeneName
}: {
  event?: EvolutionTimelineItem;
  yesness: number;
  activeGeneName: string;
}) {
  const point = event ? compactType(event.type) : 'waiting point';
  return (
    <a
      href="/graph"
      className="group mt-4 block overflow-hidden rounded-[28px] border border-[#8dffcc]/14 bg-[#8dffcc]/[0.045] p-4 shadow-[0_26px_90px_rgba(32,230,255,0.08)] transition duration-300 hover:border-[#8dffcc]/28 hover:bg-[#8dffcc]/[0.07]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] border border-[#8dffcc]/22 bg-[#8dffcc]/10 text-[#8dffcc]">
            <Network className="h-5 w-5" />
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-[#20e6ff] shadow-[0_0_18px_rgba(32,230,255,0.8)]" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[-0.04em] text-white">打开进化树镜头</p>
            <p className="mt-1 truncate text-xs text-white/42">当前点：{point} · {activeGeneName}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tracking-[-0.08em] text-white">{pct(yesness)}</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#8dffcc]/58">open graph</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        {['Hook', 'Signal', 'Gene', 'GEP', 'Next'].map((label, index) => (
          <span key={label} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-[#8dffcc]/70 shadow-[0_0_16px_rgba(141,255,204,0.45)] transition group-hover:bg-[#20e6ff]"
              style={{ opacity: 0.36 + index * 0.12 }}
            />
            <span className="truncate text-[10px] text-white/30">{label}</span>
          </span>
        ))}
      </div>
    </a>
  );
}

function MemoryMoEPanel({
  derived,
  memoryRoute
}: {
  derived: ReturnType<typeof useDerivedState>;
  memoryRoute: MemoryRouteResponse | null;
}) {
  const gepEvents = derived.timeline.filter((item) => /gep_assets_written|remote_job_imported/i.test(item.type)).length;
  const validationEvents = derived.timeline.filter((item) => /validation|command|tool_result|policy_reward|feedback|outcome/i.test(`${item.type} ${item.summary}`)).length;
  const hookEvents = derived.timeline.filter(isHookEvent).length;
  const activeExpert = memoryRoute?.activeExpert ?? pickActiveMemoryExpert(derived.latest);
  const fallbackExperts = [
    {
      label: 'Episodic',
      value: `${hookEvents || derived.totalEvents} turns`,
      detail: '最近会话、工具结果、用户纠正',
      tone: 'cyan'
    },
    {
      label: 'Procedural',
      value: gepEvents ? `${gepEvents} capsules` : 'recipe ready',
      detail: '项目流程：先查架构 / 再改 / 跑检查',
      tone: 'mint'
    },
    {
      label: 'Validation',
      value: validationEvents ? `${validationEvents} proofs` : 'needs proof',
      detail: '命令成败、测试结果、可复用约束',
      tone: validationEvents ? 'mint' : 'amber'
    },
    {
      label: 'Router',
      value: activeExpert,
      detail: '工程 MoE：按信号选记忆专家',
      tone: 'cyan'
    }
  ];
  const routedExperts = memoryRoute?.experts?.length
    ? memoryRoute.experts.slice(0, 4).map((expert) => ({
      label: expert.label,
      value: expert.status === 'active' ? `${pct(expert.score)} active` : pct(expert.score),
      detail: expert.evidence || expert.role,
      tone: expert.status === 'active' ? 'mint' : expert.status === 'ready' ? 'cyan' : 'amber',
      route: expert
    }))
    : fallbackExperts;
  const topMemory = memoryRoute?.recalledMemories?.[0];
  const gepProof = memoryRoute?.gepProof;
  const routePlan = memoryRoute?.routePlan?.slice(0, 4) ?? [
    `retrieve:${activeExpert}`,
    'route:latest signals',
    `execute:${derived.activeGene.id}`,
    'solidify:GEP feedback'
  ];

  return (
    <section className="mt-4 overflow-hidden rounded-[28px] border border-[#20e6ff]/14 bg-[#07121a]/88 p-4 shadow-[0_22px_80px_rgba(0,0,0,0.28)]">
      <SectionHeader icon={<BrainCircuit />} title="Memory Engineering MoE" subtitle="not just prompt injection" />
      <div className="mt-3 rounded-2xl border border-white/[0.06] bg-black/20 p-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#20e6ff]/62">engineering layer</p>
        <p className="mt-1 text-sm font-medium leading-6 text-white">
          进化不只是在提示词前面塞一句话；它应该把经验拆成记忆专家，再由 Router 决定本轮调用哪类工程记忆。
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {routedExperts.map((expert) => (
          <div key={expert.label} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
            <p className="text-[9px] uppercase tracking-[0.16em] text-white/25">{expert.label}</p>
            <p className={`mt-1 truncate text-sm font-semibold ${memoryToneClass(expert.tone)}`}>{expert.value}</p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/42">{expert.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2">
        <div className="rounded-2xl border border-[#8dffcc]/12 bg-[#8dffcc]/[0.045] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[9px] uppercase tracking-[0.16em] text-[#8dffcc]/62">retrieved memory</p>
            <p className="shrink-0 text-[9px] uppercase tracking-[0.14em] text-white/30">{memoryRoute ? 'real route' : 'local fallback'}</p>
          </div>
          <p className="mt-1 line-clamp-1 text-xs font-semibold text-white">{topMemory?.title ?? `${activeExpert} expert selected`}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/46">{topMemory?.body ?? '等待 /api/memory/route 返回可召回的工程记忆。'}</p>
        </div>
        {gepProof && (
          <div className="grid grid-cols-3 gap-2">
            <MobileStat label="GEP Genes" value={`${gepProof.genes}`} />
            <MobileStat label="Capsules" value={`${gepProof.capsules}`} />
            <MobileStat label="Events" value={`${gepProof.events}`} />
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {routePlan.map((step, index) => (
          <div key={`${step}:${index}`} className="min-w-0">
            <div className={`h-1.5 rounded-full ${index <= 1 ? 'bg-[#20e6ff]' : index === 2 ? 'bg-[#8dffcc]/75' : 'bg-white/[0.1]'}`} />
            <p className="mt-1 truncate text-[9px] uppercase tracking-[0.08em] text-white/34">{step}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HookBeacon({ event, status }: { event?: EvolutionTimelineItem; status: LiveStatus }) {
  const fresh = isHookFresh(event);
  return (
    <section className={`mt-4 overflow-hidden rounded-[26px] border p-4 transition duration-500 ${fresh ? 'evomate-hook-card border-white/[0.12] bg-white/[0.045]' : 'border-white/[0.08] bg-[#070b12]/88'}`}>
      <div className="flex items-center justify-between gap-3">
        <SectionHeader
          icon={<RadioTower />}
          title={fresh ? 'Hook Just Landed' : 'Web Hook Armed'}
          subtitle={event ? `${hookTitle(event)} · ${timeAgo(event.createdAt)}` : `waiting · ${status}`}
        />
        <span className={`h-3 w-3 rounded-full ${fresh ? 'animate-ping bg-[#20e6ff]' : event ? 'bg-[#20e6ff]' : status === 'live' ? 'bg-white/28' : 'bg-white/18'}`} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MobileStat label="Source" value={event ? hookSource(event) : 'browser'} />
        <MobileStat label="Kind" value={event ? hookKind(event) : 'ready'} />
        <MobileStat label="Effect" value={fresh ? 'bursting' : 'armed'} />
      </div>
    </section>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-white/58 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold tracking-[-0.04em] text-white">{title}</h2>
        <p className="truncate text-xs text-white/35">{subtitle}</p>
      </div>
    </div>
  );
}

function LiveBadge({ status }: { status: LiveStatus }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${status === 'live' ? 'border-[#8dffcc]/22 bg-[#8dffcc]/10 text-[#8dffcc]' : status === 'connecting' ? 'border-[#ffd36e]/22 bg-[#ffd36e]/10 text-[#ffd36e]' : 'border-[#ff8b8b]/22 bg-[#ff8b8b]/10 text-[#ffabab]'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'live' ? 'bg-[#8dffcc]' : status === 'connecting' ? 'bg-[#ffd36e]' : 'bg-[#ff8b8b]'}`} />
      {status}
    </span>
  );
}

function FeedbackLoopDock({
  expanded,
  onToggle,
  model
}: {
  expanded: boolean;
  onToggle: () => void;
  model: LiveModel;
}) {
  const quickPresets = feedbackPresets.slice(0, 3);
  const visiblePresets = expanded ? feedbackPresets : quickPresets;

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/[0.06] bg-[#03050a]/94 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 backdrop-blur-2xl">
      <div className="mx-auto max-w-[480px]">
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <button type="button" onClick={onToggle} className="min-w-0 text-left">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#8dffcc]/62">feedback loop</p>
            <p className="truncate text-[11px] text-white/34">
              {expanded ? '7维反馈 → reward/signals → GEP' : '点开记录速度/深度/风险/风格'}
            </p>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-white/[0.07] bg-white/[0.035] px-2.5 py-1 text-[10px] text-white/34">
              {model.busy ? 'syncing' : `${feedbackPresets.length} dims`}
            </span>
            <button type="button" onClick={onToggle} className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/52">
              {expanded ? '收起' : '更多'}
            </button>
          </div>
        </div>

        <div className={`grid gap-2 ${expanded ? 'grid-cols-2' : 'grid-cols-4'}`}>
          {visiblePresets.map((preset) => (
            <FeedbackPresetButton
              key={preset.id}
              preset={preset}
              compact={!expanded}
              busy={model.busy === 'feedback'}
              onClick={() => model.feedback(preset.kind, preset.text, preset.score, preset.signals)}
            />
          ))}
          <button
            onClick={() => model.train('preference_train')}
            disabled={model.busy === 'train'}
            className={`rounded-2xl border border-white/[0.1] bg-white/[0.055] px-3 py-2.5 text-left text-white/62 transition hover:border-white/[0.18] disabled:opacity-45 ${expanded ? 'col-span-2' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-medium">
                {model.busy === 'train' ? <RefreshCcw className="h-3.5 w-3.5 animate-spin text-[#8dffcc]" /> : <Play className="h-3.5 w-3.5" />}
                训练
              </span>
              {expanded && <span className="text-[10px] text-white/32">把反馈批量重放成策略</span>}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function FeedbackPresetButton({
  preset,
  compact,
  busy,
  onClick
}: {
  preset: FeedbackPreset;
  compact: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  const toneClass = preset.tone === 'positive'
    ? 'border-[#8dffcc]/18 bg-[#8dffcc]/[0.055] text-[#d8ffe9] hover:border-[#8dffcc]/30'
    : preset.tone === 'negative'
      ? 'border-[#ff8b8b]/14 bg-[#ff8b8b]/[0.04] text-[#ffd1d1] hover:border-[#ff8b8b]/26'
      : preset.tone === 'caution'
        ? 'border-[#ffd36e]/14 bg-[#ffd36e]/[0.045] text-[#ffe3a3] hover:border-[#ffd36e]/26'
        : 'border-white/[0.075] bg-white/[0.035] text-white/58 hover:border-white/[0.14]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`rounded-2xl border px-3 py-2 text-left transition disabled:opacity-45 ${toneClass}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">{preset.label}</span>
        {!compact && <span className="text-[10px] text-white/28">{Math.round(preset.score * 100)}</span>}
      </div>
      {!compact && <p className="mt-1 truncate text-[10px] text-white/34">{preset.caption}</p>}
    </button>
  );
}

function MobileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.06] bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">{label}</p>
      <p className="mt-1 truncate text-xs font-medium text-white/62">{value}</p>
    </div>
  );
}

function PulseOrb({ yesness, status, eventKey }: { yesness: number; status: LiveStatus; eventKey?: string }) {
  return (
    <div
      key={eventKey}
      className="relative h-16 w-16 shrink-0"
      style={{ '--evomate-yes-angle': `${Math.round(clamp(yesness, 0, 1) * 360)}deg` } as CSSProperties}
    >
      <div className="absolute inset-[-4px] rounded-full evomate-pulse-impact" />
      <div className={`absolute inset-0 rounded-full border ${status === 'offline' ? 'border-[#ff8b8b]/22' : 'border-[#8dffcc]/30'} evomate-pulse-ring`} />
      <div className="absolute inset-[11%] rounded-full border border-[#8dffcc]/12 bg-[#8dffcc]/[0.025]" />
      <div className="absolute inset-[25%] rounded-full bg-[#8dffcc]/[0.035]" />
      <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-[#8dffcc]/90 shadow-[0_0_10px_rgba(141,255,204,0.5)] evomate-pulse-dot" />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-semibold tracking-[-0.06em] text-[#d8ffe9]">{pct(yesness)}</span>
        <span className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-[#8dffcc]/58">yes</span>
      </div>
    </div>
  );
}

function ConsoleBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(76,96,132,0.18),transparent_34%),radial-gradient(circle_at_92%_8%,rgba(64,80,112,0.12),transparent_30%),linear-gradient(180deg,#03050a_0%,#05070d_55%,#020307_100%)]" />
      <div className="grid-bg absolute inset-0 opacity-[0.12]" />
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
    </div>
  );
}


function stageState(stage: PipelineStage, timeline: EvolutionTimelineItem[]): 'idle' | 'done' | 'active' {
  const latestType = timeline[0]?.type;
  if (latestType && stage.types.includes(latestType)) return 'active';
  return timeline.some((item) => stage.types.includes(item.type)) ? 'done' : 'idle';
}

function stageEvent(stage: PipelineStage, timeline: EvolutionTimelineItem[]) {
  return timeline.find((item) => stage.types.includes(item.type));
}

function stageReadableDetail(
  key: string,
  derived: ReturnType<typeof useDerivedState>,
  event?: EvolutionTimelineItem
) {
  switch (key) {
    case 'hook':
      return {
        label: 'captured input',
        primary: event ? hookExcerpt(event) : '等待 Codex / Browser / Mobile hook。',
        secondary: event ? `来源：${hookSource(event)}；事件：${hookKind(event)}。` : '收到用户/工具事件后，会作为本轮进化的起点。'
      };
    case 'semantic':
      return {
        label: 'semantic parse',
        primary: event ? event.summary : '等待解析 task / intent / risk / permission。',
        secondary: '把自然语言转成稳定字段，避免每次 JSON 语义输出漂移。'
      };
    case 'vote':
      return {
        label: 'gene election',
        primary: event ? event.summary : `当前候选：${derived.activeGene.name}`,
        secondary: 'Condorcet / Tournament 两两对决，综合 bandit、reward、policy、memory 票。'
      };
    case 'inject':
      return {
        label: 'advisor injection',
        primary: event ? event.summary : derived.activeGene.action,
        secondary: `选中行为：${derived.activeGene.name}。这层只注入建议，不阻塞 Codex 原流程。`
      };
    case 'gep':
      return {
        label: 'evolution memory',
        primary: event ? event.summary : '等待用户反馈/outcome 写入 GEP 资产。',
        secondary: '反馈会沉淀成 EvolutionEvent / Mutation，后续训练继续利用。'
      };
    case 'train':
      return {
        label: 'training loop',
        primary: event ? event.summary : (derived.latestJobStatus ? `最新训练任务：${derived.latestJobStatus}` : '等待 /train 或反馈触发训练。'),
        secondary: `Memory index: ${derived.embeddingStatus}; Policy: ${derived.latestJobStatus || 'ready'}。`
      };
    default:
      return {
        label: 'detail',
        primary: event?.summary || '暂无回执。',
        secondary: '等待下一次状态更新。'
      };
  }
}

function isHookEvent(event?: EvolutionTimelineItem): event is EvolutionTimelineItem {
  return Boolean(event && ['hook_received', 'omni_hook_received'].includes(event.type));
}

function isHookFresh(event?: EvolutionTimelineItem, windowMs = 30000) {
  if (!isHookEvent(event)) return false;
  const time = new Date(event.createdAt).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time < windowMs;
}

function isLocalActivityEvent(event?: EvolutionTimelineItem) {
  const text = `${event?.summary || ''} ${(event?.signals || []).join(' ')}`.toLowerCase();
  return /local-agent|terminal:zsh|terminal_command|git_activity|active_window|channel_desktop|local_agent/.test(text);
}

function pickActiveMemoryExpert(event?: EvolutionTimelineItem) {
  const text = `${event?.type || ''} ${event?.summary || ''} ${(event?.signals || []).join(' ')}`.toLowerCase();
  if (/command|validation|failed|tool_result/.test(text)) return 'validation';
  if (/gep|capsule|mutation|remote_job_imported/.test(text)) return 'procedural';
  if (/hook|browser|mobile|codex|claude|gemini/.test(text)) return 'episodic';
  if (/tournament|gene|policy|reward/.test(text)) return 'policy';
  return 'memory';
}

function memoryToneClass(tone: string) {
  if (tone === 'mint') return 'text-[#8dffcc]';
  if (tone === 'amber') return 'text-[#ffd166]';
  return 'text-[#20e6ff]';
}

function hookTitle(event: EvolutionTimelineItem) {
  return `${hookSource(event)} · ${hookKind(event)}`;
}

function hookSource(event: EvolutionTimelineItem) {
  const leadingRoute = event.summary.match(/^([a-z0-9_-]+):([a-z0-9_-]+)/i);
  const fromMatch = event.summary.match(/from\s+([^\s]+)/i);
  const source = fromMatch?.[1] || leadingRoute?.[1] || event.signals?.find((signal) => signal.startsWith('channel_')) || 'hook';
  return source
    .replace(/^browser-extension:/, '')
    .replace(/^local-agent:/, 'local ')
    .replace(/^channel_/, '')
    .replace(/[_:]/g, ' ');
}

function hookKind(event: EvolutionTimelineItem) {
  const leadingRoute = event.summary.match(/^[a-z0-9_-]+:([a-z0-9_-]+)/i);
  const summaryMatch = event.summary.match(/(?:browser-extension|coding-agent|mobile-chat|web-chat|codex):([^\s·]+)/i);
  const signalMatch = event.signals?.find((signal) => signal.startsWith('hook_'))?.replace(/^hook_/, '');
  return (leadingRoute?.[1] || summaryMatch?.[1] || signalMatch || event.type).replace(/_/g, ' ');
}

function hookExcerpt(event: EvolutionTimelineItem) {
  const quoted = event.summary.match(/·\s*"([^"]+)"/)?.[1];
  if (quoted) return quoted;
  return event.summary.replace(/^.*?·\s*/, '').trim();
}

function hookDisplay(event: EvolutionTimelineItem | undefined, status: LiveStatus) {
  if (!event) {
    return {
      title: 'Waiting for signal',
      subtitle: `No hook yet · ${status}`,
      compactMeta: status,
      channel: 'standby',
      kindLabel: 'next signal',
      preview: '等待 Codex、浏览器或手机端写入 hook，收到后这里会显示来源和内容摘要。'
    };
  }

  const source = hookSource(event);
  const kind = normalizeHookKind(hookKind(event), event);
  const url = extractHookUrl(event);
  const brand = inferHookBrand(source, url);
  const channel = source === brand.toLowerCase() ? source : source;
  const preview = url ? compactUrl(url) : hookExcerpt(event);

  return {
    title: brand,
    subtitle: `${kind} · ${timeAgo(event.createdAt)}`,
    compactMeta: `${compactHookKind(kind)} · ${timeAgo(event.createdAt)}`,
    channel,
    kindLabel: url ? 'captured link' : 'captured content',
    preview
  };
}

function compactHookKind(kind: string) {
  const normalized = kind.toLowerCase();
  if (normalized.includes('assistant')) return 'assistant';
  if (normalized.includes('user')) return 'user';
  if (normalized.includes('thread')) return 'thread';
  if (normalized.includes('message')) return 'message';
  if (normalized.includes('tool')) return 'tool';
  return kind.split(/\s+/).slice(0, 2).join(' ');
}

function normalizeHookKind(kind: string, event: EvolutionTimelineItem) {
  const normalized = kind.trim().toLowerCase();
  if (!normalized || normalized === 'unknown' || normalized === 'hook received') {
    return extractHookUrl(event) ? 'thread captured' : 'message captured';
  }
  return kind;
}

function inferHookBrand(source: string, url: string | null) {
  const host = url ? safeHost(url) : '';
  if (host.includes('doubao.com')) return 'Doubao';
  if (host.includes('chatgpt.com')) return 'ChatGPT';
  if (host.includes('claude.ai')) return 'Claude';
  if (host.includes('gemini.google.com')) return 'Gemini';
  if (source.includes('gemini')) return 'Gemini';
  if (source.includes('chatgpt')) return 'ChatGPT';
  if (source.includes('claude')) return 'Claude';
  if (source.includes('local') || source.includes('terminal') || source.includes('git') || source.includes('active window') || source.includes('desktop')) return 'Local Activity';
  if (source.includes('codex')) return 'Codex';
  if (source.includes('mobile')) return 'Mobile Chat';
  if (source.includes('browser')) return 'Browser';
  return titleCase(source);
}

function extractHookUrl(event: EvolutionTimelineItem) {
  const match = event.summary.match(/https?:\/\/[^\s"]+/i) ?? hookExcerpt(event).match(/https?:\/\/[^\s"]+/i);
  return match?.[0] ?? null;
}

function compactUrl(url: string) {
  try {
    const parsed = new URL(url);
    const cleanPath = parsed.pathname.replace(/\/$/, '');
    const last = cleanPath.split('/').filter(Boolean).pop() ?? '';
    const shortLast = last.length > 18 ? `${last.slice(0, 8)}…${last.slice(-6)}` : last;
    const pathPrefix = cleanPath.split('/').filter(Boolean).slice(0, -1).join('/');
    return `${parsed.hostname}${pathPrefix ? `/${pathPrefix}` : ''}${shortLast ? `/${shortLast}` : ''}`;
  } catch {
    return url.length > 52 ? `${url.slice(0, 34)}…${url.slice(-12)}` : url;
  }
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function trainingSubtitle(receipt: TrainResponse | null, fallback?: string) {
  if (receipt?.job) return `${receipt.action || 'train'} · ${receipt.job.type} · ${receipt.job.status}`;
  return fallback ? `latest job · ${fallback}` : 'feedback → GEP → policy update';
}

function apiLabel() {
  if (API_URL.includes('127.0.0.1') || API_URL.includes('localhost')) return 'Local API';
  if (API_URL === HOSTED_API_URL) return 'Server API';
  return `Custom API · ${safeHost(API_URL) || 'configured'}`;
}

function compactType(type: string) {
  return type.replace(/_/g, ' ');
}

function yesMode(value: number) {
  if (value >= 0.78) return 'Confident Yes';
  if (value >= 0.56) return 'Adaptive Yes';
  if (value >= 0.38) return 'Cautious Yes';
  return 'Repair Yes';
}

function pct(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function extractPercent(summary?: string) {
  const match = summary?.match(/yesness=(\d+(?:\.\d+)?)%/i);
  if (!match) return undefined;
  return Number(match[1]) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatClock(input?: string) {
  if (!input) return 'now';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return 'now';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function timeAgo(input?: string) {
  if (!input) return 'waiting';
  const time = new Date(input).getTime();
  if (Number.isNaN(time)) return 'now';
  const diff = Math.max(0, Date.now() - time);
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return formatClock(input);
}
