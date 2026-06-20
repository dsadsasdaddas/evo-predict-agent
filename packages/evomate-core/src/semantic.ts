export type SemanticTaskType = 'coding' | 'product' | 'research' | 'general';
export const SEMANTIC_SCHEMA_VERSION = 'evomate.semantic.v1' as const;
export type SemanticIntent =
  | 'analysis_before_execution'
  | 'direct_execution'
  | 'architecture_planning'
  | 'frontend_iteration'
  | 'roadshow_packaging'
  | 'ml_optimization'
  | 'research_and_compare'
  | 'general_help';
export type SemanticRiskLevel = 'low' | 'medium' | 'high';
export type PermissionMode = 'safe_to_execute' | 'ask_before_editing' | 'analysis_only' | 'unknown';
export type UserTone = 'direct' | 'impatient' | 'cautious' | 'exploratory' | 'neutral';

export interface FeedbackSemantics {
  sentiment: 'positive' | 'negative' | 'mixed' | 'neutral';
  correctionType?: 'wrong_intent' | 'too_fast' | 'too_verbose' | 'layout_mismatch' | 'execution_mismatch';
  rewardHint: number;
}

export interface SemanticParseResult {
  schemaVersion: typeof SEMANTIC_SCHEMA_VERSION;
  rawInput: string;
  taskType: SemanticTaskType;
  intent: SemanticIntent;
  riskLevel: SemanticRiskLevel;
  permissionMode: PermissionMode;
  userTone: UserTone;
  workstyleSignals: string[];
  domainSignals: string[];
  toolNeeds: string[];
  feedbackSemantics: FeedbackSemantics | null;
  signals: string[];
  confidence: number;
}

export function parseSemantics(rawInput: string): SemanticParseResult {
  const lower = rawInput.toLowerCase();
  const workstyleSignals = new Set<string>();
  const domainSignals = new Set<string>();
  const toolNeeds = new Set<string>();
  const signals = new Set<string>();

  const hasCoding = /代码|repo|仓库|github|codex|claude code|cursor|cli|hook|sidecar|api|接口|端点|前端|后端|环境|部署|文件|改/i.test(rawInput);
  const hasProduct = /痛点|市场|产品|路演|场景|商业|方向|评委|黑客松|pitch|demo/i.test(rawInput);
  const hasResearch = /查|搜索|研究|官网|调查|资料|最新|compare|research/i.test(rawInput);
  const hasFrontend = /前端|界面|ui|视觉|布局|好看|科技感|dashboard|browser/i.test(lower);
  const hasArchitecture = /架构|系统|流程|图|画|mcp|hook|sidecar|接入|集成|integration|工具流|workflow|语义|semantic/i.test(lower);
  const hasML = /机器学习|ml|算法|bandit|reward|奖励|训练|模型|preference|embedding/i.test(lower);
  const hasEvoMap = /evomap|gep|gene|capsule|进化|mutation|validation/i.test(lower);
  const hasInfrastructure = /hook|sidecar|api|接口|端点|集成|接入|编排|orchestrator|runtime|server/i.test(lower);
  const hasDirect = /继续|直接|开始|搞|做一下|拉起|跑|推|部署|改/.test(rawInput);
  const hasCaution = /先|看看|分析|讲|解释|别|不要|没叫你|你干啥|乱动|不能|不许/.test(rawInput);
  const hasNegative = /不是|不对|丑|错|你干啥|别乱动|太像|难看|不行/.test(rawInput);
  const hasPositive = /好的|可以|对|继续|就这样|yes|ok/i.test(rawInput);

  if (hasCoding) {
    signals.add('coding_task');
    toolNeeds.add('repo_inspection');
  }
  if (hasFrontend) {
    signals.add('visualization_request');
    toolNeeds.add('frontend_iteration');
  }
  if (hasProduct) {
    signals.add('strategy_discussion');
    domainSignals.add('roadshow');
  }
  if (/路演|pitch|demo|评委|黑客松/i.test(rawInput)) {
    signals.add('roadshow_planning');
    toolNeeds.add('roadshow_packaging');
  }
  if (hasResearch) {
    signals.add('research_task');
    signals.add('external_source_required');
    toolNeeds.add('web_research');
  }
  if (hasArchitecture) {
    signals.add('architecture_request');
    toolNeeds.add('architecture_mapping');
  }
  if (hasInfrastructure) {
    signals.add('infrastructure');
    domainSignals.add('agent_runtime');
    toolNeeds.add('host_integration');
  }
  if (hasML) {
    signals.add('ml_policy');
    domainSignals.add('ml_policy');
  }
  if (hasEvoMap) {
    signals.add('evomap_integration');
    domainSignals.add('evomap');
  }
  if (/mcp|模型上下文协议/i.test(rawInput)) {
    signals.add('mcp_native');
    domainSignals.add('mcp');
    toolNeeds.add('mcp_host_integration');
  }
  if (hasDirect) {
    signals.add('rapid_iteration');
    workstyleSignals.add('wants_forward_progress');
  }
  if (hasCaution) {
    signals.add('ambiguous_execution_permission');
    signals.add('permission_sensitive');
    workstyleSignals.add('prefers_analysis_before_execution');
  }
  if (/别废话|快|啥几把|搞快点/.test(rawInput)) {
    signals.add('impatient_user');
    workstyleSignals.add('prefers_concise_direct_output');
  }
  if (/push|rm |删除|覆盖|reset|安装|deploy|生产/.test(lower)) {
    signals.add('high_risk_action');
    toolNeeds.add('execution_gate');
  }
  if (hasNegative) {
    signals.add('user_interruption');
    workstyleSignals.add('negative_correction_observed');
  }
  if (hasPositive) {
    workstyleSignals.add('positive_acceptance_observed');
  }

  const taskType: SemanticTaskType = hasCoding
    ? 'coding'
    : hasProduct
      ? 'product'
      : hasResearch
        ? 'research'
        : 'general';

  const intent: SemanticIntent = hasCaution
    ? 'analysis_before_execution'
    : hasFrontend
      ? 'frontend_iteration'
      : /路演|pitch|demo|评委|黑客松/i.test(rawInput)
        ? 'roadshow_packaging'
        : hasML
          ? 'ml_optimization'
          : hasArchitecture
            ? 'architecture_planning'
            : hasResearch
              ? 'research_and_compare'
              : hasDirect
                ? 'direct_execution'
                : 'general_help';

  const riskLevel: SemanticRiskLevel = signals.has('high_risk_action')
    ? 'high'
    : hasCoding || hasCaution
      ? 'medium'
      : 'low';

  const permissionMode: PermissionMode = hasCaution
    ? /别|不要|没叫你|乱动|不能|不许/.test(rawInput)
      ? 'analysis_only'
      : 'ask_before_editing'
    : hasDirect
      ? 'safe_to_execute'
      : 'unknown';

  const userTone: UserTone = /别废话|快|啥几把|搞快点/.test(rawInput)
    ? 'impatient'
    : hasCaution
      ? 'cautious'
      : hasProduct || hasML || hasArchitecture
        ? 'exploratory'
        : /好的|继续|直接|开始/.test(rawInput)
          ? 'direct'
          : 'neutral';

  const feedbackSemantics = inferFeedbackSemantics(rawInput);
  const confidence = scoreConfidence(signals.size, workstyleSignals.size, domainSignals.size, toolNeeds.size);

  return {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    rawInput,
    taskType,
    intent,
    riskLevel,
    permissionMode,
    userTone,
    workstyleSignals: [...workstyleSignals],
    domainSignals: [...domainSignals],
    toolNeeds: [...toolNeeds],
    feedbackSemantics,
    signals: [...signals],
    confidence
  };
}

function inferFeedbackSemantics(rawInput: string): FeedbackSemantics | null {
  const positive = /好的|可以|对|继续|就这样|yes|ok/i.test(rawInput);
  const negative = /不是|不对|丑|错|你干啥|别乱动|太像|难看|不行/.test(rawInput);
  if (!positive && !negative) return null;

  const correctionType = /太像|布局|丑|难看|视觉/.test(rawInput)
    ? 'layout_mismatch'
    : /别乱动|你干啥|没叫你/.test(rawInput)
      ? 'execution_mismatch'
      : /不是|不对|错/.test(rawInput)
        ? 'wrong_intent'
        : undefined;

  return {
    sentiment: positive && negative ? 'mixed' : positive ? 'positive' : 'negative',
    correctionType,
    rewardHint: positive && !negative ? 0.75 : negative ? -0.65 : 0
  };
}

function scoreConfidence(signalCount: number, workstyleCount: number, domainCount: number, toolCount: number): number {
  const score = 0.42 + Math.min(signalCount, 6) * 0.055 + Math.min(workstyleCount, 3) * 0.06 + Math.min(domainCount, 3) * 0.05 + Math.min(toolCount, 3) * 0.04;
  return Math.max(0.35, Math.min(0.92, Number(score.toFixed(2))));
}
