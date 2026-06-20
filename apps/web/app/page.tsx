'use client';

import { motion } from 'framer-motion';
import {
  Activity,
  BadgeCheck,
  Bot,
  Check,
  ChevronRight,
  CircuitBoard,
  ClipboardList,
  Copy,
  Cpu,
  Dna,
  GitBranch,
  Layers3,
  Network,
  PlugZap,
  RadioTower,
  RefreshCcw,
  ShieldCheck,
  TerminalSquare,
  ThumbsDown,
  ThumbsUp,
  Zap
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

type SourceMode = 'api' | 'demo';

type ShellMode = 'web' | 'electron' | 'codex';

type AnalyzeResult = {
  geneId: string;
  yesness: number;
  previousYesness: number;
  signals: string[];
  taskType: string;
  riskLevel: string;
  semantic: SemanticResult;
  source: SourceMode;
  llmUsed: boolean;
  llmIntent: string;
  llmConfidence: number | null;
};

type SemanticResult = {
  taskType: string;
  intent: string;
  riskLevel: string;
  permissionMode: string;
  userTone: string;
  workstyleSignals: string[];
  domainSignals: string[];
  toolNeeds: string[];
  feedbackSemantics: {
    sentiment: string;
    correctionType?: string;
    rewardHint: number;
  } | null;
  signals: string[];
  confidence: number;
};

type RewardResult = {
  value: number;
  yesness: number;
  source: SourceMode;
};

type RemoteJob = {
  jobId: string;
  type: string;
  status: string;
  objective: string;
  createdAt: string;
  updatedAt: string;
  artifactSummary?: {
    generatedFiles?: string[];
    validationScore?: number;
    suggestedMutationCount?: number;
    evolutionBundleId?: string;
  };
  target?: { host?: string; port?: number; user?: string; executeRemote?: boolean };
  remotePlan?: { bootstrap?: string[]; sync?: string[]; submit?: string[]; import?: string[] };
};

type GepAsset = {
  type: string;
  id: string;
  asset_id?: string;
};

type GeneTuple = [label: string, id: string, score: number, body: string, mode: string, inject: string];

type LiveStatus = 'connecting' | 'live' | 'offline';

type FlowStage = {
  icon: ReactNode;
  label: string;
  title: string;
  detail: string;
  tone: 'cyan' | 'mint' | 'red';
};

type EvolutionTimelineItem = {
  id: string;
  type: string;
  summary: string;
  score: number;
  createdAt: string;
  geneId?: string;
  signals?: string[];
};

type EvolutionState = {
  generation?: number;
  phase?: string;
  understandingScore?: number;
  metrics?: {
    yesnessScore?: number;
    averageReward?: number;
  };
  timeline?: EvolutionTimelineItem[];
};

const API_URL = process.env.NEXT_PUBLIC_EVOMATE_API_URL || 'http://localhost:8787';
const starterEvent = 'Codex session: 用户让我看这个仓库，强调“先别乱动代码”，目标是接入 EvoMap/GEP 和机器学习。';

const genes: GeneTuple[] = [
  ['Safe Yes', 'gene_ask_before_execution', 0.86, '先分析、确认权限，再允许 Codex/Claude Code 执行高风险动作。', 'Guarded execution', 'Inject: analyze first, no file edits until explicit confirmation.'],
  ['Fast Yes', 'gene_concise_direct_answer', 0.78, '用户要快速推进时，压缩解释，直接给下一步和可执行操作。', 'Low-friction progress', 'Inject: answer in concise execution-first bullets.'],
  ['Architect Yes', 'gene_mcp_first_architecture', 0.88, '把 MCP、EvoMap 和 worker 分层讲清楚，再让执行工具按架构落地。', 'System design', 'Inject: show architecture before implementation.'],
  ['Research Yes', 'gene_deep_research_first', 0.72, '遇到外部产品或不确定事实，先查证，再给结论。', 'Evidence first', 'Inject: verify sources before deciding.'],
  ['Visual Yes', 'gene_visualize_first', 0.76, '路演和复杂架构优先可视化，让进化过程一眼可懂。', 'Visual explanation', 'Inject: produce diagram/dashboard first.'],
  ['Policy Yes', 'gene_yes_engineer_policy', 0.8, '根据反馈在线学习这个用户的协作偏好，并写成 GEP 资产。', 'Adaptive behavior', 'Inject: choose behavior through policy engine.']
];

const defaultResult: AnalyzeResult = {
  geneId: 'gene_ask_before_execution',
  yesness: 0.864,
  previousYesness: 0.841,
  signals: ['coding_task', 'permission_sensitive', 'evomap_integration', 'ml_policy'],
  taskType: 'coding',
  riskLevel: 'medium',
  semantic: {
    taskType: 'coding',
    intent: 'analysis_before_execution',
    riskLevel: 'medium',
    permissionMode: 'ask_before_editing',
    userTone: 'cautious',
    workstyleSignals: ['prefers_analysis_before_execution'],
    domainSignals: ['evomap', 'ml_policy'],
    toolNeeds: ['repo_inspection', 'mcp_host_integration'],
    feedbackSemantics: null,
    signals: ['coding_task', 'permission_sensitive', 'evomap_integration', 'ml_policy'],
    confidence: 0.76
  },
  source: 'demo',
  llmUsed: false,
  llmIntent: 'analysis_before_execution',
  llmConfidence: 0.76
};

const defaultAssets: GepAsset[] = [
  { type: 'Mutation', id: 'mut_pending_policy_weight_delta' },
  { type: 'EvolutionEvent', id: 'evt_pending_agent_feedback' },
  { type: 'Capsule', id: 'waiting_for_3_successful_rewards' }
];

export default function Page() {
  const [eventText, setEventText] = useState(starterEvent);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<AnalyzeResult>(defaultResult);
  const [reward, setReward] = useState<RewardResult | null>(null);
  const [assets, setAssets] = useState<GepAsset[]>(defaultAssets);
  const [remoteJob, setRemoteJob] = useState<RemoteJob | null>(null);
  const [remoteJobs, setRemoteJobs] = useState<RemoteJob[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [lastLiveEventAt, setLastLiveEventAt] = useState<string | null>(null);
  const [shellMode, setShellMode] = useState<ShellMode>('web');
  const [timeline, setTimeline] = useState([
    'Codex session observed: user requested read-only repo analysis.',
    'Policy selected Safe Yes before agent execution.',
    'Next feedback will write Mutation + EvolutionEvent into GEP.'
  ]);
  const lastStateStamp = useRef('');

  const activeGene = useMemo(() => genes.find((gene) => gene[1] === result.geneId) ?? genes[0], [result.geneId]);
  const delta = result.yesness - result.previousYesness;
  const flowPulseKey = lastLiveEventAt ?? timeline[0] ?? result.geneId;
  const isCodexShell = shellMode === 'codex';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shell = params.get('shell');
    setShellMode(shell === 'electron' || shell === 'codex' ? shell : 'web');
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollEvolutionState() {
      try {
        const res = await fetch(`${API_URL}/api/evolution/state`, { cache: 'no-store' });
        if (!res.ok) throw new Error('state api unavailable');
        const state = await res.json() as EvolutionState;
        if (cancelled) return;

        setLiveStatus('live');
        const latest = state.timeline?.[0];
        const stamp = [
          state.generation ?? 'gen',
          latest?.id ?? 'no-event',
          state.metrics?.yesnessScore ?? 'no-score',
          state.phase ?? 'phase'
        ].join(':');

        if (stamp !== lastStateStamp.current) {
          lastStateStamp.current = stamp;
          applyLiveEvolutionState(state);
        }
      } catch {
        if (!cancelled) setLiveStatus('offline');
      }
    }

    pollEvolutionState();
    const timer = window.setInterval(pollEvolutionState, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function observeEvent() {
    setLoading(true);
    setReward(null);
    const previousYesness = result.yesness;
    try {
      const res = await fetch(`${API_URL}/api/interactions/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: eventText })
      });
      if (!res.ok) throw new Error('api unavailable');
      const data = await res.json();
      const semantic = normalizeSemantic(data.semantic ?? data.signal?.semantic, {
        signals: data.signal?.signals || [],
        taskType: data.signal?.taskType || 'general',
        riskLevel: data.signal?.riskLevel || 'low'
      });
      const next: AnalyzeResult = {
        geneId: data.gene?.id || data.policyDecision?.selectedGene?.id || 'gene_ask_before_execution',
        yesness: data.policyDecision?.predictedYesness || data.predictedSatisfaction || 0.82,
        previousYesness,
        signals: data.signal?.signals || semantic.signals,
        taskType: data.signal?.taskType || semantic.taskType,
        riskLevel: data.signal?.riskLevel || semantic.riskLevel,
        semantic,
        source: 'api',
        llmUsed: Boolean(data.signalExtraction?.llm?.used),
        llmIntent: data.signalExtraction?.llm?.intent || semantic.intent,
        llmConfidence: typeof data.signalExtraction?.llm?.confidence === 'number' ? data.signalExtraction.llm.confidence : semantic.confidence
      };
      setResult(next);
      addTimeline(`Observed ${next.taskType} event → selected ${next.geneId}.`);
    } catch {
      const next = mockAnalyze(eventText, previousYesness);
      setResult(next);
      addTimeline(`Demo observer selected ${next.geneId}.`);
    } finally {
      setLoading(false);
    }
  }

  async function submitRemoteJob() {
    setRemoteLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/remote-jobs/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'evolution_gym_eval',
          objective: 'Full remote evolution prototype: evaluate behavior policy, produce ValidationReport and EvolutionBundle.',
          source: 'control_plane',
          executeRemote: false
        })
      });
      if (!res.ok) throw new Error('remote job api unavailable');
      const data = await res.json();
      setRemoteJob(data.job);
      setRemoteJobs((current) => [data.job, ...current.filter((job) => job.jobId !== data.job.jobId)].slice(0, 4));
      addTimeline(`Remote job ${data.job.jobId} queued in ${data.mode} mode.`);
    } catch {
      const mock = mockRemoteJob();
      setRemoteJob(mock);
      setRemoteJobs((current) => [mock, ...current].slice(0, 4));
      addTimeline('Demo remote compute job queued locally.');
    } finally {
      setRemoteLoading(false);
    }
  }

  async function importRemoteArtifacts() {
    if (!remoteJob) return;
    setRemoteLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/remote-jobs/${encodeURIComponent(remoteJob.jobId)}/import`, { method: 'POST' });
      if (!res.ok) throw new Error('remote import unavailable');
      const data = await res.json();
      setRemoteJob(data.job);
      setRemoteJobs((current) => [data.job, ...current.filter((job) => job.jobId !== data.job.jobId)].slice(0, 4));
      const artifactAssets = remoteArtifactsToAssets(data.artifacts);
      if (artifactAssets.length) setAssets(artifactAssets);
      addTimeline(`Imported ${data.job.artifactSummary?.evolutionBundleId || data.job.jobId} from remote compute.`);
    } catch {
      const imported = {
        ...remoteJob,
        status: 'imported',
        artifactSummary: {
          generatedFiles: ['policy_eval.json', 'validation_report.json', 'suggested_mutations.json', 'evolution_bundle.json'],
          validationScore: 0.78,
          suggestedMutationCount: 2,
          evolutionBundleId: `bundle_${remoteJob.jobId}`
        }
      };
      setRemoteJob(imported);
      setAssets([
        { type: 'ValidationReport', id: `val_${remoteJob.jobId}`, asset_id: 'remote:prototype' },
        { type: 'Mutation', id: `mut_${remoteJob.jobId}_policy`, asset_id: 'remote:prototype' },
        { type: 'EvolutionBundle', id: `bundle_${remoteJob.jobId}`, asset_id: 'remote:prototype' }
      ]);
      addTimeline(`Demo imported EvolutionBundle for ${remoteJob.jobId}.`);
    } finally {
      setRemoteLoading(false);
    }
  }

  async function refreshRemoteJobs() {
    setRemoteLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/remote-jobs`);
      if (!res.ok) throw new Error('remote list unavailable');
      const data = await res.json();
      setRemoteJobs(data.jobs || []);
      if (!remoteJob && data.jobs?.[0]) setRemoteJob(data.jobs[0]);
      addTimeline(`Remote queue refreshed: ${data.jobs?.length || 0} job(s).`);
    } catch {
      addTimeline('Remote queue refresh fell back to local demo state.');
    } finally {
      setRemoteLoading(false);
    }
  }

  async function recordFeedback(kind: 'accepted' | 'corrected' | 'interrupted') {
    const feedbackText = kind === 'accepted'
      ? '用户继续推进，说明这次行为策略命中。'
      : kind === 'corrected'
        ? '用户纠正：不是这个意思，需要调整协作方式。'
        : '用户打断：Agent 行为摩擦过高，需要降权。';

    try {
      const res = await fetch(`${API_URL}/api/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          text: feedbackText,
          geneId: result.geneId,
          signals: result.signals
        })
      });
      if (!res.ok) throw new Error('api unavailable');
      const data = await res.json();
      const nextReward: RewardResult = { value: data.reward.reward, yesness: data.reward.yesness, source: 'api' };
      setReward(nextReward);
      setResult((current) => ({
        ...current,
        previousYesness: current.yesness,
        yesness: data.state?.metrics?.yesnessScore ?? data.reward.yesness,
        source: 'api'
      }));
      setAssets(data.gepAssets?.written?.length ? data.gepAssets.written : defaultAssets);
      addTimeline(`Feedback ${kind} → GEP wrote ${data.gepAssets?.written?.map((asset: GepAsset) => asset.type).join(' + ') || 'assets'}.`);
    } catch {
      const value = kind === 'accepted' ? 0.92 : kind === 'corrected' ? -0.45 : -0.76;
      const nextReward: RewardResult = { value, yesness: (value + 1) / 2, source: 'demo' };
      setReward(nextReward);
      setResult((current) => ({ ...current, previousYesness: current.yesness, yesness: clamp(current.yesness * 0.76 + nextReward.yesness * 0.24, 0.06, 0.98), source: 'demo' }));
      setAssets([
        { type: 'Mutation', id: `mut_demo_${kind}_policy_delta`, asset_id: 'sha256:demo' },
        { type: 'EvolutionEvent', id: `evt_demo_${kind}_agent_feedback`, asset_id: 'sha256:demo' }
      ]);
      addTimeline(`Demo feedback ${kind} updated behavior genome.`);
    }
  }

  function addTimeline(text: string) {
    setTimeline((current) => [text, ...current].slice(0, 6));
  }

  function applyLiveEvolutionState(state: EvolutionState) {
    const timelineItems = state.timeline ?? [];
    const latest = timelineItems[0];
    const latestGeneEvent = timelineItems.find((item) => item.geneId);
    const liveTimeline = formatLiveTimeline(timelineItems);

    if (liveTimeline.length) setTimeline(liveTimeline);
    if (latest?.createdAt) setLastLiveEventAt(latest.createdAt);

    setResult((current) => {
      const signals = latestGeneEvent?.signals?.length ? latestGeneEvent.signals : current.signals;
      const taskType = inferTaskType(signals, current.taskType);
      const riskLevel = inferRiskLevel(signals, current.riskLevel);
      const nextYesness = typeof latestGeneEvent?.score === 'number'
        ? clamp(latestGeneEvent.score, 0.02, 0.98)
        : typeof state.metrics?.yesnessScore === 'number'
          ? clamp(state.metrics.yesnessScore, 0.02, 0.98)
          : current.yesness;

      return {
        ...current,
        geneId: latestGeneEvent?.geneId ?? current.geneId,
        previousYesness: current.yesness,
        yesness: nextYesness,
        signals,
        taskType,
        riskLevel,
        source: 'api',
        semantic: {
          ...current.semantic,
          taskType,
          riskLevel,
          signals,
          intent: inferIntentFromTimeline(latest, current.semantic.intent)
        }
      };
    });
  }

  async function copyEvent() {
    await navigator.clipboard.writeText(eventText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  }

  const heroProps = {
    result,
    activeGene,
    assets,
    reward,
    delta,
    timeline,
    liveStatus,
    lastLiveEventAt,
    flowPulseKey
  };

  if (isCodexShell) {
    return (
      <main className="min-h-screen overflow-hidden bg-black text-white">
        <SubtleBackground />
        <TopRail source={result.source} liveStatus={liveStatus} lastLiveEventAt={lastLiveEventAt} shellMode={shellMode} />

        <section className="relative z-10 mx-auto max-w-[860px] px-4 pb-8 pt-4">
          <CodexReviewHeader liveStatus={liveStatus} lastLiveEventAt={lastLiveEventAt} />
          <div className="mt-4 flex min-w-0 flex-col gap-4">
            <EvoMapProofHero {...heroProps} />
            <LiveProofDock {...heroProps} />
            <RuntimePipeline result={result} activeGene={activeGene} assets={assets} />
            <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <AgentSessionCard
                eventText={eventText}
                setEventText={setEventText}
                copied={copied}
                copyEvent={copyEvent}
                loading={loading}
                observeEvent={observeEvent}
                recordFeedback={recordFeedback}
              />
              <TimelinePanel timeline={timeline} liveStatus={liveStatus} />
            </div>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <GepAssetStream assets={assets} reward={reward} />
              <BehaviorControlPanel activeGeneId={result.geneId} />
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-black text-white">
      <SubtleBackground />
      <TopRail source={result.source} liveStatus={liveStatus} lastLiveEventAt={lastLiveEventAt} shellMode={shellMode} />

      <section className="relative z-10 mx-auto max-w-[1480px] px-4 pb-5 pt-4 lg:px-5">
        <div className="grid min-h-[calc(100vh-88px)] min-w-0 gap-4 lg:grid-cols-[244px_minmax(0,1fr)] xl:grid-cols-[244px_minmax(0,1fr)_360px]">
          <ElectronSideNav
            result={result}
            activeGene={activeGene}
            liveStatus={liveStatus}
            lastLiveEventAt={lastLiveEventAt}
          />

          <main className="flex min-w-0 flex-col gap-4">
            <EvoMapProofHero
              {...heroProps}
            />
            <RuntimePipeline result={result} activeGene={activeGene} assets={assets} />
            <div className="grid min-w-0 gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
              <AgentSessionCard
                eventText={eventText}
                setEventText={setEventText}
                copied={copied}
                copyEvent={copyEvent}
                loading={loading}
                observeEvent={observeEvent}
                recordFeedback={recordFeedback}
              />
              <TimelinePanel timeline={timeline} liveStatus={liveStatus} />
            </div>
          </main>

          <aside className="flex min-w-0 flex-col gap-4 lg:col-span-2 xl:col-span-1">
            <LiveProofDock
              {...heroProps}
            />
            <GepAssetStream assets={assets} reward={reward} />
            <div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-1">
              <BehaviorControlPanel activeGeneId={result.geneId} />
              <RemoteComputePanel
                job={remoteJob}
                jobs={remoteJobs}
                loading={remoteLoading}
                onSubmit={submitRemoteJob}
                onImport={importRemoteArtifacts}
                onRefresh={refreshRemoteJobs}
              />
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function TopRail({
  source,
  liveStatus,
  lastLiveEventAt,
  shellMode
}: {
  source: SourceMode;
  liveStatus: LiveStatus;
  lastLiveEventAt: string | null;
  shellMode: ShellMode;
}) {
  const isElectronShell = shellMode === 'electron';
  const liveCopy = liveStatus === 'live'
    ? `Live polling${lastLiveEventAt ? ` · ${formatClock(lastLiveEventAt)}` : ''}`
    : liveStatus === 'connecting'
      ? 'Connecting state feed'
      : 'State feed offline';
  const subtitle = shellMode === 'codex'
    ? 'codex review mode'
    : shellMode === 'electron'
      ? 'desktop evolution workbench'
      : 'web control plane';

  return (
    <header className="relative z-20 border-b border-white/[0.07] bg-black/80 backdrop-blur-xl">
      <div className={`mx-auto flex h-14 max-w-[1480px] items-center justify-between px-4 lg:px-5 ${isElectronShell ? 'pl-24 lg:pl-24' : ''}`}>
        <div className="flex items-center gap-3">
          {!isElectronShell && (
            <div className="hidden items-center gap-1.5 pr-1 sm:flex">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            </div>
          )}
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Dna className="h-4 w-4 text-[#19e6ff]" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-[-0.03em]">EvoMate × EvoMap</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">{subtitle}</p>
          </div>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          {['Hook', 'MCP', 'Gene', 'Reward', 'GEP'].map((item, index) => (
            <div key={item} className="flex items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs text-white/55">{item}</span>
              {index < 4 && <ChevronRight className="h-3.5 w-3.5 text-white/18" />}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full ${liveStatus === 'live' ? 'bg-[#83f3b1]' : liveStatus === 'connecting' ? 'bg-[#f7ce6a]' : 'bg-[#ff7d7d]'}`} />
          <span className="hidden text-sm text-white/55 sm:inline">{liveCopy}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs text-white/45">{source === 'api' ? 'Real State' : 'Demo Seed'}</span>
        </div>
      </div>
    </header>
  );
}

function CodexReviewHeader({ liveStatus, lastLiveEventAt }: { liveStatus: LiveStatus; lastLiveEventAt: string | null }) {
  const status = liveStatus === 'live'
    ? `Live · ${lastLiveEventAt ? formatClock(lastLiveEventAt) : 'now'}`
    : liveStatus === 'connecting'
      ? 'Connecting'
      : 'Offline';

  return (
    <section className="rounded-[24px] border border-[#19e6ff]/14 bg-[#19e6ff]/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-[#19e6ff]/70">Codex Website Review</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.05em] text-white">Annotation-friendly layout</h2>
        </div>
        <span className={`rounded-full border px-3 py-1.5 text-xs ${liveStatus === 'live' ? 'border-[#83f3b1]/20 bg-[#83f3b1]/10 text-[#83f3b1]' : 'border-[#f7ce6a]/20 bg-[#f7ce6a]/10 text-[#f7ce6a]'}`}>{status}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-white/50">
        单列、少文字、模块边界清楚，适合在 Codex 浏览器里逐块标注修改。
      </p>
    </section>
  );
}

function ElectronSideNav({
  result,
  activeGene,
  liveStatus,
  lastLiveEventAt
}: {
  result: AnalyzeResult;
  activeGene: GeneTuple;
  liveStatus: LiveStatus;
  lastLiveEventAt: string | null;
}) {
  const navItems = [
    ['Proof Chain', 'Hook → MCP → GEP', <Network key="proof" />],
    ['Live Session', 'Codex / Claude', <TerminalSquare key="session" />],
    ['Behavior Gene', activeGene[0], <GitBranch key="gene" />],
    ['GEP Ledger', 'Mutation assets', <Layers3 key="gep" />],
    ['Evolution Lab', 'Remote training', <CircuitBoard key="lab" />]
  ] as const;

  return (
    <aside className="hidden min-w-0 flex-col rounded-[28px] border border-white/[0.08] bg-[#070707]/92 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] lg:flex">
      <div className="rounded-2xl border border-[#19e6ff]/16 bg-[#19e6ff]/[0.045] p-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[#19e6ff]/70">Product Mode</p>
        <h2 className="mt-2 text-xl font-semibold leading-tight tracking-[-0.05em] text-white">
          Electron<br />workbench
        </h2>
        <p className="mt-3 text-xs leading-5 text-white/42">不是网页首页，是本机 Agent 进化驾驶舱。</p>
      </div>

      <nav className="mt-4 space-y-2">
        {navItems.map(([label, detail, icon], index) => (
          <div key={label} className={`group rounded-2xl border px-3 py-3 transition ${index === 0 ? 'border-[#83f3b1]/20 bg-[#83f3b1]/[0.06]' : 'border-white/[0.07] bg-white/[0.022]'}`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border [&>svg]:h-4 [&>svg]:w-4 ${index === 0 ? 'border-[#83f3b1]/25 bg-[#83f3b1]/10 text-[#83f3b1]' : 'border-white/10 bg-black/25 text-white/38'}`}>
                {icon}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{label}</p>
                <p className="mt-0.5 truncate text-[11px] text-white/36">{detail}</p>
              </div>
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/32">Yesness</p>
          <span className={`h-2 w-2 rounded-full ${liveStatus === 'live' ? 'bg-[#83f3b1]' : 'bg-[#f7ce6a]'}`} />
        </div>
        <p className="mt-2 text-3xl font-semibold tracking-[-0.06em] text-[#19e6ff]">{(result.yesness * 100).toFixed(1)}%</p>
        <p className="mt-2 truncate text-xs text-white/38">{lastLiveEventAt ? `updated ${formatClock(lastLiveEventAt)}` : 'waiting for live event'}</p>
      </div>
    </aside>
  );
}

function LiveProofDock({
  result,
  activeGene,
  assets,
  reward,
  delta,
  timeline,
  liveStatus,
  lastLiveEventAt,
  flowPulseKey
}: {
  result: AnalyzeResult;
  activeGene: GeneTuple;
  assets: GepAsset[];
  reward: RewardResult | null;
  delta: number;
  timeline: string[];
  liveStatus: LiveStatus;
  lastLiveEventAt: string | null;
  flowPulseKey: string;
}) {
  const latestEvent = timeline[0] ?? 'Waiting for Codex / Claude Code hook event.';
  const statusCopy = liveStatus === 'live'
    ? `live ${lastLiveEventAt ? `· ${formatClock(lastLiveEventAt)}` : ''}`
    : liveStatus === 'connecting'
      ? 'connecting'
      : 'offline';

  return (
    <section className="min-w-0 rounded-[28px] border border-white/[0.08] bg-[#070707]/92 p-4 xl:sticky xl:top-[72px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/32">Live proof</p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.04em] text-white">评委证据包</h2>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs ${liveStatus === 'live' ? 'border-[#83f3b1]/20 bg-[#83f3b1]/10 text-[#83f3b1]' : 'border-[#f7ce6a]/20 bg-[#f7ce6a]/10 text-[#f7ce6a]'}`}>{statusCopy}</span>
      </div>

      <div className="mt-4 rounded-2xl border border-[#19e6ff]/16 bg-[#19e6ff]/[0.045] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.22em] text-[#19e6ff]/70">Hook received</p>
          <MiniPulse liveStatus={liveStatus} pulseKey={flowPulseKey} />
        </div>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-white/62">{latestEvent}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <MetricBox label="MCP Action" value="select_gene" />
        <MetricBox label="Gene" value={activeGene[0]} tone="mint" />
        <MetricBox label="Yesness" value={`${(result.yesness * 100).toFixed(1)}%`} />
        <MetricBox label="Delta" value={`${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`} tone={delta >= 0 ? 'mint' : 'red'} />
      </div>

      <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
        <p className="text-xs uppercase tracking-[0.22em] text-white/30">GEP write proof</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {assets.slice(0, 4).map((asset) => (
            <span key={`${asset.type}_${asset.id}`} className="rounded-full border border-[#83f3b1]/16 bg-[#83f3b1]/[0.06] px-3 py-1.5 text-xs text-[#83f3b1]">{asset.type}</span>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        <BeforeAfterCard
          label="Before EvoMate"
          tone="red"
          text="直接开干 → 被打断"
        />
        <BeforeAfterCard
          label="After EvoMate"
          tone="mint"
          text={`下次执行：${activeGene[0]}`}
        />
      </div>

      <div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/25 p-4">
        <p className="text-xs uppercase tracking-[0.22em] text-white/30">Reward</p>
        <p className={`mt-2 text-xl font-semibold ${reward && reward.value < 0 ? 'text-[#ff7d7d]' : 'text-[#83f3b1]'}`}>{reward ? formatReward(reward.value) : 'pending'}</p>
      </div>
    </section>
  );
}


function EvoMapProofHero({
  result,
  activeGene,
  assets,
  reward,
  delta,
  timeline,
  liveStatus,
  lastLiveEventAt,
  flowPulseKey
}: {
  result: AnalyzeResult;
  activeGene: GeneTuple;
  assets: GepAsset[];
  reward: RewardResult | null;
  delta: number;
  timeline: string[];
  liveStatus: LiveStatus;
  lastLiveEventAt: string | null;
  flowPulseKey: string;
}) {
  const latestEvent = timeline[0] ?? 'Waiting for Codex / Claude Code hook event.';
  const nonCapsuleAssets = assets.filter((asset) => asset.type !== 'Capsule');
  const statusCopy = liveStatus === 'live'
    ? `live state ${lastLiveEventAt ? `· ${formatClock(lastLiveEventAt)}` : ''}`
    : liveStatus === 'connecting'
      ? 'connecting to local state'
      : 'offline fallback';

  const proofStages: FlowStage[] = [
    {
      icon: <RadioTower />,
      label: '01',
      title: 'Hook',
      detail: 'Codex / Claude',
      tone: 'cyan'
    },
    {
      icon: <PlugZap />,
      label: '02',
      title: 'MCP',
      detail: 'select_gene',
      tone: 'cyan'
    },
    {
      icon: <GitBranch />,
      label: '03',
      title: 'Gene',
      detail: activeGene[0],
      tone: 'mint'
    },
    {
      icon: <ThumbsUp />,
      label: '04',
      title: 'Reward',
      detail: reward ? formatReward(reward.value) : `${(result.yesness * 100).toFixed(0)}%`,
      tone: reward && reward.value < 0 ? 'red' : 'mint'
    },
    {
      icon: <Layers3 />,
      label: '05',
      title: 'GEP',
      detail: `${nonCapsuleAssets.length || assets.length} assets`,
      tone: 'cyan'
    },
    {
      icon: <Zap />,
      label: '06',
      title: 'Next',
      detail: 'behavior update',
      tone: 'mint'
    }
  ];

  return (
    <section className="relative min-w-0 overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#050505]/95 p-5 shadow-[0_28px_110px_rgba(0,0,0,0.42)] sm:p-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-56 -top-56 h-[720px] w-[720px] rounded-full border border-[#19e6ff]/10" />
        <div className="absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full border border-[#83f3b1]/10" />
        <div className="absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-[#19e6ff]/50 to-transparent" />
      </div>

      <div className="relative z-10 min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#19e6ff]/25 bg-[#19e6ff]/10 px-3 py-1.5 text-xs text-[#19e6ff]">EvoMap Integration Proof</span>
            <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs text-white/45">Hook → MCP → GEP → Evolution</span>
            <span className={`rounded-full border px-3 py-1.5 text-xs ${liveStatus === 'live' ? 'border-[#83f3b1]/25 bg-[#83f3b1]/10 text-[#83f3b1]' : 'border-[#f7ce6a]/25 bg-[#f7ce6a]/10 text-[#f7ce6a]'}`}>{statusCopy}</span>
          </div>

          <h1 className="mt-5 max-w-4xl text-[34px] font-semibold leading-[0.92] tracking-[-0.08em] text-white sm:text-[46px] xl:text-[54px]">
            EvoMap-native<br />
            <span className="text-[#19e6ff]">self-evolving agent layer.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/50 lg:text-base">
            Hook 收到真实 Agent 消息后，EvoMate 把它变成一次可追踪的 EvoMap 进化流。
          </p>

          <EvolutionFlowAnimation
            stages={proofStages}
            liveStatus={liveStatus}
            pulseKey={flowPulseKey}
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MetricBox label="Selected Gene" value={activeGene[0]} tone="mint" />
            <MetricBox label="Yesness" value={`${(result.yesness * 100).toFixed(1)}%`} />
            <MetricBox label="GEP" value={assets.map((asset) => asset.type).slice(0, 2).join(' + ') || 'pending'} tone="mint" />
          </div>
        </div>
      </div>
    </section>
  );
}

function EvolutionFlowAnimation({ stages, liveStatus, pulseKey }: { stages: FlowStage[]; liveStatus: LiveStatus; pulseKey: string }) {
  return (
    <div className="relative mt-6 min-w-0 overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025] p-4">
      <div className="absolute left-8 right-8 top-[50px] hidden h-px bg-gradient-to-r from-[#19e6ff]/20 via-[#19e6ff]/55 to-[#83f3b1]/25 md:block" />
      {liveStatus !== 'offline' && (
        <motion.div
          key={pulseKey}
          className={`absolute top-[43px] z-20 hidden h-4 w-4 rounded-full md:block ${liveStatus === 'live' ? 'bg-[#83f3b1] shadow-[0_0_24px_rgba(131,243,177,0.9)]' : 'bg-[#f7ce6a] shadow-[0_0_22px_rgba(247,206,106,0.75)]'}`}
          initial={{ left: '3%', opacity: 0, scale: 0.6 }}
          animate={{ left: ['3%', '20%', '38%', '56%', '74%', '92%'], opacity: [0, 1, 1, 1, 1, 0], scale: [0.6, 1, 1, 1, 1, 0.7] }}
          transition={{ duration: 2.8, ease: 'easeInOut' }}
        />
      )}
      <div className="relative z-10 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {stages.map((stage, index) => (
          <FlowNode key={stage.label} stage={stage} index={index} live={liveStatus !== 'offline'} />
        ))}
      </div>
    </div>
  );
}

function FlowNode({ stage, index, live }: { stage: FlowStage; index: number; live: boolean }) {
  const { icon, label, title, detail, tone } = stage;
  const toneClasses = tone === 'mint'
    ? 'border-[#83f3b1]/20 bg-[#83f3b1]/[0.055] text-[#83f3b1]'
    : tone === 'red'
      ? 'border-[#ff7d7d]/20 bg-[#ff7d7d]/[0.055] text-[#ff9b9b]'
      : 'border-[#19e6ff]/20 bg-[#19e6ff]/[0.055] text-[#19e6ff]';

  return (
    <motion.div
      className="relative min-w-0 rounded-2xl border border-white/[0.08] bg-black/25 p-2.5"
      animate={live ? { y: [0, -3, 0], borderColor: ['rgba(255,255,255,0.08)', index === 0 ? 'rgba(25,230,255,0.35)' : 'rgba(131,243,177,0.22)', 'rgba(255,255,255,0.08)'] } : undefined}
      transition={{ duration: 2.8, delay: index * 0.28, repeat: live ? Infinity : 0, repeatDelay: 2.2 }}
    >
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${toneClasses} [&>svg]:h-4 [&>svg]:w-4`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/28">{label}</p>
          <p className="truncate text-sm font-semibold text-white">{title}</p>
        </div>
      </div>
      <p className="mt-2 truncate text-xs leading-5 text-white/38">{detail}</p>
    </motion.div>
  );
}

function MiniPulse({ liveStatus, pulseKey }: { liveStatus: LiveStatus; pulseKey: string }) {
  return (
    <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.08]">
      {liveStatus !== 'offline' && (
        <motion.span
          key={pulseKey}
          className={`absolute inset-y-0 left-0 w-1/3 rounded-full ${liveStatus === 'live' ? 'bg-gradient-to-r from-[#19e6ff] to-[#83f3b1]' : 'bg-gradient-to-r from-[#f7ce6a] to-[#19e6ff]'}`}
          initial={{ x: '-120%' }}
          animate={{ x: '320%' }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
      )}
    </div>
  );
}

function BeforeAfterCard({ label, text, tone }: { label: string; text: string; tone: 'mint' | 'red' }) {
  const classes = tone === 'mint'
    ? 'border-[#83f3b1]/18 bg-[#83f3b1]/[0.045] text-[#83f3b1]'
    : 'border-[#ff7d7d]/18 bg-[#ff7d7d]/[0.045] text-[#ff9b9b]';

  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="text-xs uppercase tracking-[0.2em] opacity-80">{label}</p>
      <p className="mt-2 text-sm leading-6 text-white/60">{text}</p>
    </div>
  );
}


function AgentSessionCard({
  eventText,
  setEventText,
  copied,
  copyEvent,
  loading,
  observeEvent,
  recordFeedback
}: {
  eventText: string;
  setEventText: (value: string) => void;
  copied: boolean;
  copyEvent: () => void;
  loading: boolean;
  observeEvent: () => void;
  recordFeedback: (kind: 'accepted' | 'corrected' | 'interrupted') => void;
}) {
  return (
    <section className="min-w-0 rounded-[28px] border border-white/[0.08] bg-[#070707]/90 p-4">
      <PanelHeader icon={<TerminalSquare />} title="Live Agent Session" subtitle="observer mode" />
      <div className="mt-4 grid gap-2">
        <SessionRow label="Source" value="Codex CLI" status="observed" />
      </div>
      <label className="mt-4 block text-xs uppercase tracking-[0.22em] text-white/32">Paste event</label>
      <textarea
        value={eventText}
        onChange={(event) => setEventText(event.target.value)}
        className="mt-2 min-h-[88px] w-full resize-none rounded-2xl border border-white/[0.1] bg-[#161616] p-3 text-sm leading-6 text-white/72 outline-none transition focus:border-[#19e6ff]/45"
      />
      <div className="mt-3 grid grid-cols-[1fr_46px] gap-2">
        <button
          type="button"
          onClick={observeEvent}
          className="flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-white/90"
        >
          {loading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
          Observe Event
        </button>
        <button
          type="button"
          onClick={copyEvent}
          className="flex items-center justify-center rounded-2xl border border-white/[0.1] bg-white/[0.035] text-[#19e6ff]"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <FeedbackButton icon={<ThumbsUp />} label="Accepted" tone="mint" onClick={() => recordFeedback('accepted')} />
        <FeedbackButton icon={<ThumbsDown />} label="Corrected" tone="gray" onClick={() => recordFeedback('corrected')} />
        <FeedbackButton icon={<ShieldCheck />} label="Interrupted" tone="red" onClick={() => recordFeedback('interrupted')} />
      </div>
    </section>
  );
}

function HeroPanel({ result, activeGene, reward, delta }: { result: AnalyzeResult; activeGene: GeneTuple; reward: RewardResult | null; delta: number }) {
  return (
    <section className="relative min-h-[450px] min-w-0 overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#050505]/95 p-5 sm:rounded-[34px] sm:p-6 lg:p-7">
      <div className="absolute inset-0 opacity-70">
        <div className="absolute -right-48 -top-48 h-[620px] w-[620px] rounded-full border border-white/[0.055]" />
        <div className="absolute -right-28 -top-28 h-[420px] w-[420px] rounded-full border border-white/[0.06]" />
        <div className="absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-[#19e6ff]/45 to-transparent" />
      </div>
      <div className="relative z-10 grid h-full min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.08fr)_330px]">
        <div className="flex min-w-0 flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.035] px-3 py-1.5 text-xs text-white/45">
              <span className="h-1.5 w-1.5 rounded-full bg-[#19e6ff] shadow-[0_0_14px_rgba(25,230,255,0.9)]" />
              Self-evolving behavior layer for existing agents
            </div>
            <h2 className="mt-7 max-w-4xl text-[34px] font-semibold leading-[0.95] tracking-[-0.075em] sm:text-[42px] lg:text-[54px] 2xl:text-[58px]">
              Codex keeps working.<br /><span className="text-[#19e6ff]">EvoMate makes it adapt.</span>
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/48 lg:text-lg">
              We observe agent events, extract user intent through EvoMap LLM, select a behavior gene with ML, then write the learning trail into GEP assets.
            </p>
          </div>

          <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <MetricBox label="Semantic Parse" value={result.llmUsed ? 'EvoMap LLM' : 'Seed rules'} />
            <MetricBox label="Intent" value={result.semantic.intent} />
            <MetricBox label="Confidence" value={result.llmConfidence == null ? `${(result.semantic.confidence * 100).toFixed(0)}%` : `${(result.llmConfidence * 100).toFixed(0)}%`} />
            <MetricBox label="Delta" value={`${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`} tone={delta >= 0 ? 'mint' : 'red'} />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {result.signals.slice(0, 8).map((signal) => (
              <span key={signal} className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs text-white/55">{signal}</span>
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-[26px] border border-white/[0.08] bg-[#111]/80 p-5 shadow-[0_0_80px_rgba(25,230,255,0.06)]">
          <p className="text-xs uppercase tracking-[0.22em] text-white/35">Advisor output</p>
          <p className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#83f3b1]">{activeGene[0]}</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.div initial={{ width: 0 }} animate={{ width: `${result.yesness * 100}%` }} className="h-full rounded-full bg-gradient-to-r from-[#19e6ff] to-[#83f3b1]" />
          </div>
          <p className="mt-2 text-sm text-white/42">{activeGene[1]}</p>
          <p className="mt-5 text-sm leading-6 text-white/52">{activeGene[3]}</p>
          <div className="mt-5 rounded-2xl border border-[#19e6ff]/16 bg-[#19e6ff]/[0.04] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-[#19e6ff]/70">Inject into next run</p>
            <p className="mt-2 text-sm leading-6 text-white/58">{activeGene[5]}</p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <MetricBox label="Task" value={result.taskType} />
            <MetricBox label="Risk" value={result.riskLevel} />
            <MetricBox label="Mode" value={result.source} />
            <MetricBox label="Reward" value={reward ? formatReward(reward.value) : '--'} tone={reward && reward.value < 0 ? 'red' : 'mint'} />
          </div>
        </div>
      </div>
    </section>
  );
}

function RuntimePipeline({ result, activeGene, assets }: { result: AnalyzeResult; activeGene: GeneTuple; assets: GepAsset[] }) {
  const steps = [
    { icon: <Bot />, label: 'Agent', value: 'Codex / Claude' },
    { icon: <Cpu />, label: 'Policy', value: activeGene[0] },
    { icon: <PlugZap />, label: 'Inject', value: 'Next run' },
    { icon: <ClipboardList />, label: 'GEP', value: `${assets.filter((asset) => asset.type !== 'Capsule').length} assets` }
  ];

  return (
    <section className="min-w-0 rounded-[24px] border border-white/[0.08] bg-[#070707]/90 p-4">
      <PanelHeader icon={<Network />} title="Runtime" subtitle="compact proof" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <div key={step.label} className="relative flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
            {index < steps.length - 1 && <div className="absolute right-[-13px] top-1/2 z-10 hidden h-px w-6 bg-gradient-to-r from-[#19e6ff]/50 to-transparent xl:block" />}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#19e6ff]/20 bg-[#19e6ff]/10 text-[#19e6ff] [&>svg]:h-4 [&>svg]:w-4">{step.icon}</div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">{step.label}</p>
              <p className="mt-0.5 truncate text-sm font-medium text-white">{step.value}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
        <span className="rounded-full border border-[#19e6ff]/16 bg-[#19e6ff]/10 px-3 py-1 text-xs text-[#19e6ff]">{result.semantic.intent}</span>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1 text-xs text-white/50">{result.semantic.permissionMode}</span>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1 text-xs text-white/50">{result.riskLevel}</span>
        <span className="rounded-full border border-[#83f3b1]/16 bg-[#83f3b1]/10 px-3 py-1 text-xs text-[#83f3b1]">{(result.semantic.confidence * 100).toFixed(0)}% parsed</span>
      </div>
    </section>
  );
}

function SemanticRoute({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[82px_minmax(0,1fr)] gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5 sm:grid-cols-[88px_minmax(0,1fr)]">
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/32">{label}</p>
      <p className="truncate text-xs text-white/62">{value}</p>
    </div>
  );
}

function BehaviorControlPanel({ activeGeneId }: { activeGeneId: string }) {
  return (
    <section className="min-w-0 rounded-[28px] border border-white/[0.08] bg-[#070707]/90 p-4">
      <PanelHeader icon={<GitBranch />} title="Behavior Control" subtitle="advisor policy" />
      <div className="mt-4 space-y-2">
        {genes.map(([label, id, score, body, mode]) => {
          const active = id === activeGeneId;
          return (
            <div key={id} className={`rounded-2xl border p-3 ${active ? 'border-[#83f3b1]/25 bg-[#83f3b1]/[0.065]' : 'border-white/[0.08] bg-white/[0.025]'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{label}</p>
                  <p className="mt-1 truncate text-xs text-white/35">{mode}</p>
                </div>
                <p className={active ? 'text-[#83f3b1]' : 'text-white/48'}>{(score * 100).toFixed(0)}%</p>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                <motion.div initial={{ width: 0 }} animate={{ width: `${score * 100}%` }} className="h-full rounded-full bg-gradient-to-r from-[#19e6ff] to-[#83f3b1]" />
              </div>
              {active && <p className="mt-2 line-clamp-1 text-xs leading-5 text-white/42">{body}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GepAssetStream({ assets, reward }: { assets: GepAsset[]; reward: RewardResult | null }) {
  return (
    <section className="min-w-0 rounded-[28px] border border-white/[0.08] bg-[#070707]/90 p-5">
      <PanelHeader icon={<Layers3 />} title="GEP Asset Stream" subtitle="evomap ledger" />
      <div className="mt-5 space-y-3">
        {assets.map((asset) => (
          <div key={`${asset.type}_${asset.id}`} className="min-w-0 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-white">{asset.type}</p>
              <BadgeCheck className={`h-4 w-4 ${asset.asset_id ? 'text-[#83f3b1]' : 'text-white/24'}`} />
            </div>
            <p className="mt-2 truncate text-xs text-white/42">{asset.id}</p>
            <p className="mt-2 truncate text-xs text-[#19e6ff]/70">{asset.asset_id ?? 'waiting for threshold / feedback'}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/30 p-4">
        <p className="text-xs uppercase tracking-[0.22em] text-white/30">Latest reward</p>
        <p className={`mt-3 text-2xl font-semibold ${reward && reward.value < 0 ? 'text-[#ff7d7d]' : 'text-[#83f3b1]'}`}>{reward ? formatReward(reward.value) : 'pending'}</p>
      </div>
    </section>
  );
}


function RemoteComputePanel({
  job,
  jobs,
  loading,
  onSubmit,
  onImport,
  onRefresh
}: {
  job: RemoteJob | null;
  jobs: RemoteJob[];
  loading: boolean;
  onSubmit: () => void;
  onImport: () => void;
  onRefresh: () => void;
}) {
  const active = job ?? jobs[0];
  const statusTone = active?.status === 'imported' || active?.status === 'completed'
    ? 'text-[#83f3b1]'
    : active?.status === 'failed'
      ? 'text-[#ff7d7d]'
      : 'text-[#19e6ff]';

  return (
    <section className="min-w-0 rounded-[28px] border border-white/[0.08] bg-[#070707]/90 p-5">
      <PanelHeader icon={<CircuitBoard />} title="Remote Compute" subtitle="gpu distribution" />
      <EvolutionGymCompact active={active} loading={loading} />

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <MetricBox label="Host" value={active?.target?.host || 'configured host'} />
        <MetricBox label="Mode" value={active?.target?.executeRemote ? 'ssh' : 'dry-run'} />
        <MetricBox label="Status" value={active?.status || 'ready'} tone={active?.status === 'failed' ? 'red' : 'cyan'} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onSubmit}
          className="flex items-center justify-center gap-2 rounded-2xl bg-white px-3 py-3 text-xs font-medium text-black transition hover:bg-white/90"
        >
          {loading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
          Submit Job
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={!active}
          className="flex items-center justify-center gap-2 rounded-2xl border border-[#83f3b1]/25 bg-[#83f3b1]/10 px-3 py-3 text-xs font-medium text-[#83f3b1] transition disabled:cursor-not-allowed disabled:opacity-35"
        >
          <BadgeCheck className="h-4 w-4" />
          Import
        </button>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-xs text-white/50 transition hover:text-white"
      >
        <RefreshCcw className="h-3.5 w-3.5" />
        Refresh Queue
      </button>

      <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.22em] text-white/30">Active job</p>
            <p className="mt-2 truncate text-sm font-medium text-white">{active?.jobId || 'no job submitted yet'}</p>
          </div>
          <p className={`text-sm font-semibold ${statusTone}`}>{active?.status || 'idle'}</p>
        </div>
        <p className="mt-3 line-clamp-2 text-sm leading-5 text-white/42">{active?.objective || 'Submit an evolution_gym_eval job to produce policy_eval, ValidationReport, mutations, and EvolutionBundle.'}</p>
        <div className="mt-4 space-y-2">
          <RemoteStep label="Dataset" active={Boolean(active)} />
          <RemoteStep label="SSH Queue" active={Boolean(active)} />
          <RemoteStep label="Python Worker" active={active?.status === 'running' || active?.status === 'completed' || active?.status === 'imported'} />
          <RemoteStep label="GEP Import" active={active?.status === 'imported'} />
        </div>
      </div>

      {active?.artifactSummary && (
        <div className="mt-4 rounded-2xl border border-[#83f3b1]/16 bg-[#83f3b1]/[0.045] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-[#83f3b1]/70">Imported bundle</p>
          <p className="mt-2 truncate text-sm text-white">{active.artifactSummary.evolutionBundleId}</p>
          <p className="mt-2 text-xs text-white/44">
            score {((active.artifactSummary.validationScore || 0) * 100).toFixed(0)}% · {active.artifactSummary.suggestedMutationCount || 0} mutation(s)
          </p>
        </div>
      )}
    </section>
  );
}

function EvolutionGymCompact({ active, loading }: { active: RemoteJob | undefined; loading: boolean }) {
  const status = active?.status || (loading ? 'running' : 'idle');
  const cells = Array.from({ length: 36 }, (_, index) => index);
  const activeCells = status === 'imported'
    ? 36
    : status === 'completed'
      ? 31
      : status === 'running'
        ? 24
        : status === 'queued'
          ? 16
          : loading
            ? 22
            : 9;
  const phase = status === 'imported'
    ? 'GEP bundle imported'
    : status === 'completed'
      ? 'validation complete'
      : status === 'running' || loading
        ? 'simulating users'
        : status === 'queued'
          ? 'queued for worker'
          : 'ready for gym';
  const fitness = status === 'failed' ? 0.22 : active?.artifactSummary?.validationScore ?? (active ? 0.72 : 0.58);

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-[#19e6ff]/15 bg-[#19e6ff]/[0.035] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.22em] text-[#19e6ff]/70">Evolution Gym</p>
          <p className="mt-2 text-sm leading-5 text-white/62">Compact simulator: squares are user-behavior scenarios. More light = more mutations survived.</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#19e6ff]/20 bg-black/25 text-[#19e6ff]">
          <CircuitBoard className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
        <div className="relative rounded-2xl border border-white/[0.07] bg-black/30 p-3">
          <div className="grid grid-cols-6 gap-1.5">
            {cells.map((cell) => {
              const lit = cell < activeCells;
              const wave = (cell % 6) * 0.08 + Math.floor(cell / 6) * 0.06;
              return (
                <motion.span
                  key={`${active?.jobId || 'idle'}_${status}_${cell}`}
                  initial={{ opacity: 0.08, scale: 0.62 }}
                  animate={{
                    opacity: lit ? [0.28, 1, 0.58] : [0.07, 0.18, 0.08],
                    scale: lit ? [0.78, 1.08, 0.94] : [0.62, 0.76, 0.62],
                    boxShadow: lit
                      ? ['0 0 0px rgba(25,230,255,0)', '0 0 14px rgba(25,230,255,0.58)', '0 0 4px rgba(131,243,177,0.26)']
                      : '0 0 0px rgba(255,255,255,0)'
                  }}
                  transition={{
                    duration: lit ? 1.35 : 2.4,
                    repeat: Infinity,
                    repeatType: 'loop',
                    delay: wave,
                    ease: 'easeInOut'
                  }}
                  className={`aspect-square rounded-[5px] border ${lit ? 'border-[#19e6ff]/30 bg-[#19e6ff]/70' : 'border-white/[0.06] bg-white/[0.04]'}`}
                />
              );
            })}
          </div>
          <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_35%_20%,rgba(25,230,255,0.18),transparent_46%)]" />
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-white">{phase}</p>
            <span className="rounded-full border border-[#83f3b1]/16 bg-[#83f3b1]/10 px-2.5 py-1 text-[11px] text-[#83f3b1]">{activeCells}/36</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(fitness * 100)}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-[#19e6ff] via-[#83f3b1] to-white"
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MetricBox label="Scenarios" value={String(active ? 128 : 36)} />
            <MetricBox label="Genes" value="6-way" tone="mint" />
            <MetricBox label="Fitness" value={`${Math.round(fitness * 100)}%`} tone={fitness > 0.6 ? 'mint' : 'red'} />
          </div>
          <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/40">{active?.objective || 'Submit evolution_gym_eval to grow the square field from seed behavior into a validated GEP bundle.'}</p>
        </div>
      </div>
    </div>
  );
}

function RemoteStep({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2">
      <span className="text-xs text-white/52">{label}</span>
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-[#83f3b1] shadow-[0_0_12px_rgba(131,243,177,0.65)]' : 'bg-white/18'}`} />
    </div>
  );
}

function TimelinePanel({ timeline, liveStatus }: { timeline: string[]; liveStatus: LiveStatus }) {
  const subtitle = liveStatus === 'live'
    ? 'live hook feed'
    : liveStatus === 'connecting'
      ? 'connecting'
      : 'offline cache';

  return (
    <section className="min-w-0 rounded-[28px] border border-white/[0.08] bg-[#070707]/90 p-4">
      <PanelHeader icon={<Activity />} title="Evolution Timeline" subtitle={subtitle} />
      <div className="mt-4 space-y-2">
        {timeline.slice(0, 4).map((event, index) => (
          <div key={`${event}_${index}`} className="min-w-0 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
            <p className="text-xs text-[#19e6ff]">evt_0{index + 1}</p>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-white/56">{event}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SessionRow({ label, value, status }: { label: string; value: string; status: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">{label}</p>
        <p className="mt-1 text-sm text-white/72">{value}</p>
      </div>
      <span className="rounded-full border border-[#19e6ff]/20 bg-[#19e6ff]/10 px-2.5 py-1 text-[11px] text-[#19e6ff]">{status}</span>
    </div>
  );
}

function PanelHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-white/32">{subtitle}</p>
        <h3 className="mt-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-white">
          <span className="text-[#19e6ff] [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
          {title}
        </h3>
      </div>
      <span className="h-2 w-2 rounded-full bg-[#19e6ff] shadow-[0_0_16px_rgba(25,230,255,0.95)]" />
    </div>
  );
}

function FeedbackButton({ icon, label, tone, onClick }: { icon: ReactNode; label: string; tone: 'mint' | 'gray' | 'red'; onClick: () => void }) {
  const classes = tone === 'mint'
    ? 'border-[#83f3b1]/25 bg-[#83f3b1]/10 text-[#83f3b1]'
    : tone === 'red'
      ? 'border-[#ff7d7d]/25 bg-[#ff7d7d]/10 text-[#ff9b9b]'
      : 'border-white/[0.1] bg-white/[0.035] text-white/55';
  return (
    <button type="button" onClick={onClick} className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition hover:scale-[1.01] ${classes}`}>
      <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      {label}
    </button>
  );
}

function MetricBox({ label, value, tone = 'cyan' }: { label: string; value: string; tone?: 'cyan' | 'mint' | 'red' }) {
  const color = tone === 'mint' ? 'text-[#83f3b1]' : tone === 'red' ? 'text-[#ff7d7d]' : 'text-[#19e6ff]';
  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/25 p-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/32">{label}</p>
      <p className={`mt-1 truncate text-sm font-medium ${color}`}>{value}</p>
    </div>
  );
}

function SubtleBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_12%,rgba(25,230,255,0.09),transparent_24%),radial-gradient(circle_at_82%_28%,rgba(131,243,177,0.06),transparent_20%)]" />
      <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:52px_52px]" />
      <div className="absolute left-[42%] top-[10%] h-[760px] w-[760px] rounded-full border border-white/[0.035]" />
      <div className="absolute left-[52%] top-[18%] h-[520px] w-[520px] rounded-full border border-white/[0.04]" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black to-transparent" />
    </div>
  );
}

function mockAnalyze(text: string, previousYesness: number): AnalyzeResult {
  const signals = new Set<string>();
  if (/代码|仓库|repo|前端|后端|codex|claude/i.test(text)) signals.add('coding_task');
  if (/先|别|不要|乱动|看看|read-only/i.test(text)) signals.add('permission_sensitive');
  if (/evomap|gep|进化/i.test(text)) signals.add('evomap_integration');
  if (/mcp/i.test(text)) signals.add('mcp_native');
  if (/机器学习|ml|policy|reward/i.test(text)) signals.add('ml_policy');
  if (/路演|demo|评委/.test(text)) signals.add('roadshow_planning');
  if (!signals.size) signals.add('agent_event');

  const geneId = signals.has('permission_sensitive')
    ? 'gene_ask_before_execution'
    : signals.has('roadshow_planning')
      ? 'gene_visualize_first'
      : signals.has('mcp_native') || signals.has('evomap_integration')
        ? 'gene_mcp_first_architecture'
        : signals.has('ml_policy')
          ? 'gene_yes_engineer_policy'
          : 'gene_concise_direct_answer';

  return {
    geneId,
    yesness: geneId === 'gene_ask_before_execution' ? 0.864 : 0.812,
    previousYesness,
    signals: [...signals],
    taskType: signals.has('coding_task') ? 'coding' : signals.has('roadshow_planning') ? 'product' : 'general',
    riskLevel: signals.has('permission_sensitive') ? 'medium' : 'low',
    semantic: mockSemantic(text, [...signals]),
    source: 'demo',
    llmUsed: false,
    llmIntent: 'simulated agent event classification',
    llmConfidence: 0.68
  };
}

function normalizeSemantic(value: unknown, fallback: Pick<SemanticResult, 'signals' | 'taskType' | 'riskLevel'>): SemanticResult {
  const item = value && typeof value === 'object' ? value as Partial<SemanticResult> : {};
  return {
    taskType: asString(item.taskType, fallback.taskType),
    intent: asString(item.intent, 'general_help'),
    riskLevel: asString(item.riskLevel, fallback.riskLevel),
    permissionMode: asString(item.permissionMode, fallback.riskLevel === 'high' ? 'ask_before_editing' : 'unknown'),
    userTone: asString(item.userTone, 'neutral'),
    workstyleSignals: asStringArray(item.workstyleSignals),
    domainSignals: asStringArray(item.domainSignals),
    toolNeeds: asStringArray(item.toolNeeds),
    feedbackSemantics: item.feedbackSemantics && typeof item.feedbackSemantics === 'object'
      ? {
          sentiment: asString(item.feedbackSemantics.sentiment, 'neutral'),
          correctionType: typeof item.feedbackSemantics.correctionType === 'string' ? item.feedbackSemantics.correctionType : undefined,
          rewardHint: typeof item.feedbackSemantics.rewardHint === 'number' ? item.feedbackSemantics.rewardHint : 0
        }
      : null,
    signals: asStringArray(item.signals).length ? asStringArray(item.signals) : fallback.signals,
    confidence: typeof item.confidence === 'number' ? clamp(item.confidence, 0, 1) : 0.52
  };
}

function mockSemantic(text: string, signals: string[]): SemanticResult {
  const wantsCaution = /先|别|不要|乱动|看看|read-only/i.test(text);
  const wantsFrontend = /前端|界面|ui|视觉|布局|dashboard/i.test(text);
  const wantsRoadshow = /路演|demo|评委|黑客松/i.test(text);
  const wantsML = /机器学习|ml|policy|reward|进化/i.test(text);
  const isNegative = /不是|不对|丑|错|你干啥|别乱动|太像|难看|不行/.test(text);

  return {
    taskType: signals.includes('coding_task') ? 'coding' : wantsRoadshow ? 'product' : 'general',
    intent: wantsCaution
      ? 'analysis_before_execution'
      : wantsFrontend
        ? 'frontend_iteration'
        : wantsRoadshow
          ? 'roadshow_packaging'
          : wantsML
            ? 'ml_optimization'
            : 'direct_execution',
    riskLevel: wantsCaution ? 'medium' : 'low',
    permissionMode: wantsCaution ? 'ask_before_editing' : 'safe_to_execute',
    userTone: /快|啥几把|别废话/.test(text) ? 'impatient' : wantsCaution ? 'cautious' : 'direct',
    workstyleSignals: wantsCaution ? ['prefers_analysis_before_execution'] : ['wants_forward_progress'],
    domainSignals: [
      signals.includes('evomap_integration') ? 'evomap' : '',
      signals.includes('ml_policy') ? 'ml_policy' : '',
      signals.includes('mcp_native') ? 'mcp' : ''
    ].filter(Boolean),
    toolNeeds: [
      signals.includes('coding_task') ? 'repo_inspection' : '',
      wantsFrontend ? 'frontend_iteration' : '',
      wantsRoadshow ? 'roadshow_packaging' : ''
    ].filter(Boolean),
    feedbackSemantics: isNegative ? { sentiment: 'negative', correctionType: wantsFrontend ? 'layout_mismatch' : 'execution_mismatch', rewardHint: -0.65 } : null,
    signals,
    confidence: 0.68
  };
}

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' && value ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}


function mockRemoteJob(): RemoteJob {
  const jobId = `job_evolution_gym_eval_${Date.now().toString().slice(-8)}`;
  return {
    jobId,
    type: 'evolution_gym_eval',
    status: 'queued',
    objective: 'Full remote evolution prototype: evaluate behavior policy, produce ValidationReport and EvolutionBundle.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    target: { host: 'remote.example.com', port: 22, user: 'evomate', executeRemote: false },
    remotePlan: { bootstrap: ['ssh mkdir'], sync: ['rsync repo'], submit: ['python remote_worker'], import: ['scp artifacts'] }
  };
}

function remoteArtifactsToAssets(artifacts: Record<string, unknown>): GepAsset[] {
  const validation = artifacts?.validationReport as { id?: string } | undefined;
  const bundle = artifacts?.evolutionBundle as { id?: string } | undefined;
  const mutations = Array.isArray(artifacts?.suggestedMutations) ? artifacts.suggestedMutations as Array<{ id?: string }> : [];
  const assets: GepAsset[] = [];
  if (validation?.id) assets.push({ type: 'ValidationReport', id: validation.id, asset_id: 'remote:imported' });
  for (const mutation of mutations.slice(0, 2)) {
    if (mutation.id) assets.push({ type: 'Mutation', id: mutation.id, asset_id: 'remote:imported' });
  }
  if (bundle?.id) assets.push({ type: 'EvolutionBundle', id: bundle.id, asset_id: 'remote:imported' });
  return assets;
}

function formatLiveTimeline(items: EvolutionTimelineItem[]) {
  return items.slice(0, 6).map((item) => {
    const eventLabel = item.summary || [item.type, item.geneId].filter(Boolean).join(' ');
    return `${formatClock(item.createdAt)} · ${eventLabel}`;
  });
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'now';
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function inferTaskType(signals: string[], fallback: string) {
  if (signals.includes('coding_task')) return 'coding';
  if (signals.includes('research_task')) return 'research';
  if (signals.includes('strategy_discussion') || signals.includes('roadshow_planning')) return 'product';
  return fallback || 'general';
}

function inferRiskLevel(signals: string[], fallback: string) {
  if (signals.includes('high_risk_action')) return 'high';
  if (signals.includes('permission_sensitive') || signals.includes('coding_task')) return 'medium';
  return fallback || 'low';
}

function inferIntentFromTimeline(item: EvolutionTimelineItem | undefined, fallback: string) {
  const text = `${item?.type ?? ''} ${item?.summary ?? ''}`;
  if (/agent_event_observed|ask_before|先分析|analysis/i.test(text)) return 'analysis_before_execution';
  if (/remote|evolution_gym|validation/i.test(text)) return 'remote_evolution';
  if (/feedback|reward|accepted|corrected|interrupted|rejected/i.test(text)) return 'feedback_learning';
  return fallback;
}

function formatReward(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
