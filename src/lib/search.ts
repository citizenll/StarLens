import type { Repository } from '@/types';
import { db } from './db';

export type SearchMode = 'broad' | 'balanced' | 'strict';

type SearchHit = {
  id: number;
  score: number;
};

export type ScoredRepo = {
  repo: Repository;
  score: number;
  rank: number;
};

type WorkerRequest =
  | { id: number; type: 'build'; docs: RepoDoc[]; reset?: boolean }
  | { id: number; type: 'search'; query: string; limit: number; mode?: SearchMode };

type WorkerResponse =
  | { id: number; type: 'ready' }
  | { id: number; type: 'searchResult'; ids: number[]; hits: SearchHit[] }
  | { id: number; type: 'error'; message: string };

type RepoDoc = {
  id: number;
  name: string;
  full_name: string;
  description?: string | null;
  ai_summary?: string | null;
  ai_tags?: string[];
  topics?: string[];
  readme_content?: string;
};

class SearchService {
  private worker: Worker | null = null;
  private requestId = 0;
  private pending = new Map<number, (resp: WorkerResponse) => void>();
  private initPromise: Promise<void> | null = null;

  private ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(new URL('../workers/searchWorker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const resp = event.data;
      const resolver = this.pending.get(resp.id);
      if (resolver) {
        this.pending.delete(resp.id);
        resolver(resp);
      }
    });
  }

  private postMessage<T extends WorkerResponse>(msg: WorkerRequest): Promise<T> {
    this.ensureWorker();
    return new Promise((resolve) => {
      this.pending.set(msg.id, resolve as any);
      this.worker!.postMessage(msg);
    });
  }

  async init(force = false) {
    if (this.initPromise && !force) return this.initPromise;
    this.initPromise = (async () => {
      const repos = await db.repositories.toArray();
      const docs = repos.map<RepoDoc>((r) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        description: r.description,
        ai_summary: r.ai_summary,
        ai_tags: r.ai_tags,
        topics: r.topics,
        readme_content: (r.readme_content || '').slice(0, 2000),
      }));
      const id = ++this.requestId;
      const resp = await this.postMessage<WorkerResponse>({ id, type: 'build', docs, reset: true });
      if (resp.type === 'error') throw new Error(resp.message);
    })();
    return this.initPromise;
  }

  async reindexAll() {
    await this.init(true);
  }

  async indexRepo(repo: Repository) {
    await this.init();
    // incremental: rebuild one doc
    const doc: RepoDoc = {
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      ai_summary: repo.ai_summary,
      ai_tags: repo.ai_tags,
      topics: repo.topics,
      readme_content: (repo.readme_content || '').slice(0, 2000),
    };
    const id = ++this.requestId;
    await this.postMessage<WorkerResponse>({ id, type: 'build', docs: [doc], reset: false });
  }

  async searchScored(query: string, options?: { limit?: number; mode?: SearchMode }) {
    const limit = options?.limit ?? 50;
    const mode = options?.mode ?? 'balanced';
    if (!query.trim()) return [] as ScoredRepo[];

    await this.init();
    const id = ++this.requestId;
    const resp = await this.postMessage<WorkerResponse>({ id, type: 'search', query, limit, mode });
    if (resp.type === 'error') {
      console.error('Search worker error', resp.message);
      return [];
    }
    const hits = resp.type === 'searchResult' ? resp.hits : [];
    if (!hits.length) return [];

    const ids = hits.map((h) => h.id);
    const repos = await db.repositories.where('id').anyOf(ids).toArray();
    const map = new Map(repos.map((r) => [r.id, r]));
    return hits
      .map((hit, rank) => {
        const repo = map.get(hit.id);
        if (!repo) return null;
        return { repo, score: hit.score, rank };
      })
      .filter((item): item is ScoredRepo => item !== null);
  }

  async search(query: string, limit = 50) {
    const scored = await this.searchScored(query, { limit, mode: 'balanced' });
    return scored.map((item) => item.repo);
  }
}

export const searchService = new SearchService();
