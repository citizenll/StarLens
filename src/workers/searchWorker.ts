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

type WorkerRequest =
  | { id: number; type: 'build'; docs: RepoDoc[] }
  | { id: number; type: 'search'; query: string; limit: number };

type WorkerResponse =
  | { id: number; type: 'ready' }
  | { id: number; type: 'searchResult'; ids: number[] }
  | { id: number; type: 'error'; message: string };

let mini: MiniSearch<RepoDoc> | null = null;

const initMini = () => {
  mini = new MiniSearch<RepoDoc>({
    idField: 'id',
    fields: ['name', 'full_name', 'description', 'ai_summary', 'ai_tags', 'topics', 'readme_content'],
    storeFields: ['id'],
    searchOptions: {
      boost: { name: 4, full_name: 3, ai_tags: 2, topics: 2, ai_summary: 1.5, description: 1.2 },
      fuzzy: 0.2,
      prefix: true,
    },
  });
};

const handleBuild = (docs: RepoDoc[]) => {
  if (!mini) initMini();
  mini!.addAll(docs);
};

const handleSearch = (query: string, limit: number) => {
  if (!mini) return [];
  const results = mini.search(query, {
    prefix: true,
    fuzzy: 0.2,
    boost: { name: 4, full_name: 3, ai_tags: 2, topics: 2, ai_summary: 1.5, description: 1.2 },
  });
  return results.slice(0, limit).map((r) => (r as any).id as number);
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'build') {
      handleBuild(msg.docs || []);
      (self as any).postMessage({ id: msg.id, type: 'ready' } as WorkerResponse);
    } else if (msg.type === 'search') {
      const ids = handleSearch(msg.query, msg.limit);
      (self as any).postMessage({ id: msg.id, type: 'searchResult', ids } as WorkerResponse);
    }
  } catch (e: any) {
    (self as any).postMessage({ id: msg.id, type: 'error', message: e?.message || 'worker error' } as WorkerResponse);
  }
};
