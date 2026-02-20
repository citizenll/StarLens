import MiniSearch from 'minisearch';

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

type SearchMode = 'broad' | 'balanced' | 'strict';

type SearchHit = {
  id: number;
  score: number;
};

type WorkerRequest =
  | { id: number; type: 'build'; docs: RepoDoc[]; reset?: boolean }
  | { id: number; type: 'search'; query: string; limit: number; mode?: SearchMode };

type WorkerResponse =
  | { id: number; type: 'ready' }
  | { id: number; type: 'searchResult'; ids: number[]; hits: SearchHit[] }
  | { id: number; type: 'error'; message: string };

let mini: MiniSearch<RepoDoc> | null = null;

const getSearchOptions = (mode: SearchMode) => {
  const boost = { name: 8, full_name: 6, ai_tags: 3.5, topics: 3, ai_summary: 2.4, description: 1.8, readme_content: 0.8 };
  if (mode === 'strict') {
    return {
      combineWith: 'AND' as const,
      prefix: true,
      fuzzy: 0,
      boost,
    };
  }
  if (mode === 'broad') {
    return {
      combineWith: 'OR' as const,
      prefix: true,
      fuzzy: (term: string) => (term.length > 2 ? 0.35 : 0),
      boost,
    };
  }
  return {
    combineWith: 'OR' as const,
    prefix: true,
    fuzzy: (term: string) => (term.length > 3 ? 0.2 : 0),
    boost,
  };
};

const initMini = () => {
  mini = new MiniSearch<RepoDoc>({
    idField: 'id',
    fields: ['name', 'full_name', 'description', 'ai_summary', 'ai_tags', 'topics', 'readme_content'],
    storeFields: ['id'],
    searchOptions: getSearchOptions('balanced'),
  });
};

const handleBuild = (docs: RepoDoc[], reset = false) => {
  // Full reindex requests should reset index to avoid stale/duplicate docs.
  if (!mini || reset) initMini();
  if (!mini) initMini();
  const index = mini as MiniSearch<RepoDoc> & {
    replace?: (doc: RepoDoc) => void;
    discard?: (id: number) => void;
  };
  docs.forEach((doc) => {
    try {
      index.add(doc);
    } catch {
      if (typeof index.replace === 'function') {
        index.replace(doc);
        return;
      }
      if (typeof index.discard === 'function') {
        index.discard(doc.id);
      }
      index.add(doc);
    }
  });
};

const handleSearch = (query: string, limit: number, mode: SearchMode): SearchHit[] => {
  if (!mini) initMini();
  if (!mini || !query.trim()) return [];
  let results = mini.search(query, getSearchOptions(mode));
  if (!results.length && mode === 'strict') {
    results = mini.search(query, getSearchOptions('balanced'));
  }
  return results.slice(0, limit).map((r) => {
    const item = r as unknown as { id: number; score?: number };
    return { id: item.id, score: typeof item.score === 'number' ? item.score : 0 };
  });
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'build') {
      handleBuild(msg.docs || [], Boolean(msg.reset));
      (self as any).postMessage({ id: msg.id, type: 'ready' } as WorkerResponse);
    } else if (msg.type === 'search') {
      const hits = handleSearch(msg.query, msg.limit, msg.mode || 'balanced');
      const ids = hits.map((h) => h.id);
      (self as any).postMessage({ id: msg.id, type: 'searchResult', ids, hits } as WorkerResponse);
    }
  } catch (e: any) {
    (self as any).postMessage({ id: msg.id, type: 'error', message: e?.message || 'worker error' } as WorkerResponse);
  }
};
