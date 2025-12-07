import MiniSearch, { type SearchResult } from 'minisearch';
import { db } from './db';
import type { Repository } from '@/types';

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

class MiniSearchService {
  private mini: MiniSearch<RepoDoc> | null = null;
  private initialized = false;

  private buildInstance() {
    this.mini = new MiniSearch<RepoDoc>({
      idField: 'id',
      fields: ['name', 'full_name', 'description', 'ai_summary', 'ai_tags', 'topics', 'readme_content'],
      storeFields: ['id'],
      searchOptions: {
        combineWith:'OR',
        boost: { name: 4, full_name: 3, ai_tags: 2, topics: 2, ai_summary: 1.5, description: 1.2 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  private serializeAndPersist = async () => {
    if (!this.mini) return;
    const snapshot = this.mini.toJSON();
    // @ts-ignore allow dynamic shape
    await db.syncState.put({ id: 'mini_search', snapshot });
  };

  async init(forceRebuild = false) {
    if (this.initialized && !forceRebuild) return;
    this.buildInstance();

    if (!forceRebuild) {
      // try to load cached snapshot
      // @ts-ignore
      const record = await db.syncState.get('mini_search');
      if (record?.snapshot) {
        try {
          this.mini = MiniSearch.loadJSON(record.snapshot);
          this.initialized = true;
          return;
        } catch (err) {
          console.warn('Failed to load MiniSearch snapshot, rebuilding', err);
        }
      }
    }

    const repos = await db.repositories.toArray();
    this.buildInstance();
    if (!this.mini) return;
    this.mini.addAll(this.mapReposToDocs(repos));
    this.initialized = true;
    await this.serializeAndPersist();
  }

  private mapReposToDocs(repos: Repository[]): RepoDoc[] {
    return repos.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      description: r.description,
      ai_summary: r.ai_summary,
      ai_tags: r.ai_tags,
      topics: r.topics,
      readme_content: r.readme_content,
    }));
  }

  async indexRepo(repo: Repository) {
    if (!this.initialized) await this.init();
    if (!this.mini) return;
    // remove old then add new
    this.mini.remove(repo.id);
    this.mini.add(this.mapReposToDocs([repo])[0]);
    await this.serializeAndPersist();
  }

  async indexAll() {
    await this.init(true);
  }

  async search(query: string, limit = 50) {
    if (!this.initialized) await this.init();
    if (!this.mini) return [];
    const results = this.mini.search(query, {
      prefix: true,
      fuzzy: 0.2,
      boost: { name: 4, full_name: 3, ai_tags: 2, topics: 2, ai_summary: 1.5, description: 1.2 },
    }) as Array<SearchResult & { id: number }>;

    const ids = results.slice(0, limit).map((r) => r.id);
    const repos = await db.repositories.where('id').anyOf(ids).toArray();
    const repoMap = new Map(repos.map((r) => [r.id, r]));
    return ids.map((id) => repoMap.get(id)).filter(Boolean);
  }
}

export const searchService = new MiniSearchService();
