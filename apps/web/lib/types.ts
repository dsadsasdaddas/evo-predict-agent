export type LiveStatus = 'connecting' | 'live' | 'offline';

export type EvolutionTimelineItem = {
  id: string;
  type: string;
  summary: string;
  score?: number;
  createdAt: string;
  geneId?: string;
  signals?: string[];
};


export type MaintainedNextStep = {
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
};

export type EvolutionState = {
  assistantId?: string;
  generation?: number;
  phase?: string;
  understandingScore?: number;
  activeGenes?: Record<string, number> | Array<Record<string, unknown>>;
  metrics?: {
    yesnessScore?: number;
    averageReward?: number;
    interactionCount?: number;
    acceptedCount?: number;
    correctionCount?: number;
    interruptionCount?: number;
    rejectionCount?: number;
    undoCount?: number;
    acceptanceRate?: number;
    correctionRate?: number;
    interruptionRate?: number;
  };
  timeline?: EvolutionTimelineItem[];
  nextStep?: MaintainedNextStep;
};

export type MemoryExpertId = 'episodic' | 'procedural' | 'validation' | 'repo' | 'preference' | 'policy';

export type MemoryRecall = {
  id: string;
  type: MemoryExpertId | 'failure';
  title: string;
  body: string;
  source: string;
  confidence: number;
};

export type MemoryExpertRoute = {
  id: MemoryExpertId;
  label: string;
  role: string;
  score: number;
  status: 'active' | 'ready' | 'cold';
  evidence: string;
  signals: string[];
  memories: MemoryRecall[];
};

export type MemoryRouteResponse = {
  ok: boolean;
  schemaVersion: 'evomate.memory_router.v1';
  mode: 'engineering_moe';
  activeExpert: MemoryExpertId;
  confidence: number;
  experts: MemoryExpertRoute[];
  recalledMemories: MemoryRecall[];
  routePlan: string[];
  gepProof: {
    genes: number;
    capsules: number;
    events: number;
    latestAsset?: string;
    validationReady: boolean;
  };
  latestEventId?: string;
  generatedAt: string;
};

export type EvolutionResultResponse = {
  ok: boolean;
  schemaVersion: 'evomate.evolution_result.v1';
  generatedAt: string;
  maintainedBy: 'evomap_claude' | 'deterministic_fallback' | 'missing';
  usedClaude: boolean;
  enabled: boolean;
  model?: string;
  mode: 'live_proof' | 'ready';
  latestEventId?: string;
  before: {
    title: string;
    body: string;
    score: number;
  };
  feedback: {
    text: string;
    eventId?: string;
    score?: number;
  };
  mutation: {
    text: string;
    eventId?: string;
    asset?: MaintainedNextStep['gepAsset'];
  };
  after: {
    title: string;
    body: string;
    score: number;
  };
  nextAdvisor: string;
  demoAction: string;
  proof: Array<{ label: string; value: string; ok: boolean }>;
  evomapSharing?: MaintainedNextStep['evomapSharing'];
  nextStep?: MaintainedNextStep;
};

export type RemoteJob = {
  jobId: string;
  type: string;
  status: string;
  objective?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  mode?: string;
  datasetPath?: string;
  artifactPath?: string;
  artifactSummary?: {
    generatedFiles?: string[];
    validationScore?: number;
    suggestedMutationCount?: number;
    evolutionBundleId?: string;
  };
  target?: { host?: string; port?: number; user?: string; executeRemote?: boolean };
};

export type EvolutionHistory = {
  ok: boolean;
  totalTimeline?: number;
  count?: number;
  timeline?: EvolutionTimelineItem[];
  jobs?: RemoteJob[];
};

export type SemanticResult = {
  taskType?: string;
  intent?: string;
  riskLevel?: string;
  permissionMode?: string;
  userTone?: string;
  confidence?: number;
  signals?: string[];
  workstyleSignals?: string[];
  domainSignals?: string[];
  toolNeeds?: string[];
};

export type AnalyzeResponse = {
  semantic?: SemanticResult;
  signal?: {
    taskType?: string;
    riskLevel?: string;
    signals?: string[];
    semantic?: SemanticResult;
  };
  gene?: { id?: string; label?: string; title?: string };
  policyDecision?: {
    predictedYesness?: number;
    selectedGene?: { id?: string; label?: string; title?: string };
  };
  trainedModelInsight?: Record<string, unknown>;
  predictedSatisfaction?: number;
  memoryRoute?: Partial<MemoryRouteResponse>;
  state?: EvolutionState;
};

export type FeedbackKind = 'accepted' | 'corrected' | 'interrupted' | 'rejected' | 'undo' | 'manual_score';

export type FeedbackResponse = {
  ok: boolean;
  reward?: { reward?: number; yesness?: number; value?: number };
  gepAssets?: { written?: Array<{ type?: string; id?: string; asset_id?: string }> };
  state?: EvolutionState;
};

export type TrainResponse = {
  ok: boolean;
  action?: 'train_queued' | 'train_reused';
  reused?: boolean;
  job?: RemoteJob;
  jobId?: string;
  type?: string;
  status?: string;
  mode?: string;
  datasetPath?: string;
  manifestPath?: string;
  stateSummary?: Record<string, unknown>;
};
