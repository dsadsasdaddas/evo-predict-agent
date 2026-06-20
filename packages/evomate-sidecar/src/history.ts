#!/usr/bin/env node
import { getJson, parseArgs, printHookFailure, printJson } from './shared.js';

type HistoryResponse = {
  ok?: boolean;
  count?: number;
  totalTimeline?: number;
  timeline?: Array<{
    type?: string;
    summary?: string;
    score?: number;
    geneId?: string;
    createdAt?: string;
    signals?: string[];
  }>;
  jobs?: Array<{ jobId?: string; type?: string; status?: string; createdAt?: string }>;
};

async function main(): Promise<void> {
  const args = parseArgs();
  const params = new URLSearchParams();
  if (typeof args.q === 'string') params.set('q', args.q);
  if (typeof args.type === 'string') params.set('type', args.type);
  if (typeof args.gene === 'string') params.set('geneId', args.gene);
  if (typeof args.geneId === 'string') params.set('geneId', args.geneId);
  if (typeof args.limit === 'string') params.set('limit', args.limit);
  if (args.jobs) params.set('jobs', 'true');

  const response = await getJson<HistoryResponse>(`/api/evolution/history?${params.toString()}`, 1600);
  if (args.json) {
    printJson(response);
    return;
  }

  printJson({
    ok: response.ok !== false,
    count: response.count,
    totalTimeline: response.totalTimeline,
    timeline: response.timeline?.map((item) => ({
      event: item.type,
      score: typeof item.score === 'number' ? `${Math.round(item.score * 100)}%` : undefined,
      gene: item.geneId,
      summary: item.summary,
      at: item.createdAt
    })),
    jobs: response.jobs?.slice(0, 8).map((job) => ({
      jobId: job.jobId,
      type: job.type,
      status: job.status,
      at: job.createdAt
    }))
  });
}

main().catch((err) => {
  printHookFailure('observe', err, { command: 'evomate-history' });
  process.exitCode = 1;
});
