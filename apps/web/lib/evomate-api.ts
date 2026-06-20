import type {
  AnalyzeResponse,
  EvolutionHistory,
  EvolutionState,
  FeedbackKind,
  FeedbackResponse,
  MemoryRouteResponse,
  TrainResponse
} from './types';

export const HOSTED_API_URL = 'http://100.70.188.115:8878';
export const LOCAL_API_URL = 'http://127.0.0.1:8787';
export const API_URL = process.env.NEXT_PUBLIC_EVOMATE_API_URL || LOCAL_API_URL;

type RequestOptions = RequestInit & { timeoutMs?: number };

export function getApiCandidates() {
  return Array.from(new Set([API_URL, HOSTED_API_URL]));
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const errors: string[] = [];
  for (const apiUrl of getApiCandidates()) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 4500);
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        ...options,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(options.headers || {})
        }
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json() as T;
    } catch (error) {
      errors.push(`${apiUrl}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw new Error(errors.join(' | '));
}

export function fetchEvolutionState() {
  return requestJson<EvolutionState>('/api/evolution/state', { timeoutMs: 3000 });
}

export function fetchEvolutionHistory(limit = 24, jobs = true) {
  return requestJson<EvolutionHistory>(`/api/evolution/history?limit=${limit}&jobs=${jobs ? 'true' : 'false'}`, { timeoutMs: 4000 });
}

export function fetchMemoryRoute() {
  return requestJson<MemoryRouteResponse>('/api/memory/route', { timeoutMs: 4000 });
}

export function analyzeInteraction(input: string, source = 'web_dashboard') {
  return requestJson<AnalyzeResponse>('/api/interactions/analyze', {
    method: 'POST',
    body: JSON.stringify({ input, source })
  });
}

export function sendFeedback(input: {
  kind: FeedbackKind;
  text?: string;
  score?: number;
  geneId?: string;
  signals?: string[];
}) {
  return requestJson<FeedbackResponse>('/api/feedback', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function queueTraining(type: 'preference_train' | 'policy_replay_eval' | 'evolution_gym_eval' | 'embedding_build' = 'preference_train') {
  return requestJson<TrainResponse>('/api/evolution/train', {
    method: 'POST',
    body: JSON.stringify({
      type,
      source: 'web_dashboard',
      executeRemote: false,
      objective: type === 'preference_train'
        ? 'Train EvoMate preference policy from live feedback, hook outcomes, and GEP memory receipts.'
        : undefined
    }),
    timeoutMs: 8000
  });
}
