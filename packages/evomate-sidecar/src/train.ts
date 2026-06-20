#!/usr/bin/env node
import { parseArgs, postJson, printHookFailure, printJson } from './shared.js';

type TrainResponse = {
  ok?: boolean;
  action?: string;
  mode?: string;
  job?: {
    jobId?: string;
    type?: string;
    status?: string;
    target?: { host?: string; port?: number; user?: string; executeRemote?: boolean };
  };
  datasetPath?: string;
  manifestPath?: string;
};

async function main(): Promise<void> {
  const args = parseArgs();
  const type = typeof args.type === 'string' ? args.type : 'preference_train';
  const executeRemote = Boolean(args.remote || args.executeRemote);
  const response = await postJson<TrainResponse>('/api/evolution/train', {
    type,
    objective: typeof args.objective === 'string' ? args.objective : undefined,
    source: 'evomate_train_cli',
    executeRemote,
    metadata: {
      argvSource: 'evomate-train',
      cwd: process.cwd()
    }
  });

  if (args.json) {
    printJson(response);
    return;
  }

  printJson({
    ok: response.ok !== false,
    action: response.action,
    jobId: response.job?.jobId,
    type: response.job?.type,
    status: response.job?.status,
    mode: response.mode,
    remote: response.job?.target?.executeRemote ? `${response.job.target.user}@${response.job.target.host}:${response.job.target.port}` : 'dry_run/local_worker_on_import',
    datasetPath: response.datasetPath,
    manifestPath: response.manifestPath
  });
}

main().catch((err) => {
  printHookFailure('observe', err, { command: 'evomate-train' });
  process.exitCode = 1;
});
