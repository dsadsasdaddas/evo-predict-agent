import { normalizeExternalSemantic, type EvolutionState, type SemanticNormalizationResult, type SemanticParseResult, type UserInputSignal } from '@evomate/core';

export interface EvoMapLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface LlmSignalExtraction {
  source: 'evomap_llm';
  used: boolean;
  enabled: boolean;
  schemaVersion?: SemanticParseResult['schemaVersion'];
  taskType?: UserInputSignal['taskType'];
  riskLevel?: UserInputSignal['riskLevel'];
  intent?: string;
  tone?: string;
  permissionMode?: SemanticParseResult['permissionMode'];
  confidence?: number;
  signals: string[];
  semantic?: SemanticParseResult;
  normalization?: Omit<SemanticNormalizationResult, 'semantic' | 'raw'>;
  rationale?: string;
  error?: string;
}

export interface SignalExtractionTrace {
  seed: UserInputSignal;
  llm: LlmSignalExtraction;
  merged: UserInputSignal;
}

export interface MaintainedNextStepState {
  stateVersion: 'evomate.next_state.v1';
  source: 'evomap_claude' | 'deterministic_fallback';
  used: boolean;
  enabled: boolean;
  model?: string;
  updatedAt: string;
  inputEventId?: string;
  focusNodeId: 'root' | 'hook' | 'signal' | 'gene' | 'outcome' | 'gep' | 'behavior';
  stage: string;
  stageIndex: number;
  progressedTo: string;
  evidence: string;
  nextStep: string;
  mutation?: string;
  confidence?: number;
  rationale?: string;
  error?: string;
  visibleEvolution?: {
    before: string;
    after: string;
    proof: string;
    demoAction: string;
  };
  gepAsset?: {
    assetId: string;
    type: 'Mutation' | 'EvolutionEvent' | 'ValidationReport' | 'ExperienceCapsule';
    source: string;
    trigger: string;
    mutation: string;
    sharedScope: string;
    status: 'draft' | 'active' | 'reusable';
    reuseRule: string;
  };
  evomapSharing?: {
    mechanism: string;
    whyEvoMap: string;
    nextReuse: string;
  };
}


const LLM_OVERRIDE_CONFIDENCE = 0.55;

export function getEvoMapLlmConfig(): EvoMapLlmConfig | null {
  const rawKey = process.env.EVOMAP_LLM_API_KEY || process.env.EVOMAP_OPENAI_API_KEY || compatibleFallbackKey();
  if (!rawKey) return null;

  return {
    baseUrl: trimSlash(process.env.EVOMAP_LLM_BASE_URL || 'https://api.evomap.ai/v1'),
    apiKey: normalizeEvoMapLlmKey(rawKey),
    model: process.env.EVOMAP_LLM_MODEL || 'evomap-claude-opus-4-7',
    timeoutMs: Number(process.env.EVOMAP_LLM_TIMEOUT_MS || 30000)
  };
}

export async function extractSignalsWithEvoMapLlm(input: string, seed: UserInputSignal): Promise<SignalExtractionTrace> {
  const config = getEvoMapLlmConfig();
  const disabled = process.env.EVOMAP_LLM_DISABLED === '1' || process.env.EVOMAP_LLM_DISABLED === 'true';

  if (!config || disabled) {
    const llm: LlmSignalExtraction = {
      source: 'evomap_llm',
      enabled: Boolean(config) && !disabled,
      used: false,
      signals: [],
      error: config ? 'disabled' : 'missing_api_key'
    };
    return { seed, llm, merged: seed };
  }

  try {
    const llm = await callEvoMapSignalExtractor(config, input, seed);
    return { seed, llm, merged: mergeSignals(seed, llm) };
  } catch (err) {
    const llm: LlmSignalExtraction = {
      source: 'evomap_llm',
      enabled: true,
      used: false,
      signals: [],
      error: err instanceof Error ? err.message : String(err)
    };
    return { seed, llm, merged: seed };
  }
}

export function mergeSignals(seed: UserInputSignal, llm: LlmSignalExtraction): UserInputSignal {
  if (!llm.used) return seed;
  const signals = [...new Set([...seed.signals, ...llm.signals.map(normalizeSignalName).filter(Boolean)])];
  const canOverride = (llm.confidence ?? 0) >= LLM_OVERRIDE_CONFIDENCE;
  const taskType = canOverride ? llm.taskType ?? seed.taskType : seed.taskType;
  const riskLevel = canOverride ? maxRisk(seed.riskLevel, llm.riskLevel ?? seed.riskLevel) : seed.riskLevel;
  const llmSemantic = llm.semantic;
  return {
    rawInput: seed.rawInput,
    taskType,
    riskLevel,
    signals,
    semantic: {
      ...seed.semantic,
      ...(canOverride && llmSemantic
        ? {
            intent: llmSemantic.intent,
            permissionMode: llmSemantic.permissionMode,
            userTone: llmSemantic.userTone,
            workstyleSignals: llmSemantic.workstyleSignals,
            domainSignals: llmSemantic.domainSignals,
            toolNeeds: llmSemantic.toolNeeds,
            feedbackSemantics: llmSemantic.feedbackSemantics
          }
        : {}),
      schemaVersion: seed.semantic.schemaVersion,
      taskType,
      riskLevel,
      signals,
      confidence: Math.max(seed.semantic.confidence, llm.confidence ?? 0)
    }
  };
}

async function callEvoMapSignalExtractor(config: EvoMapLlmConfig, input: string, seed: UserInputSignal): Promise<LlmSignalExtraction> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: [
              'You are EvoMate\'s structured signal extractor.',
              'Return ONLY compact JSON. No markdown.',
              'Your job is not to answer the user. Your job is to classify the request for an agent behavior policy engine.',
              'Use the exact internal schema fields when possible.',
              'schemaVersion must be evomate.semantic.v1.',
              'Valid taskType values: coding, product, research, general.',
              'Valid intent values: analysis_before_execution, direct_execution, architecture_planning, frontend_iteration, roadshow_packaging, ml_optimization, research_and_compare, general_help.',
              'Valid riskLevel values: low, medium, high.',
              'Valid permissionMode values: safe_to_execute, ask_before_editing, analysis_only, unknown.',
              'Valid userTone values: direct, impatient, cautious, exploratory, neutral.',
              'Use snake_case signal names. Prefer existing seed signals if correct, add missing ones if useful.',
              'Useful signals include: coding_task, ambiguous_execution_permission, permission_sensitive, user_interruption, high_risk_action, mcp_native, evomap_integration, strategy_discussion, roadshow_planning, rapid_iteration, impatient_user, research_task, external_source_required, visualization_request, architecture_request, ml_policy, yes_engineer, infrastructure.'
            ].join('\n')
          },
          {
            role: 'user',
            content: JSON.stringify({
              input,
              seed_signal_extraction: seed,
              output_schema: {
                schemaVersion: 'evomate.semantic.v1',
                taskType: 'coding | product | research | general',
                intent: 'analysis_before_execution | direct_execution | architecture_planning | frontend_iteration | roadshow_packaging | ml_optimization | research_and_compare | general_help',
                riskLevel: 'low | medium | high',
                permissionMode: 'safe_to_execute | ask_before_editing | analysis_only | unknown',
                userTone: 'direct | impatient | cautious | exploratory | neutral',
                workstyleSignals: ['snake_case_signal'],
                domainSignals: ['snake_case_signal'],
                toolNeeds: ['snake_case_tool_need'],
                feedbackSemantics: null,
                signals: ['snake_case_signal'],
                confidence: 0.0,
                rationale: 'one sentence'
              }
            })
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`evomap_llm_http_${response.status}:${body.slice(0, 160)}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('evomap_llm_empty_response');
    return normalizeExtraction(parseJsonObject(content), seed);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeExtraction(value: Record<string, unknown>, seed: UserInputSignal): LlmSignalExtraction {
  const normalized = normalizeExternalSemantic(value, seed.semantic);
  const semantic = normalized.semantic;

  return {
    source: 'evomap_llm',
    enabled: true,
    used: normalized.ok,
    schemaVersion: semantic.schemaVersion,
    taskType: semantic.taskType,
    riskLevel: semantic.riskLevel,
    intent: semantic.intent,
    tone: semantic.userTone,
    permissionMode: semantic.permissionMode,
    confidence: semantic.confidence,
    signals: [...new Set(semantic.signals.map(normalizeSignalName).filter(Boolean))],
    semantic,
    normalization: {
      ok: normalized.ok,
      acceptedFields: normalized.acceptedFields,
      repairedFields: normalized.repairedFields,
      errors: normalized.errors
    },
    rationale: typeof value.rationale === 'string' ? value.rationale.slice(0, 240) : undefined
  };
}

function parseJsonObject(content: string): Record<string, unknown> {
  const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('evomap_llm_json_not_found');
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function compatibleFallbackKey(): string {
  const key = process.env.EVOMAP_API_KEY || '';
  if (!key || key.startsWith('ek_')) return '';
  return key;
}

function normalizeEvoMapLlmKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.startsWith('sk-evomap-') ? trimmed : `sk-evomap-${trimmed}`;
}

function normalizeSignalName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

function maxRisk(a: UserInputSignal['riskLevel'], b: UserInputSignal['riskLevel']): UserInputSignal['riskLevel'] {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[b] > rank[a] ? b : a;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value.toFixed(4))));
}


export async function maintainNextStepWithEvoMapLlm(state: EvolutionState): Promise<MaintainedNextStepState> {
  const config = getEvoMapLlmConfig();
  const disabled = process.env.EVOMATE_NEXT_STATE_DISABLED === '1'
    || process.env.EVOMATE_NEXT_STATE_DISABLED === 'true'
    || process.env.EVOMAP_LLM_DISABLED === '1'
    || process.env.EVOMAP_LLM_DISABLED === 'true';
  const fallback = buildFallbackNextStep(state, config?.model, Boolean(config) && !disabled);

  if (!config || disabled) {
    return {
      ...fallback,
      enabled: Boolean(config) && !disabled,
      error: config ? 'disabled' : 'missing_api_key'
    };
  }

  try {
    return await callEvoMapNextStepMaintainer(config, state, fallback);
  } catch (err) {
    return {
      ...fallback,
      source: 'evomap_claude',
      used: false,
      enabled: true,
      model: config.model,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

async function callEvoMapNextStepMaintainer(
  config: EvoMapLlmConfig,
  state: EvolutionState,
  fallback: MaintainedNextStepState
): Promise<MaintainedNextStepState> {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.EVOMATE_NEXT_STATE_TIMEOUT_MS || config.timeoutMs);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: [
              'You are EvoMate\'s durable next-step state maintainer.',
              'Return ONLY compact JSON. No markdown.',
              'Your job is not to answer the user. Maintain the assistant evolution state for the next turn.',
              'Use recent events, rewards, GEP writes, and selected genes to decide exactly where the evolution currently is and what should happen next.',
              'Allowed focusNodeId values: root, hook, signal, gene, outcome, gep, behavior.',
              'Allowed stageIndex: 0 Hook/root, 1 Signal, 2 Gene, 3 Reward/outcome, 4 GEP, 5 Next behavior.',
              'Be specific and product-demo friendly. Chinese output is preferred.',
              'Never include secrets, API keys, or private raw payloads. Summarize evidence safely.'
            ].join('\n')
          },
          {
            role: 'user',
            content: JSON.stringify({
              current_state: compactStateForNextStep(state),
              deterministic_fallback: fallback,
              output_schema: {
                stateVersion: 'evomate.next_state.v1',
                focusNodeId: 'root | hook | signal | gene | outcome | gep | behavior',
                stage: 'short stage label',
                stageIndex: 0,
                progressedTo: 'what has evolved so far',
                evidence: 'safe evidence summary from timeline',
                nextStep: 'what the assistant should do/change next',
                mutation: 'behavior mutation summary',
                confidence: 0.0,
                rationale: 'one short sentence',
                visibleEvolution: {
                  before: 'how the assistant behaved before this learning',
                  after: 'how the assistant will behave after this learning',
                  proof: 'why the change is visible in the demo',
                  demoAction: 'one concrete action to show judges next'
                },
                gepAsset: {
                  assetId: 'safe demo id',
                  type: 'Mutation | EvolutionEvent | ValidationReport | ExperienceCapsule',
                  source: 'hook / feedback / terminal / browser / mobile source',
                  trigger: 'what user event caused the asset',
                  mutation: 'behavior rule now stored as EvoMap experience',
                  sharedScope: 'user-private / team-shareable / org-policy-ready',
                  status: 'draft | active | reusable',
                  reuseRule: 'when a future agent should reuse this experience'
                },
                evomapSharing: {
                  mechanism: 'how EvoMap GEP shares/recalls this experience',
                  whyEvoMap: 'why this is more than local prompt memory',
                  nextReuse: 'which future tool/session can reuse it'
                }
              }
            })
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`evomap_next_state_http_${response.status}:${body.slice(0, 160)}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('evomap_next_state_empty_response');
    return normalizeNextStep(parseNextStepJsonish(content), state, config.model, fallback);
  } finally {
    clearTimeout(timer);
  }
}

const NEXT_STEP_JSON_FIELDS = [
  'stateVersion',
  'focusNodeId',
  'stage',
  'stageIndex',
  'progressedTo',
  'evidence',
  'nextStep',
  'mutation',
  'confidence',
  'rationale'
] as const;

function parseNextStepJsonish(content: string): Record<string, unknown> {
  try {
    return parseJsonObject(content);
  } catch (err) {
    const repaired: Record<string, unknown> = {};
    for (const field of NEXT_STEP_JSON_FIELDS) {
      const value = extractJsonishField(content, field);
      if (value !== undefined) repaired[field] = value;
    }
    if (!Object.keys(repaired).length) throw err;
    repaired.rationale ??= 'LLM returned a JSON-ish next-state payload; EvoMate repaired it locally.';
    return repaired;
  }
}

function extractJsonishField(content: string, field: string): string | number | undefined {
  const fieldPattern = NEXT_STEP_JSON_FIELDS.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const quoted = new RegExp(`["']?${field}["']?\\s*:\\s*["']([\\s\\S]*?)["']\\s*(?=,\\s*["']?(?:${fieldPattern})["']?\\s*:|\\s*})`, 'i');
  const quotedMatch = quoted.exec(content);
  if (quotedMatch?.[1] !== undefined) {
    return quotedMatch[1]
      .replace(/\\n/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
  }

  const bare = new RegExp(`["']?${field}["']?\\s*:\\s*([^,}\\n]+)`, 'i');
  const bareMatch = bare.exec(content);
  if (!bareMatch?.[1]) return undefined;
  const value = bareMatch[1].trim().replace(/^["']|["']$/g, '');
  if (field === 'stageIndex' || field === 'confidence') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return value;
}

function normalizeNextStep(
  raw: Record<string, unknown>,
  state: EvolutionState,
  model: string,
  fallback: MaintainedNextStepState
): MaintainedNextStepState {
  const focusNodeId = normalizeFocusNodeId(raw.focusNodeId, fallback.focusNodeId);
  const stageIndex = clampInt(raw.stageIndex, 0, 5, fallback.stageIndex);
  const latest = state.timeline[0];
  return {
    stateVersion: 'evomate.next_state.v1',
    source: 'evomap_claude',
    used: true,
    enabled: true,
    model,
    updatedAt: new Date().toISOString(),
    inputEventId: latest?.id,
    focusNodeId,
    stage: safeString(raw.stage, fallback.stage, 80),
    stageIndex,
    progressedTo: safeString(raw.progressedTo, fallback.progressedTo, 220),
    evidence: safeString(raw.evidence, fallback.evidence, 260),
    nextStep: safeString(raw.nextStep, fallback.nextStep, 260),
    mutation: safeString(raw.mutation, fallback.mutation ?? '', 160) || undefined,
    confidence: typeof raw.confidence === 'number' ? clamp(raw.confidence, 0, 1) : fallback.confidence,
    rationale: safeString(raw.rationale, fallback.rationale ?? '', 160) || undefined,
    visibleEvolution: normalizeVisibleEvolution(raw.visibleEvolution, fallback.visibleEvolution),
    gepAsset: normalizeGepAsset(raw.gepAsset, fallback.gepAsset),
    evomapSharing: normalizeEvomapSharing(raw.evomapSharing, fallback.evomapSharing)
  };
}

function buildFallbackNextStep(state: EvolutionState, model?: string, enabled = false): MaintainedNextStepState {
  const latest = state.timeline[0];
  const text = `${latest?.type || ''} ${latest?.summary || ''} ${(latest?.signals || []).join(' ')}`.toLowerCase();
  const mutation = inferMutationFromState(state);
  const base = {
    stateVersion: 'evomate.next_state.v1' as const,
    source: 'deterministic_fallback' as const,
    used: false,
    enabled,
    model,
    updatedAt: new Date().toISOString(),
    inputEventId: latest?.id,
    confidence: 0.55,
    evidence: latest?.summary ? compactForPrompt(latest.summary, 220) : '暂无事件，等待 hook / feedback / GEP 写入。',
    visibleEvolution: buildVisibleEvolution(mutation, latest?.summary),
    gepAsset: buildGepAsset(state, mutation),
    evomapSharing: buildEvomapSharing(mutation)
  };

  if (/gep_assets_written|remote_job_imported|gep|mutation|evolutionevent/.test(text)) {
    return {
      ...base,
      focusNodeId: 'gep',
      stage: '5 / 6 · 写入 EvoMap/GEP',
      stageIndex: 4,
      progressedTo: '进化资产已经写入 GEP，当前偏好可以在后续相似场景被召回。',
      nextStep: '下一轮遇到相同模式时，优先应用这条 mutation，再选择行为基因。',
      mutation
    };
  }

  if (/remote_job_queued|train|preference_train|embedding_build/.test(text)) {
    return {
      ...base,
      focusNodeId: 'behavior',
      stage: '6 / 6 · 下一步行为',
      stageIndex: 5,
      progressedTo: '训练/评估任务已进入后台队列，下一步状态会根据训练结果调整行为权重。',
      nextStep: '等待训练产物或用户下一次反馈，然后更新 reward、memory 与 behavior gene。',
      mutation: 'refresh policy weights from training feedback'
    };
  }

  if (/advisor_injected|tournament_completed|gene/.test(text)) {
    return {
      ...base,
      focusNodeId: 'gene',
      stage: '3 / 6 · 选择行为基因',
      stageIndex: 2,
      progressedTo: '行为基因已经选出，系统知道下一次应该用哪种 Yes 模式回应。',
      nextStep: '观察用户是否接受结果；如果被纠正，就把纠正写成 GEP mutation。',
      mutation
    };
  }

  if (/semantic_parsed|signal|intent|risk/.test(text)) {
    return {
      ...base,
      focusNodeId: 'signal',
      stage: '2 / 6 · 提取信号',
      stageIndex: 1,
      progressedTo: '用户/工具事件已经被归一化成语义信号。',
      nextStep: '用信号进入 policy/bandit 选择最合适的 behavior gene。',
      mutation
    };
  }

  if (/hook_received|omni_hook_received|hook|browser|mobile|codex|terminal/.test(text)) {
    return {
      ...base,
      focusNodeId: 'hook',
      stage: '1 / 6 · 捕获输入',
      stageIndex: 0,
      progressedTo: '新的用户/工具事件已经进入 EvoMate hook 协议。',
      nextStep: '提取语义信号，并决定是否需要更新行为基因或 GEP 资产。',
      mutation
    };
  }

  return {
    ...base,
    focusNodeId: 'root',
    stage: '全局工作流',
    stageIndex: 0,
    progressedTo: `已经收集 ${state.timeline.length} 条事件，正在维护用户工作流的进化链路。`,
    nextStep: '等待下一条 hook/feedback，然后刷新基因、奖励和 GEP 资产。',
    mutation
  };
}

function compactStateForNextStep(state: EvolutionState): Record<string, unknown> {
  return {
    assistantId: state.assistantId,
    generation: state.generation,
    phase: state.phase,
    understandingScore: state.understandingScore,
    metrics: state.metrics,
    activeGenes: state.activeGenes.slice(0, 6).map((gene) => ({
      id: gene.id,
      label: gene.label,
      weight: gene.weight,
      fitness: gene.fitness,
      signals: gene.signals?.slice(0, 6)
    })),
    recentTimeline: state.timeline.slice(0, 12).map((item) => ({
      id: item.id,
      type: item.type,
      summary: compactForPrompt(item.summary, 180),
      score: item.score,
      geneId: item.geneId,
      signals: item.signals?.slice(0, 8),
      createdAt: item.createdAt
    }))
  };
}

function inferMutationFromState(state: EvolutionState): string {
  const joined = state.timeline.slice(0, 12).map((item) => `${item.type} ${item.summary} ${(item.signals || []).join(' ')}`).join(' ').toLowerCase();
  if (/too_verbose|啰嗦|concise/.test(joined)) return 'reduce verbosity and answer more directly';
  if (/too_slow|太慢|fast/.test(joined)) return 'move faster and execute earlier when safe';
  if (/too_risky|太冒进|risk|ask_before/.test(joined)) return 'ask before risky or irreversible actions';
  if (/git|workspace/.test(joined)) return 'attach workspace context before deciding';
  if (/failed|command_failed|failure/.test(joined)) return 'validate commands before reporting success';
  return 'update behavior gene weights from latest reward';
}

function buildVisibleEvolution(mutation: string, evidence?: string): MaintainedNextStepState['visibleEvolution'] {
  const lower = mutation.toLowerCase();
  if (/verbosity|direct|concise|简洁|直接/.test(lower)) {
    return {
      before: '回答会先解释背景，用户需要再次催促“直接点”。',
      after: '下一轮先给结论和可执行动作，再补必要上下文。',
      proof: 'Graph 中 Gene/Next 节点会显示 Fast Yes 被强化，GEP 资产记录“少废话”。',
      demoAction: '让用户再发一个相似请求，展示回答自动变短。'
    };
  }
  if (/validate|failed|command|failure/.test(lower)) {
    return {
      before: '命令失败后只记录错误，下一次仍可能重复同类风险。',
      after: '下次执行前先验证工作区、依赖和命令参数。',
      proof: 'Terminal failure 会变成 ValidationReport，并点亮 GEP→Next 链路。',
      demoAction: '触发一次失败命令，再展示下一次 advisor 自动加验证步骤。'
    };
  }
  if (/ask|risky|permission|irreversible/.test(lower)) {
    return {
      before: 'Agent 容易在高影响操作前过早执行。',
      after: '遇到写文件、推送、部署等动作时先确认边界。',
      proof: 'Safe Yes 基因权重上升，下一次同类请求会先问一个聚焦问题。',
      demoAction: '输入“帮我推到 GitHub”，展示先确认分支/范围。'
    };
  }
  if (/workspace|git/.test(lower)) {
    return {
      before: 'Agent 只看当前提问，忽略仓库状态和未提交文件。',
      after: '先附带 Git/workspace 变化，再决定回答或执行。',
      proof: 'Local Agent/Git Hook 写入工作区上下文，Graph 根节点显示事件数增长。',
      demoAction: '修改一个文件，展示 Git Workspace hook 自动进入图谱。'
    };
  }
  return {
    before: 'Agent 只按当前模型上下文回答，偏好难以跨工具延续。',
    after: '用户反馈被固化成行为基因，Codex/Gemini/手机端都能复用。',
    proof: evidence ? compactForPrompt(evidence, 120) : 'Hook→Reward→GEP→Next 链路会在图上持续点亮。',
    demoAction: '发送一条反馈，观察 GEP Asset 卡片生成并改变下一步行为。'
  };
}

function buildGepAsset(state: EvolutionState, mutation: string): NonNullable<MaintainedNextStepState['gepAsset']> {
  const latest = state.timeline[0];
  const joined = state.timeline.slice(0, 8).map((item) => `${item.type} ${item.summary}`).join(' ').toLowerCase();
  const type: NonNullable<MaintainedNextStepState['gepAsset']>['type'] = /validation|command_failed|failed/.test(joined)
    ? 'ValidationReport'
    : /feedback|corrected|interrupted|gep_assets_written|mutation/.test(joined)
      ? 'Mutation'
      : /advisor|semantic|tournament/.test(joined)
        ? 'EvolutionEvent'
        : 'ExperienceCapsule';
  const status: NonNullable<MaintainedNextStepState['gepAsset']>['status'] = /gep_assets_written|remote_job_imported/.test(joined)
    ? 'reusable'
    : /feedback|corrected|accepted|interrupted|outcome/.test(joined)
      ? 'active'
      : 'draft';
  return {
    assetId: `gep_${type.toLowerCase()}_${(latest?.id || 'seed').replace(/[^a-z0-9]+/gi, '_').slice(-18)}`,
    type,
    source: latest?.type ? compactForPrompt(latest.type, 60) : 'waiting_hook',
    trigger: latest?.summary ? compactForPrompt(latest.summary, 120) : '等待用户真实工作流事件进入 Hook 协议。',
    mutation,
    sharedScope: status === 'draft' ? 'user-private draft' : 'user-private · team-shareable after review',
    status,
    reuseRule: `当未来事件再次匹配「${compactForPrompt(mutation, 56)}」时，先召回这条经验再选择行为基因。`
  };
}

function buildEvomapSharing(mutation: string): NonNullable<MaintainedNextStepState['evomapSharing']> {
  return {
    mechanism: 'Hook/Feedback 被标准化为 EvolutionEvent，reward 触发 Mutation，最终沉淀成 GEP 资产。',
    whyEvoMap: '它不是本地 prompt 记忆，而是可迁移、可共享、可验证的经验对象。',
    nextReuse: `Codex、Claude Code、Gemini 或手机端下一次遇到相似信号时复用：${compactForPrompt(mutation, 80)}。`
  };
}

function normalizeVisibleEvolution(
  value: unknown,
  fallback: MaintainedNextStepState['visibleEvolution']
): MaintainedNextStepState['visibleEvolution'] {
  if (!isRecord(value)) return fallback;
  return {
    before: safeString(value.before, fallback?.before ?? '进化前行为未记录。', 180),
    after: safeString(value.after, fallback?.after ?? '进化后行为待观察。', 180),
    proof: safeString(value.proof, fallback?.proof ?? '等待 hook/feedback 证明行为变化。', 180),
    demoAction: safeString(value.demoAction, fallback?.demoAction ?? '发送下一条相似请求查看变化。', 160)
  };
}

function normalizeGepAsset(value: unknown, fallback: MaintainedNextStepState['gepAsset']): MaintainedNextStepState['gepAsset'] {
  if (!isRecord(value)) return fallback;
  const type = normalizeOneOf(value.type, ['Mutation', 'EvolutionEvent', 'ValidationReport', 'ExperienceCapsule'] as const, fallback?.type ?? 'Mutation');
  const status = normalizeOneOf(value.status, ['draft', 'active', 'reusable'] as const, fallback?.status ?? 'draft');
  return {
    assetId: safeString(value.assetId, fallback?.assetId ?? 'gep_pending_asset', 80),
    type,
    source: safeString(value.source, fallback?.source ?? 'unknown_source', 80),
    trigger: safeString(value.trigger, fallback?.trigger ?? '等待触发事件。', 160),
    mutation: safeString(value.mutation, fallback?.mutation ?? 'update behavior gene weights from feedback', 160),
    sharedScope: safeString(value.sharedScope, fallback?.sharedScope ?? 'user-private', 100),
    status,
    reuseRule: safeString(value.reuseRule, fallback?.reuseRule ?? '匹配相似场景时召回。', 200)
  };
}

function normalizeEvomapSharing(value: unknown, fallback: MaintainedNextStepState['evomapSharing']): MaintainedNextStepState['evomapSharing'] {
  if (!isRecord(value)) return fallback;
  return {
    mechanism: safeString(value.mechanism, fallback?.mechanism ?? 'Hook→Reward→Mutation→GEP', 180),
    whyEvoMap: safeString(value.whyEvoMap, fallback?.whyEvoMap ?? '把经验变成可共享资产。', 180),
    nextReuse: safeString(value.nextReuse, fallback?.nextReuse ?? '下一次相似场景复用。', 180)
  };
}

function normalizeOneOf<const T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T[number] : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFocusNodeId(value: unknown, fallback: MaintainedNextStepState['focusNodeId']): MaintainedNextStepState['focusNodeId'] {
  const allowed = new Set(['root', 'hook', 'signal', 'gene', 'outcome', 'gep', 'behavior']);
  return typeof value === 'string' && allowed.has(value) ? value as MaintainedNextStepState['focusNodeId'] : fallback;
}

function safeString(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value : fallback;
  return compactForPrompt(text, maxLength);
}

function compactForPrompt(value: string, maxLength: number): string {
  const text = value.replace(/sk-[a-z0-9_-]+/gi, '[redacted-key]').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}
