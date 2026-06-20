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
  state?: EvolutionState;
};

export type FeedbackKind = 'accepted' | 'corrected' | 'interrupted' | 'rejected' | 'manual_score';

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
