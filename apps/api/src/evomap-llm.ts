import { normalizeExternalSemantic, type SemanticNormalizationResult, type SemanticParseResult, type UserInputSignal } from '@evomate/core';

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

const LLM_OVERRIDE_CONFIDENCE = 0.55;

export function getEvoMapLlmConfig(): EvoMapLlmConfig | null {
  const rawKey = process.env.EVOMAP_LLM_API_KEY || process.env.EVOMAP_OPENAI_API_KEY || compatibleFallbackKey();
  if (!rawKey) return null;

  return {
    baseUrl: trimSlash(process.env.EVOMAP_LLM_BASE_URL || 'https://api.evomap.ai/v1'),
    apiKey: normalizeEvoMapLlmKey(rawKey),
    model: process.env.EVOMAP_LLM_MODEL || 'evomap-claude-opus-4-7',
    timeoutMs: Number(process.env.EVOMAP_LLM_TIMEOUT_MS || 12000)
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
        temperature: 0,
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
