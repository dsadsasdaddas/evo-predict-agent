import {
  SEMANTIC_SCHEMA_VERSION,
  type FeedbackSemantics,
  type PermissionMode,
  type SemanticIntent,
  type SemanticParseResult,
  type SemanticRiskLevel,
  type SemanticTaskType,
  type UserTone
} from './semantic.js';

export interface SemanticNormalizationResult {
  ok: boolean;
  semantic: SemanticParseResult;
  acceptedFields: string[];
  repairedFields: string[];
  errors: string[];
  raw: Record<string, unknown>;
}

export function normalizeExternalSemantic(
  raw: Record<string, unknown>,
  seed: SemanticParseResult
): SemanticNormalizationResult {
  const acceptedFields: string[] = [];
  const repairedFields: string[] = [];
  const errors: string[] = [];

  const taskType = normalizeEnumField<SemanticTaskType>({
    raw,
    keys: ['taskType', 'task_type', 'task', 'task_type_hint'],
    aliases: TASK_TYPE_ALIASES,
    fallback: seed.taskType,
    fieldName: 'taskType',
    acceptedFields,
    repairedFields,
    errors
  });
  const intent = normalizeEnumField<SemanticIntent>({
    raw,
    keys: ['intent', 'semanticIntent', 'semantic_intent', 'goal'],
    aliases: INTENT_ALIASES,
    fallback: inferIntentAlias(stringFromAny(readFirst(raw, ['intent', 'semanticIntent', 'semantic_intent', 'goal']))) ?? seed.intent,
    fieldName: 'intent',
    acceptedFields,
    repairedFields,
    errors
  });
  const riskLevel = normalizeEnumField<SemanticRiskLevel>({
    raw,
    keys: ['riskLevel', 'risk_level', 'risk', 'risk_level_hint'],
    aliases: RISK_LEVEL_ALIASES,
    fallback: seed.riskLevel,
    fieldName: 'riskLevel',
    acceptedFields,
    repairedFields,
    errors
  });
  const permissionMode = normalizeEnumField<PermissionMode>({
    raw,
    keys: ['permissionMode', 'permission_mode', 'permission', 'executionPermission'],
    aliases: PERMISSION_ALIASES,
    fallback: seed.permissionMode,
    fieldName: 'permissionMode',
    acceptedFields,
    repairedFields,
    errors
  });
  const userTone = normalizeEnumField<UserTone>({
    raw,
    keys: ['userTone', 'user_tone', 'tone', 'user_tone_hint'],
    aliases: USER_TONE_ALIASES,
    fallback: seed.userTone,
    fieldName: 'userTone',
    acceptedFields,
    repairedFields,
    errors
  });
  const confidence = normalizeConfidence(
    readFirst(raw, ['confidence', 'score', 'semanticConfidence', 'semantic_confidence']),
    seed.confidence,
    acceptedFields,
    repairedFields,
    errors
  );

  const signals = normalizeStringArray(
    readFirst(raw, ['signals', 'signal', 'domain_signals', 'domainSignals']),
    'signals',
    acceptedFields,
    repairedFields,
    errors
  );
  const workstyleSignals = normalizeStringArray(
    readFirst(raw, ['workstyleSignals', 'workstyle_signals', 'styleSignals', 'style_signals']),
    'workstyleSignals',
    acceptedFields,
    repairedFields,
    errors
  );
  const domainSignals = normalizeStringArray(
    readFirst(raw, ['domainSignals', 'domain_signals', 'domains']),
    'domainSignals',
    acceptedFields,
    repairedFields,
    errors
  );
  const toolNeeds = normalizeStringArray(
    readFirst(raw, ['toolNeeds', 'tool_needs', 'tools', 'toolHints', 'tool_hints']),
    'toolNeeds',
    acceptedFields,
    repairedFields,
    errors
  );
  const feedbackSemantics = normalizeFeedbackSemantics(
    readFirst(raw, ['feedbackSemantics', 'feedback_semantics', 'feedback']),
    seed.feedbackSemantics,
    acceptedFields,
    repairedFields,
    errors
  );

  const semantic: SemanticParseResult = {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    rawInput: seed.rawInput,
    taskType,
    intent,
    riskLevel,
    permissionMode,
    userTone,
    workstyleSignals: mergeUnique(seed.workstyleSignals, workstyleSignals),
    domainSignals: mergeUnique(seed.domainSignals, domainSignals),
    toolNeeds: mergeUnique(seed.toolNeeds, toolNeeds),
    feedbackSemantics,
    signals: mergeUnique(seed.signals, signals),
    confidence
  };

  return {
    ok: errors.length === 0 || acceptedFields.length > 0 || repairedFields.length > 0,
    semantic,
    acceptedFields,
    repairedFields,
    errors,
    raw
  };
}

function normalizeEnumField<T extends string>(input: {
  raw: Record<string, unknown>;
  keys: string[];
  aliases: Record<string, T>;
  fallback: T;
  fieldName: string;
  acceptedFields: string[];
  repairedFields: string[];
  errors: string[];
}): T {
  const value = readFirst(input.raw, input.keys);
  if (typeof value !== 'string') return input.fallback;
  const normalized = normalizeAliasKey(value);
  const mapped = input.aliases[normalized];
  if (mapped) {
    if (mapped === value) input.acceptedFields.push(input.fieldName);
    else input.repairedFields.push(input.fieldName);
    return mapped;
  }
  input.errors.push(`invalid_${input.fieldName}:${value.slice(0, 80)}`);
  return input.fallback;
}

function normalizeConfidence(
  value: unknown,
  fallback: number,
  acceptedFields: string[],
  repairedFields: string[],
  errors: string[]
): number {
  if (value === undefined || value === null) return fallback;
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(raw)) {
    errors.push('invalid_confidence');
    return fallback;
  }
  const scaled = raw > 1 && raw <= 100 ? raw / 100 : raw;
  const confidence = clamp(scaled, 0, 1);
  if (confidence !== raw) repairedFields.push('confidence');
  else acceptedFields.push('confidence');
  return confidence;
}

function normalizeStringArray(
  value: unknown,
  fieldName: string,
  acceptedFields: string[],
  repairedFields: string[],
  errors: string[]
): string[] {
  if (value === undefined || value === null) return [];
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，\s]+/)
      : [];
  if (!rawItems.length && value !== undefined) {
    errors.push(`invalid_${fieldName}`);
    return [];
  }
  const normalized = rawItems
    .map((item) => typeof item === 'string' ? normalizeSignalName(item) : '')
    .filter(Boolean);
  if (normalized.length) {
    const allString = Array.isArray(value) ? value.every((item) => typeof item === 'string') : typeof value === 'string';
    (allString ? acceptedFields : repairedFields).push(fieldName);
  }
  return [...new Set(normalized)];
}

function normalizeFeedbackSemantics(
  value: unknown,
  fallback: FeedbackSemantics | null,
  acceptedFields: string[],
  repairedFields: string[],
  errors: string[]
): FeedbackSemantics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const sentiment = normalizeAliasKey(stringFromAny(record.sentiment));
  const sentimentMap: Record<string, FeedbackSemantics['sentiment']> = {
    positive: 'positive',
    negative: 'negative',
    mixed: 'mixed',
    neutral: 'neutral',
    good: 'positive',
    bad: 'negative'
  };
  const normalizedSentiment = sentimentMap[sentiment];
  if (!normalizedSentiment) {
    errors.push('invalid_feedbackSemantics.sentiment');
    return fallback;
  }
  const rewardHint = typeof record.rewardHint === 'number'
    ? record.rewardHint
    : typeof record.reward_hint === 'number'
      ? record.reward_hint
      : normalizedSentiment === 'positive'
        ? 0.75
        : normalizedSentiment === 'negative'
          ? -0.65
          : 0;
  acceptedFields.push('feedbackSemantics');
  if ('reward_hint' in record) repairedFields.push('feedbackSemantics.rewardHint');
  return {
    sentiment: normalizedSentiment,
    correctionType: normalizeCorrectionType(record.correctionType ?? record.correction_type),
    rewardHint: clamp(rewardHint, -1, 1)
  };
}

function normalizeCorrectionType(value: unknown): FeedbackSemantics['correctionType'] | undefined {
  const key = normalizeAliasKey(stringFromAny(value));
  const map: Record<string, FeedbackSemantics['correctionType']> = {
    wrong_intent: 'wrong_intent',
    wrong: 'wrong_intent',
    too_fast: 'too_fast',
    too_verbose: 'too_verbose',
    verbose: 'too_verbose',
    layout_mismatch: 'layout_mismatch',
    visual_mismatch: 'layout_mismatch',
    execution_mismatch: 'execution_mismatch',
    permission_mismatch: 'execution_mismatch'
  };
  return map[key];
}

function readFirst(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in raw) return raw[key];
  }
  return undefined;
}

function stringFromAny(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeAliasKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function normalizeSignalName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

function inferIntentAlias(value: string): SemanticIntent | undefined {
  const key = normalizeAliasKey(value);
  if (!key) return undefined;
  if (/analysis|inspect|plan|ask|confirm|look|review/.test(key)) return 'analysis_before_execution';
  if (/direct|execute|build|implement|run/.test(key)) return 'direct_execution';
  if (/arch|system|workflow|mcp|integration/.test(key)) return 'architecture_planning';
  if (/front|ui|layout|visual/.test(key)) return 'frontend_iteration';
  if (/roadshow|pitch|demo|market/.test(key)) return 'roadshow_packaging';
  if (/ml|train|reward|policy|model|preference/.test(key)) return 'ml_optimization';
  if (/research|search|compare|investigate/.test(key)) return 'research_and_compare';
  return 'general_help';
}

function mergeUnique(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value.toFixed(4))));
}

const TASK_TYPE_ALIASES: Record<string, SemanticTaskType> = {
  coding: 'coding',
  code: 'coding',
  programming: 'coding',
  repo: 'coding',
  repository: 'coding',
  engineering: 'coding',
  product: 'product',
  product_design: 'product',
  business: 'product',
  market: 'product',
  roadshow: 'product',
  research: 'research',
  search: 'research',
  browse: 'research',
  investigation: 'research',
  general: 'general',
  chat: 'general',
  unknown: 'general'
};

const RISK_LEVEL_ALIASES: Record<string, SemanticRiskLevel> = {
  low: 'low',
  safe: 'low',
  medium: 'medium',
  med: 'medium',
  moderate: 'medium',
  high: 'high',
  danger: 'high',
  dangerous: 'high',
  risky: 'high',
  high_risk: 'high'
};

const PERMISSION_ALIASES: Record<string, PermissionMode> = {
  safe_to_execute: 'safe_to_execute',
  execute_allowed: 'safe_to_execute',
  execution_allowed: 'safe_to_execute',
  allowed: 'safe_to_execute',
  ask_before_editing: 'ask_before_editing',
  ask_first: 'ask_before_editing',
  confirm_before_editing: 'ask_before_editing',
  needs_confirmation: 'ask_before_editing',
  analysis_only: 'analysis_only',
  readonly: 'analysis_only',
  read_only: 'analysis_only',
  no_edit: 'analysis_only',
  do_not_execute: 'analysis_only',
  unknown: 'unknown',
  unclear: 'unknown'
};

const USER_TONE_ALIASES: Record<string, UserTone> = {
  direct: 'direct',
  impatient: 'impatient',
  urgent: 'impatient',
  frustrated: 'impatient',
  cautious: 'cautious',
  careful: 'cautious',
  corrective: 'cautious',
  exploratory: 'exploratory',
  curious: 'exploratory',
  neutral: 'neutral',
  normal: 'neutral'
};

const INTENT_ALIASES: Record<string, SemanticIntent> = {
  analysis_before_execution: 'analysis_before_execution',
  analyze_first: 'analysis_before_execution',
  inspect_first: 'analysis_before_execution',
  ask_before_execution: 'analysis_before_execution',
  direct_execution: 'direct_execution',
  execute: 'direct_execution',
  build: 'direct_execution',
  implement: 'direct_execution',
  architecture_planning: 'architecture_planning',
  architecture: 'architecture_planning',
  system_design: 'architecture_planning',
  frontend_iteration: 'frontend_iteration',
  frontend: 'frontend_iteration',
  ui_iteration: 'frontend_iteration',
  roadshow_packaging: 'roadshow_packaging',
  roadshow: 'roadshow_packaging',
  pitch: 'roadshow_packaging',
  ml_optimization: 'ml_optimization',
  machine_learning: 'ml_optimization',
  training: 'ml_optimization',
  research_and_compare: 'research_and_compare',
  research: 'research_and_compare',
  compare: 'research_and_compare',
  general_help: 'general_help',
  general: 'general_help'
};
