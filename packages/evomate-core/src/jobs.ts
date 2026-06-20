export type RemoteJobType = 'policy_replay_eval' | 'evolution_gym_eval' | 'preference_train' | 'embedding_build';
export type RemoteJobStatus = 'draft' | 'queued' | 'syncing' | 'running' | 'completed' | 'failed' | 'imported';

export interface RemoteComputeTarget {
  host: string;
  port: number;
  user: string;
  sshKey?: string;
  rootDir: string;
  repoDir: string;
  pythonBin: string;
  executeRemote: boolean;
}

export interface RemoteEvolutionJobInput {
  type: RemoteJobType;
  objective?: string;
  source?: string;
  executeRemote?: boolean;
  datasetPath?: string;
  metadata?: Record<string, unknown>;
}

export interface RemoteEvolutionJob {
  jobId: string;
  type: RemoteJobType;
  status: RemoteJobStatus;
  objective: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  datasetPath: string;
  artifactPath: string;
  target: RemoteComputeTarget;
  pipeline: RemotePipelineStep[];
  metadata: Record<string, unknown>;
  remotePlan: RemoteCommandPlan;
  error?: string;
  importedAt?: string;
  artifactSummary?: RemoteArtifactSummary;
}

export interface RemotePipelineStep {
  id: string;
  label: string;
  runtime: 'typescript_api' | 'ssh_transport' | 'python_worker' | 'gpu_optional' | 'gep_import';
  status: 'planned' | 'active' | 'done' | 'blocked';
  description: string;
}

export interface RemoteCommandPlan {
  bootstrap: string[];
  sync: string[];
  submit: string[];
  poll: string[];
  import: string[];
}

export interface RemoteJobDataset {
  schema: 'evomate.remote_job_dataset.v1';
  jobId: string;
  createdAt: string;
  objective: string;
  samples: Array<Record<string, unknown>>;
  stateSnapshot?: Record<string, unknown>;
  policySnapshot?: Record<string, unknown>;
}

export interface RemoteArtifactSummary {
  status: RemoteJobStatus;
  generatedFiles: string[];
  bestCandidate?: string;
  validationScore?: number;
  suggestedMutationCount?: number;
  evolutionBundleId?: string;
}

export interface RemoteWorkerArtifact {
  status?: { status?: string; updated_at?: string; error?: string };
  policyEval?: Record<string, unknown>;
  validationReport?: Record<string, unknown>;
  suggestedMutations?: unknown[];
  evolutionBundle?: Record<string, unknown>;
  preferenceModel?: Record<string, unknown>;
  policyModel?: Record<string, unknown>;
  embeddingIndex?: Record<string, unknown>;
}

export function createRemoteEvolutionJob(input: RemoteEvolutionJobInput, target: RemoteComputeTarget): RemoteEvolutionJob {
  const now = new Date().toISOString();
  const jobId = createJobId(input.type);
  const objective = input.objective?.trim() || defaultObjective(input.type);
  const datasetPath = input.datasetPath || `memory/evomate/remote-jobs/${jobId}/dataset.json`;
  const artifactPath = `memory/evomate/remote-artifacts/${jobId}`;
  const job: RemoteEvolutionJob = {
    jobId,
    type: input.type,
    status: 'queued',
    objective,
    source: input.source || 'evomate-api',
    createdAt: now,
    updatedAt: now,
    datasetPath,
    artifactPath,
    target: { ...target, executeRemote: input.executeRemote ?? target.executeRemote },
    pipeline: pipelineForJob(input.type),
    metadata: input.metadata ?? {},
    remotePlan: { bootstrap: [], sync: [], submit: [], poll: [], import: [] }
  };
  return { ...job, remotePlan: buildRemoteCommandPlan(job) };
}

export function buildRemoteJobDataset(input: {
  job: RemoteEvolutionJob;
  stateSnapshot?: Record<string, unknown>;
  samples?: Array<Record<string, unknown>>;
  policySnapshot?: Record<string, unknown>;
}): RemoteJobDataset {
  return {
    schema: 'evomate.remote_job_dataset.v1',
    jobId: input.job.jobId,
    createdAt: new Date().toISOString(),
    objective: input.job.objective,
    samples: input.samples?.length ? input.samples : seedSamplesForJob(input.job.type),
    stateSnapshot: input.stateSnapshot,
    policySnapshot: input.policySnapshot
  };
}

export function buildRemoteCommandPlan(job: RemoteEvolutionJob): RemoteCommandPlan {
  const ssh = sshBase(job.target);
  const remoteJob = `${job.target.rootDir}/jobs/${job.jobId}.json`;
  const remoteDataset = `${job.target.rootDir}/datasets/${job.jobId}.json`;
  const remoteArtifacts = `${job.target.rootDir}/artifacts/${job.jobId}`;
  const localJob = `memory/evomate/remote-jobs/${job.jobId}/job.json`;
  const localDataset = `memory/evomate/remote-jobs/${job.jobId}/dataset.json`;

  return {
    bootstrap: [
      `${ssh} "mkdir -p ${job.target.rootDir}/{repo,jobs,datasets,artifacts,logs}"`
    ],
    sync: [
      `rsync -az --delete --exclude node_modules --exclude .next --exclude .git -e \"ssh -p ${job.target.port}${job.target.sshKey ? ` -i ${job.target.sshKey} -o IdentitiesOnly=yes` : ''}\" ./ ${job.target.user}@${job.target.host}:${job.target.repoDir}/`,
      `scp -P ${job.target.port}${job.target.sshKey ? ` -i ${job.target.sshKey} -o IdentitiesOnly=yes` : ''} ${localJob} ${job.target.user}@${job.target.host}:${remoteJob}`,
      `scp -P ${job.target.port}${job.target.sshKey ? ` -i ${job.target.sshKey} -o IdentitiesOnly=yes` : ''} ${localDataset} ${job.target.user}@${job.target.host}:${remoteDataset}`
    ],
    submit: [
      `${ssh} "cd ${job.target.repoDir} && nohup ${job.target.pythonBin} -m evo_predict_agent.remote_worker --job ${remoteJob} --dataset ${remoteDataset} --artifacts ${remoteArtifacts} > ${job.target.rootDir}/logs/${job.jobId}.log 2>&1 &"`
    ],
    poll: [
      `${ssh} "cat ${remoteArtifacts}/status.json || true"`
    ],
    import: [
      `scp -P ${job.target.port}${job.target.sshKey ? ` -i ${job.target.sshKey} -o IdentitiesOnly=yes` : ''} -r ${job.target.user}@${job.target.host}:${remoteArtifacts} ${job.artifactPath}`
    ]
  };
}

export function summarizeRemoteArtifacts(artifact: RemoteWorkerArtifact): RemoteArtifactSummary {
  const generatedFiles = [
    artifact.status ? 'status.json' : '',
    artifact.policyEval ? 'policy_eval.json' : '',
    artifact.validationReport ? 'validation_report.json' : '',
    artifact.suggestedMutations ? 'suggested_mutations.json' : '',
    artifact.evolutionBundle ? 'evolution_bundle.json' : '',
    artifact.preferenceModel ? 'preference_model.json' : '',
    artifact.policyModel ? 'policy_model.json' : '',
    artifact.embeddingIndex ? 'embedding_index.json' : ''
  ].filter(Boolean);

  const validationScore = typeof artifact.validationReport?.score === 'number'
    ? artifact.validationReport.score
    : typeof artifact.policyEval?.evolved_avg === 'number'
      ? artifact.policyEval.evolved_avg
      : undefined;

  return {
    status: artifact.status?.status === 'failed' ? 'failed' : 'completed',
    generatedFiles,
    bestCandidate: typeof artifact.policyEval?.best_candidate === 'string' ? artifact.policyEval.best_candidate : undefined,
    validationScore,
    suggestedMutationCount: Array.isArray(artifact.suggestedMutations) ? artifact.suggestedMutations.length : 0,
    evolutionBundleId: typeof artifact.evolutionBundle?.id === 'string' ? artifact.evolutionBundle.id : undefined
  };
}

export function defaultRemoteComputeTarget(overrides: Partial<RemoteComputeTarget> = {}): RemoteComputeTarget {
  return {
    host: 'remote.example.com',
    port: 22,
    user: 'evomate',
    sshKey: undefined,
    rootDir: '~/evomate-worker',
    repoDir: '~/evomate-worker/repo',
    pythonBin: 'python3',
    executeRemote: false,
    ...overrides
  };
}

function createJobId(type: RemoteJobType): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.random().toString(16).slice(2, 8);
  return `job_${type}_${stamp}_${suffix}`;
}

function defaultObjective(type: RemoteJobType): string {
  switch (type) {
    case 'policy_replay_eval': return 'Replay historical feedback and evaluate behavior-gene selection quality.';
    case 'evolution_gym_eval': return 'Run simulated user scenarios to validate candidate behavior mutations.';
    case 'preference_train': return 'Train a lightweight user preference model from accepted/corrected outcomes.';
    case 'embedding_build': return 'Build embedding memory for interaction and feedback retrieval.';
  }
}

function pipelineForJob(type: RemoteJobType): RemotePipelineStep[] {
  const gpuRuntime = type === 'preference_train' || type === 'embedding_build' ? 'gpu_optional' : 'python_worker';
  return [
    {
      id: 'capture_dataset',
      label: 'Capture local evolution dataset',
      runtime: 'typescript_api',
      status: 'planned',
      description: 'Snapshot EvoMate state, policy weights, timeline, and feedback into a portable JSON dataset.'
    },
    {
      id: 'ship_to_remote',
      label: 'Ship job to remote compute',
      runtime: 'ssh_transport',
      status: 'planned',
      description: 'Sync code, job manifest, and dataset to the remote worker through SSH/SCP.'
    },
    {
      id: 'run_worker',
      label: 'Run remote evolution worker',
      runtime: gpuRuntime,
      status: 'planned',
      description: 'Execute replay eval, evolution gym, preference training, or embedding build on the remote machine.'
    },
    {
      id: 'import_artifacts',
      label: 'Import artifacts into GEP loop',
      runtime: 'gep_import',
      status: 'planned',
      description: 'Pull artifacts back and convert them into Mutation, ValidationReport, EvolutionEvent, and Capsule candidates.'
    }
  ];
}

function seedSamplesForJob(type: RemoteJobType): Array<Record<string, unknown>> {
  return [
    {
      id: 'scenario_safe_execution',
      user_input: '先看代码，不要直接改。',
      expected_gene: 'gene_ask_before_execution',
      reward_if_matched: 0.9,
      job_type: type
    },
    {
      id: 'scenario_fast_iteration',
      user_input: '继续，直接把前端原型搭起来。',
      expected_gene: 'gene_concise_direct_answer',
      reward_if_matched: 0.76,
      job_type: type
    },
    {
      id: 'scenario_mcp_architecture',
      user_input: '我们要深度结合 EvoMap MCP。',
      expected_gene: 'gene_mcp_first_architecture',
      reward_if_matched: 0.86,
      job_type: type
    }
  ];
}

function sshBase(target: RemoteComputeTarget): string {
  const key = target.sshKey ? ` -i ${target.sshKey} -o IdentitiesOnly=yes` : '';
  return `ssh -p ${target.port}${key} ${target.user}@${target.host}`;
}
