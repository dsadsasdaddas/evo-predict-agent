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
  ShieldAlert,
  Smartphone,
  ThumbsDown,
  ThumbsUp,
  Zap
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, CLOUD_API_URL, fetchEvolutionHistory, fetchEvolutionState, queueTraining, sendFeedback } from '@/lib/evomate-api';
import type {
  EvolutionHistory,
  EvolutionState,
  EvolutionTimelineItem,
  FeedbackKind,
  LiveStatus,
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
  status: LiveStatus;
  lastError: string | null;
  lastUpdatedAt: string | null;
  refresh: () => Promise<void>;
  feedback: (kind: FeedbackKind, text?: string, score?: number) => Promise<void>;
  train: (type?: 'preference_train' | 'policy_replay_eval' | 'evolution_gym_eval' | 'embedding_build') => Promise<void>;
  busy: 'feedback' | 'train' | null;
  trainReceipt: TrainResponse | null;
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

export function MobileObserver() {
  const model = useEvoMateLive();
  const derived = useDerivedState(model.state, model.history);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#03050a] text-white">
      <ConsoleBackground />
      <HookImpactFx event={derived.latestHook} />
      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-[480px] flex-col px-4 pb-28 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[#20e6ff]/25 bg-[#20e6ff]/10">
              <Smartphone className="h-4 w-4 text-[#20e6ff]" />
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

        <section className="mt-4 overflow-hidden rounded-[30px] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[#20e6ff]/75">yes pulse</p>
              <h1 className="mt-2 text-6xl font-semibold leading-none tracking-[-0.09em] text-white">{pct(derived.yesness)}</h1>
              <p className="mt-2 text-sm text-white/48">{derived.activeGene.name} · {yesMode(derived.yesness)}</p>
            </div>
            <PulseOrb yesness={derived.yesness} status={model.status} eventKey={derived.latest?.id} />
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#20e6ff] to-[#8dffcc] transition-all duration-500"
              style={{ width: `${Math.max(8, derived.yesness * 100)}%` }}
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
              return (
                <div key={stage.key} className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition duration-500 ${stage.key === 'hook' && isHookFresh(derived.latestHook) ? 'evomate-hook-card border-[#8dffcc]/35 bg-[#8dffcc]/[0.09]' : 'border-white/[0.07] bg-white/[0.03]'}`}>
                  <span className={`flex h-7 w-7 items-center justify-center rounded-xl border ${state === 'active' ? 'border-[#8dffcc]/35 bg-[#8dffcc]/12 text-[#8dffcc]' : state === 'done' ? 'border-[#20e6ff]/24 bg-[#20e6ff]/10 text-[#20e6ff]' : 'border-white/10 bg-white/[0.03] text-white/30'} [&>svg]:h-3.5 [&>svg]:w-3.5`}>
                    {stage.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{stage.title}</p>
                    <p className="truncate text-xs text-white/35">{stage.detail}</p>
                  </div>
                  <span className="text-xs text-white/35">{state === 'active' ? 'now' : state === 'done' ? 'done' : 'wait'}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-4 rounded-[26px] border border-white/[0.08] bg-[#070b12]/88 p-4">
          <SectionHeader icon={<History />} title="Live Log" subtitle={`${derived.timeline.length} events`} />
          <div className="mt-4 space-y-2">
            {derived.timeline.length ? derived.timeline.slice(0, 6).map((item) => (
              <div key={item.id} className={`rounded-2xl border p-3 transition duration-500 ${isHookEvent(item) ? 'border-[#8dffcc]/25 bg-[#8dffcc]/[0.055] shadow-[0_0_28px_rgba(141,255,204,0.08)]' : 'border-white/[0.06] bg-black/20'}`}>
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

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/[0.08] bg-[#03050a]/88 px-4 py-3 backdrop-blur-2xl">
          <div className="mx-auto grid max-w-[480px] grid-cols-4 gap-2">
            <MobileFeedbackButton label="有用" icon={<ThumbsUp />} onClick={() => model.feedback('accepted', '手机端反馈：这次很有用。')} busy={model.busy === 'feedback'} />
            <MobileFeedbackButton label="没用" icon={<ThumbsDown />} onClick={() => model.feedback('corrected', '手机端反馈：这次没有命中我的意图。')} busy={model.busy === 'feedback'} />
            <MobileFeedbackButton label="太保守" icon={<ShieldAlert />} onClick={() => model.feedback('interrupted', '手机端反馈：这次太保守，需要更快推进。')} busy={model.busy === 'feedback'} />
            <MobileFeedbackButton label="训练" icon={<Play />} onClick={() => model.train('preference_train')} busy={model.busy === 'train'} />
          </div>
        </div>
      </section>
    </main>
  );
}

function useEvoMateLive(): LiveModel {
  const [state, setState] = useState<EvolutionState | null>(null);
  const [history, setHistory] = useState<EvolutionHistory | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<LiveModel['busy']>(null);
  const [trainReceipt, setTrainReceipt] = useState<TrainResponse | null>(null);
  const stateStamp = useRef('');

  const refresh = useCallback(async () => {
    try {
      const [nextState, nextHistory] = await Promise.all([
        fetchEvolutionState(),
        fetchEvolutionHistory(24, true)
      ]);
      const latest = nextState.timeline?.[0];
      const stamp = [nextState.generation, nextState.phase, latest?.id, latest?.createdAt, nextState.metrics?.yesnessScore].join(':');
      setState(nextState);
      setHistory(nextHistory);
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

  const feedback = useCallback(async (kind: FeedbackKind, text?: string, score?: number) => {
    const latestGene = state?.timeline?.find((item) => item.geneId)?.geneId;
    const latestSignals = state?.timeline?.find((item) => item.signals?.length)?.signals;
    setBusy('feedback');
    try {
      const result = await sendFeedback({ kind, text, score, geneId: latestGene, signals: latestSignals });
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

  return { state, history, status, lastError, lastUpdatedAt, refresh, feedback, train, busy, trainReceipt };
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

function HookImpactFx({ event }: { event?: EvolutionTimelineItem }) {
  const [impact, setImpact] = useState<EvolutionTimelineItem | null>(null);
  const clearTimer = useRef<number | null>(null);

  const triggerImpact = useCallback((nextImpact: EvolutionTimelineItem) => {
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    setImpact(nextImpact);
    clearTimer.current = window.setTimeout(() => setImpact(null), 8000);
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

  return (
    <div key={impact.id} className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 evomate-hook-screen-flash" />
      <div className="absolute left-1/2 top-[42%] h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#8dffcc]/60 evomate-hook-shockwave" />
      <div className="absolute left-1/2 top-[42%] h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#20e6ff]/45 evomate-hook-shockwave-delayed" />
      {Array.from({ length: 14 }).map((_, index) => (
        <span
          key={index}
          className="absolute left-1/2 top-[42%] h-1.5 w-1.5 rounded-full bg-[#8dffcc] shadow-[0_0_18px_rgba(141,255,204,0.9)] evomate-hook-particle"
          style={{
            '--evomate-angle': `${index * 25.7}deg`,
            '--evomate-distance': `${88 + (index % 5) * 22}px`,
            animationDelay: `${index * 22}ms`
          } as CSSProperties}
        />
      ))}
      <div className="absolute inset-x-4 top-6 mx-auto max-w-[480px] rounded-[26px] border border-[#8dffcc]/35 bg-[#06130f]/85 p-4 shadow-[0_24px_120px_rgba(32,230,255,0.18)] backdrop-blur-2xl evomate-hook-toast">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#8dffcc]/30 bg-[#8dffcc]/12 text-[#8dffcc]">
            <RadioTower className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[#8dffcc]/75">hook captured</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{hookTitle(impact)}</p>
            <p className="mt-1 truncate text-xs text-white/45">{impact.summary}</p>
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
    <section className={`mt-4 overflow-hidden rounded-[28px] border p-4 transition duration-500 ${fresh ? 'evomate-hook-card border-[#8dffcc]/40 bg-[#8dffcc]/[0.075]' : 'border-[#20e6ff]/14 bg-[#07131d]/82'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] border ${fresh ? 'border-[#8dffcc]/32 bg-[#8dffcc]/12 text-[#8dffcc]' : 'border-[#20e6ff]/22 bg-[#20e6ff]/10 text-[#20e6ff]'}`}>
            <RadioTower className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.22em] text-[#20e6ff]/70">active source</span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.045] px-2.5 py-1 text-[10px] text-white/38">{display.channel}</span>
            </div>
            <h1 className="mt-2 truncate text-[28px] font-semibold leading-none tracking-[-0.075em] text-white">
              {display.title}
            </h1>
            <p className="mt-2 truncate text-sm text-white/42">{display.subtitle}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-[#8dffcc]/20 bg-[#8dffcc]/10 px-3 py-1.5 text-xs text-[#8dffcc]">{apiLabel()}</span>
          <button
            onClick={onRefresh}
            className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-white/45 transition hover:border-[#20e6ff]/30 hover:text-[#20e6ff]"
            aria-label="refresh"
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/28">{display.kindLabel}</p>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-white/62">{display.preview}</p>
      </div>
    </section>
  );
}

function HookBeacon({ event, status }: { event?: EvolutionTimelineItem; status: LiveStatus }) {
  const fresh = isHookFresh(event);
  return (
    <section className={`mt-4 overflow-hidden rounded-[26px] border p-4 transition duration-500 ${fresh ? 'evomate-hook-card border-[#8dffcc]/35 bg-[#8dffcc]/[0.075]' : 'border-white/[0.08] bg-[#070b12]/88'}`}>
      <div className="flex items-center justify-between gap-3">
        <SectionHeader
          icon={<RadioTower />}
          title={fresh ? 'Hook Just Landed' : 'Web Hook Armed'}
          subtitle={event ? `${hookTitle(event)} · ${timeAgo(event.createdAt)}` : `waiting · ${status}`}
        />
        <span className={`h-3 w-3 rounded-full ${fresh ? 'animate-ping bg-[#8dffcc]' : status === 'live' ? 'bg-[#20e6ff]' : 'bg-white/20'}`} />
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
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#20e6ff]/18 bg-[#20e6ff]/[0.07] text-[#20e6ff] [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
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

function MobileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.06] bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">{label}</p>
      <p className="mt-1 truncate text-xs font-medium text-white/62">{value}</p>
    </div>
  );
}

function MobileFeedbackButton({ label, icon, busy, onClick }: { label: string; icon: ReactNode; busy?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-2 py-2.5 text-[11px] text-white/58 disabled:opacity-45 [&>svg]:h-4 [&>svg]:w-4">
      {busy ? <RefreshCcw className="animate-spin text-[#20e6ff]" /> : icon}
      {label}
    </button>
  );
}

function PulseOrb({ yesness, status, eventKey }: { yesness: number; status: LiveStatus; eventKey?: string }) {
  return (
    <div key={eventKey} className="relative h-20 w-20 shrink-0">
      <div className={`absolute inset-0 rounded-full border ${status === 'offline' ? 'border-[#ff8b8b]/25' : 'border-[#20e6ff]/35'} evomate-pulse-ring`} />
      <div className="absolute inset-[12%] rounded-full border border-[#8dffcc]/20 bg-[#8dffcc]/[0.04]" />
      <div className="absolute inset-[22%] rounded-full bg-gradient-to-br from-[#20e6ff]/22 to-[#8dffcc]/12 shadow-[0_0_60px_rgba(32,230,255,0.22)]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tracking-[-0.06em]">{pct(yesness)}</span>
        <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/38">yes</span>
      </div>
    </div>
  );
}

function ConsoleBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(32,230,255,0.16),transparent_32%),radial-gradient(circle_at_92%_8%,rgba(141,255,204,0.12),transparent_30%),linear-gradient(180deg,#03050a_0%,#05070d_55%,#020307_100%)]" />
      <div className="grid-bg absolute inset-0 opacity-[0.18]" />
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-[#20e6ff]/60 to-transparent" />
    </div>
  );
}


function stageState(stage: PipelineStage, timeline: EvolutionTimelineItem[]): 'idle' | 'done' | 'active' {
  const latestType = timeline[0]?.type;
  if (latestType && stage.types.includes(latestType)) return 'active';
  return timeline.some((item) => stage.types.includes(item.type)) ? 'done' : 'idle';
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

function hookTitle(event: EvolutionTimelineItem) {
  return `${hookSource(event)} · ${hookKind(event)}`;
}

function hookSource(event: EvolutionTimelineItem) {
  const leadingRoute = event.summary.match(/^([a-z0-9_-]+):([a-z0-9_-]+)/i);
  const fromMatch = event.summary.match(/from\s+([^\s]+)/i);
  const source = leadingRoute?.[1] || fromMatch?.[1] || event.signals?.find((signal) => signal.startsWith('channel_')) || 'hook';
  return source.replace(/^browser-extension:/, '').replace(/^channel_/, '').replace(/_/g, ' ');
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
    channel,
    kindLabel: url ? 'captured link' : 'captured content',
    preview
  };
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
  return API_URL.includes('run.app') ? 'Cloud API' : `Local→Cloud ${new URL(CLOUD_API_URL).host.split('.')[0]}`;
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
