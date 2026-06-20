import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  buildRemoteJobDataset,
  createRemoteEvolutionJob,
  defaultRemoteComputeTarget,
  summarizeRemoteArtifacts,
  type EvolutionState,
  type RemoteComputeTarget,
  type RemoteEvolutionJob,
  type RemoteEvolutionJobInput,
  type RemoteJobStatus,
  type RemoteJobType,
  type RemoteWorkerArtifact
} from '@evomate/core';
import { resolveFromProjectRoot } from './paths.js';

const execFileAsync = promisify(execFile);

const JOBS_DIR = resolveFromProjectRoot('memory/evomate/remote-jobs');
const ARTIFACTS_DIR = resolveFromProjectRoot('memory/evomate/remote-artifacts');

export interface RemoteSubmitResult {
  ok: true;
  job: RemoteEvolutionJob;
  datasetPath: string;
  manifestPath: string;
  mode: 'dry_run' | 'ssh_submitted';
  commandLog: Array<{ command: string; stdout?: string; stderr?: string }>;
}

export async function submitRemoteEvolutionJob(input: RemoteEvolutionJobInput, state: EvolutionState): Promise<RemoteSubmitResult> {
  const targetOverrides: Partial<RemoteComputeTarget> = {
    executeRemote: shouldExecuteRemote(input.executeRemote)
  };
  if (process.env.EVOMATE_REMOTE_HOST) targetOverrides.host = process.env.EVOMATE_REMOTE_HOST;
  if (process.env.EVOMATE_REMOTE_PORT) targetOverrides.port = Number(process.env.EVOMATE_REMOTE_PORT);
  if (process.env.EVOMATE_REMOTE_USER) targetOverrides.user = process.env.EVOMATE_REMOTE_USER;
  if (process.env.EVOMATE_REMOTE_SSH_KEY) targetOverrides.sshKey = process.env.EVOMATE_REMOTE_SSH_KEY;
  if (process.env.EVOMATE_REMOTE_ROOT) targetOverrides.rootDir = process.env.EVOMATE_REMOTE_ROOT;
  if (process.env.EVOMATE_REMOTE_REPO_DIR) targetOverrides.repoDir = process.env.EVOMATE_REMOTE_REPO_DIR;
  if (process.env.EVOMATE_REMOTE_PYTHON) targetOverrides.pythonBin = process.env.EVOMATE_REMOTE_PYTHON;
  const target = defaultRemoteComputeTarget(targetOverrides);
  const job = createRemoteEvolutionJob(input, target);
  const jobDir = jobDirectory(job.jobId);
  const dataset = buildRemoteJobDataset({
    job,
    stateSnapshot: compactStateSnapshot(state),
    policySnapshot: state.policy as unknown as Record<string, unknown>,
    samples: timelineToSamples(state, job.type)
  });

  await mkdir(jobDir, { recursive: true });
  await mkdir(resolve(ARTIFACTS_DIR, job.jobId), { recursive: true });
  const manifestPath = resolve(jobDir, 'job.json');
  const datasetPath = resolve(jobDir, 'dataset.json');
  await writeJson(datasetPath, dataset);
  await writeJson(manifestPath, job);
  await writeJson(resolve(jobDir, 'remote_plan.json'), job.remotePlan);

  const commandLog: RemoteSubmitResult['commandLog'] = [];
  let nextJob = job;
  if (target.executeRemote) {
    nextJob = await updateRemoteJobStatus(job.jobId, 'syncing');
    const commands = [...job.remotePlan.bootstrap, ...job.remotePlan.sync, ...job.remotePlan.submit];
    try {
      for (const command of commands) {
        const { stdout, stderr } = await execShell(command);
        commandLog.push({ command, stdout, stderr });
      }
      nextJob = await updateRemoteJobStatus(job.jobId, 'running');
    } catch (err) {
      nextJob = await updateRemoteJobStatus(job.jobId, 'failed', err instanceof Error ? err.message : String(err));
    }
  } else {
    await writeJson(resolve(ARTIFACTS_DIR, job.jobId, 'status.json'), {
      status: 'queued',
      mode: 'dry_run',
      updated_at: new Date().toISOString(),
      message: 'Set EVOMATE_REMOTE_EXECUTE=1 or submit executeRemote=true to run SSH distribution.'
    });
  }

  return {
    ok: true,
    job: nextJob,
    datasetPath,
    manifestPath,
    mode: target.executeRemote ? 'ssh_submitted' : 'dry_run',
    commandLog
  };
}

export async function listRemoteEvolutionJobs(): Promise<RemoteEvolutionJob[]> {
  try {
    const entries = await readdir(JOBS_DIR, { withFileTypes: true });
    const jobs = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readRemoteEvolutionJob(entry.name).catch(() => null)));
    return jobs.filter((job): job is RemoteEvolutionJob => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function readRemoteEvolutionJob(jobId: string): Promise<RemoteEvolutionJob> {
  const path = resolve(jobDirectory(jobId), 'job.json');
  return JSON.parse(await readFile(path, 'utf8')) as RemoteEvolutionJob;
}

export async function importRemoteEvolutionArtifacts(jobId: string): Promise<{ ok: true; job: RemoteEvolutionJob; artifacts: RemoteWorkerArtifact }> {
  let job = await readRemoteEvolutionJob(jobId);

  if (job.target.executeRemote) {
    const commands = job.remotePlan.import;
    for (const command of commands) await execShell(command);
  }

  await ensureWorkerArtifacts(job);
  const artifacts = await readArtifacts(jobId);
  const summary = summarizeRemoteArtifacts(artifacts);
  const installedModelArtifacts = await installTrainingArtifacts(jobId);
  job = {
    ...job,
    status: summary.status === 'failed' ? 'failed' : 'imported',
    updatedAt: new Date().toISOString(),
    importedAt: new Date().toISOString(),
    artifactSummary: summary,
    metadata: {
      ...job.metadata,
      installedModelArtifacts
    }
  };
  await writeJob(job);
  return { ok: true, job, artifacts };
}

export async function updateRemoteJobStatus(jobId: string, status: RemoteJobStatus, error?: string): Promise<RemoteEvolutionJob> {
  const job = await readRemoteEvolutionJob(jobId);
  const next: RemoteEvolutionJob = { ...job, status, updatedAt: new Date().toISOString(), error };
  await writeJob(next);
  return next;
}

function jobDirectory(jobId: string): string {
  return resolve(JOBS_DIR, safeJobId(jobId));
}

function artifactDirectory(jobId: string): string {
  return resolve(ARTIFACTS_DIR, safeJobId(jobId));
}

function safeJobId(jobId: string): string {
  return jobId.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function shouldExecuteRemote(input?: boolean): boolean {
  if (typeof input === 'boolean') return input;
  return process.env.EVOMATE_REMOTE_EXECUTE === '1' || process.env.EVOMATE_REMOTE_EXECUTE === 'true';
}

function compactStateSnapshot(state: EvolutionState): Record<string, unknown> {
  return {
    assistantId: state.assistantId,
    generation: state.generation,
    phase: state.phase,
    understandingScore: state.understandingScore,
    metrics: state.metrics,
    activeGenes: state.activeGenes.map((gene) => ({
      id: gene.id,
      label: gene.label,
      signals: gene.signals,
      fitness: gene.fitness,
      weight: gene.weight
    })),
    recentTimeline: state.timeline.slice(0, 30)
  };
}

function timelineToSamples(state: EvolutionState, type: RemoteJobType): Array<Record<string, unknown>> {
  const timelineSamples = state.timeline.slice(0, 24).map((item) => ({
    id: item.id,
    type: item.type,
    summary: item.summary,
    geneId: item.geneId,
    signals: item.signals ?? [],
    score: item.score,
    job_type: type
  }));
  const canonicalSamples = canonicalTrainingSamples(type);
  const seen = new Set(timelineSamples.map((sample) => sample.id));
  return [
    ...timelineSamples,
    ...canonicalSamples.filter((sample) => !seen.has(String(sample.id)))
  ];
}

function canonicalTrainingSamples(type: RemoteJobType): Array<Record<string, unknown>> {
  return [
    {
      id: 'canonical_safe_execution',
      user_input: '先看项目结构，不要直接改文件。',
      expected_gene: 'gene_ask_before_execution',
      signals: ['coding_task', 'permission_sensitive', 'ambiguous_execution_permission'],
      reward_if_matched: 0.92,
      job_type: type
    },
    {
      id: 'canonical_fast_iteration',
      user_input: '继续，直接把可演示版本做出来。',
      expected_gene: 'gene_concise_direct_answer',
      signals: ['rapid_iteration', 'impatient_user', 'roadshow_planning'],
      reward_if_matched: 0.82,
      job_type: type
    },
    {
      id: 'canonical_mcp_architecture',
      user_input: '这个要深度结合 EvoMap 和 MCP，先画架构。',
      expected_gene: 'gene_mcp_first_architecture',
      signals: ['mcp_native', 'evomap_integration', 'architecture_request', 'visualization_request'],
      reward_if_matched: 0.9,
      job_type: type
    },
    {
      id: 'canonical_research',
      user_input: '你先去官网调研，不要瞎猜。',
      expected_gene: 'gene_deep_research_first',
      signals: ['research_task', 'external_source_required', 'permission_sensitive'],
      reward_if_matched: 0.86,
      job_type: type
    },
    {
      id: 'canonical_visual',
      user_input: '我看不懂，给我画图并在前端展示。',
      expected_gene: 'gene_visualize_first',
      signals: ['visualization_request', 'architecture_request', 'roadshow_planning'],
      reward_if_matched: 0.84,
      job_type: type
    },
    {
      id: 'canonical_ml_training',
      user_input: '我们没有真训练吗？把完整机器学习训练闭环做出来。',
      expected_gene: 'gene_yes_engineer_policy',
      signals: ['ml_policy', 'evomap_integration', 'rapid_iteration'],
      reward_if_matched: 0.88,
      job_type: type
    }
  ];
}

async function ensureWorkerArtifacts(job: RemoteEvolutionJob): Promise<void> {
  const dir = artifactDirectory(job.jobId);
  await mkdir(dir, { recursive: true });
  try {
    await readFile(resolve(dir, 'evolution_bundle.json'), 'utf8');
    return;
  } catch {
    // Fall through and run the local worker. This gives dry-run jobs real
    // training artifacts instead of static prototype files.
  }

  const manifestPath = resolve(jobDirectory(job.jobId), 'job.json');
  const datasetPath = resolve(jobDirectory(job.jobId), 'dataset.json');
  const pythonBin = process.env.EVOMATE_LOCAL_PYTHON || 'python3';
  await execFileAsync(pythonBin, [
    '-m',
    'evo_predict_agent.remote_worker',
    '--job',
    manifestPath,
    '--dataset',
    datasetPath,
    '--artifacts',
    dir
  ], {
    cwd: resolveFromProjectRoot('.'),
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 4
  });
}

async function readArtifacts(jobId: string): Promise<RemoteWorkerArtifact> {
  const dir = artifactDirectory(jobId);
  const [status, policyEval, validationReport, suggestedMutations, evolutionBundle, preferenceModel, policyModel, embeddingIndex] = await Promise.all([
    readJsonMaybe(resolve(dir, 'status.json')),
    readJsonMaybe(resolve(dir, 'policy_eval.json')),
    readJsonMaybe(resolve(dir, 'validation_report.json')),
    readJsonMaybe(resolve(dir, 'suggested_mutations.json')),
    readJsonMaybe(resolve(dir, 'evolution_bundle.json')),
    readJsonMaybe(resolve(dir, 'preference_model.json')),
    readJsonMaybe(resolve(dir, 'policy_model.json')),
    readJsonMaybe(resolve(dir, 'embedding_index.json'))
  ]);
  return {
    status: status as RemoteWorkerArtifact['status'],
    policyEval: policyEval as Record<string, unknown> | undefined,
    validationReport: validationReport as Record<string, unknown> | undefined,
    suggestedMutations: Array.isArray(suggestedMutations) ? suggestedMutations : undefined,
    evolutionBundle: evolutionBundle as Record<string, unknown> | undefined,
    preferenceModel: preferenceModel as Record<string, unknown> | undefined,
    policyModel: policyModel as Record<string, unknown> | undefined,
    embeddingIndex: embeddingIndex as Record<string, unknown> | undefined
  };
}

async function installTrainingArtifacts(jobId: string): Promise<Array<{ source: string; target: string }>> {
  const dir = artifactDirectory(jobId);
  const mappings = [
    ['preference_model.json', 'memory/evomate/models/reward_model/preference_model.json'],
    ['policy_model.json', 'memory/evomate/models/policy_model/policy_model.json'],
    ['embedding_index.json', 'memory/evomate/models/embedding_index/embedding_index.json']
  ] as const;
  const installed: Array<{ source: string; target: string }> = [];
  for (const [sourceName, targetRelative] of mappings) {
      const source = resolve(dir, sourceName);
      const target = resolveFromProjectRoot(targetRelative);
      try {
        const content = await readFile(source, 'utf8');
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, 'utf8');
        installed.push({ source, target });
    } catch {
      // Artifact not produced for this job type.
    }
  }
  if (installed.length) {
    await writeJson(resolveFromProjectRoot('memory/evomate/models/installed-models.json'), {
      installedAt: new Date().toISOString(),
      sourceJobId: jobId,
      installed
    });
  }
  return installed;
}

async function writeJob(job: RemoteEvolutionJob): Promise<void> {
  await writeJson(resolve(jobDirectory(job.jobId), 'job.json'), job);
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function readJsonMaybe(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

async function execShell(command: string): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('sh', ['-lc', command], { cwd: resolveFromProjectRoot('.'), timeout: 120000, maxBuffer: 1024 * 1024 * 2 });
  return { stdout, stderr };
}
