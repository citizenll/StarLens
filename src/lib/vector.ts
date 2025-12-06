// Local LunaVDB (browser build) - dynamically load WASM to avoid MIME issues
import { aiService } from './ai';
import { db } from './db';
import type { Repository } from '@/types';

const VECTOR_SNAPSHOT_VERSION = 'v1';

export class VectorService {
  private vdb: any | null = null;
  private initialized = false;
  private lunaCtor: any = null;
  private wasmReady: Promise<void> | null = null;

  private async ensureWasm() {
    if (!this.wasmReady) {
      this.wasmReady = import('@/luna/luna_vdb.js')
        // @ts-ignore - Vite resolves ?url assets for the wasm binary
        .then(async (mod: any) => {
          const init = mod.default;
          const wasmUrl = (await import('@/luna/luna_vdb_bg.wasm?url')).default;
          await init(wasmUrl);
          this.lunaCtor = mod.LunaVDB;
        })
        .catch((err: any) => {
          this.wasmReady = null;
          throw err;
        });
    }
    return this.wasmReady;
  }

  async init() {
    if (this.initialized) return;

    try {
      await this.ensureWasm();
      this.vdb = new this.lunaCtor();

      // Load snapshot from DB if exists
      // @ts-ignore - Dynamic table access or need to update type definition in db.ts
      const record = await db.table('vectorStore').get('main');
      if (record && record.snapshot && record.version === VECTOR_SNAPSHOT_VERSION) {
        this.vdb = this.lunaCtor.deserialize(record.snapshot);
      } else if (record && record.snapshot && record.version !== VECTOR_SNAPSHOT_VERSION) {
        console.info('Vector snapshot version changed, rebuilding index');
      }

      this.initialized = true;
    } catch (e) {
      console.error('Failed to initialize LunaVDB', e);
      this.initialized = false;
      throw e;
    }
  }

  async indexRepo(repo: Repository) {
    if (!this.initialized) await this.init();
    if (!this.vdb) return;

    const text = `
      Name: ${repo.full_name}
      Description: ${repo.description || ''}
      Language: ${repo.language || ''}
      Topics: ${repo.topics.join(', ')}
      AI Tags: ${repo.ai_tags?.join(', ') || ''}
      AI Summary: ${repo.ai_summary || ''}
      Readme: ${(repo.readme_content || '').slice(0, 500)}
    `.trim();

    let embedding = repo.embedding;
    if (!embedding) {
      try {
        embedding = await aiService.getEmbedding(text);
        await db.repositories.update(repo.id, { embedding });
      } catch (e) {
        console.error(`Failed to get embedding for ${repo.full_name}`, e);
        return;
      }
    }

    if (embedding) {
      await this.vdb.add({
        embeddings: [
          {
            id: repo.id.toString(),
            embeddings: embedding,
          },
        ],
      });
    }
  }

  async search(query: string, limit = 10) {
    if (!this.initialized) await this.init();
    if (!this.vdb) return [];

    try {
      const queryEmbedding = await aiService.getEmbedding(query);
      const vector = new Float32Array(queryEmbedding);

      const results = await this.vdb.search(vector, limit);

      const mappedResults = await Promise.all(
        results.neighbors.map(async (n: any) => {
          const id = parseInt(n.id, 10);
          const repo = await db.repositories.get(id);
          return repo
            ? {
                ...repo,
                _distance: n.distance,
              }
            : undefined;
        })
      );

      return mappedResults.filter((r): r is Repository & { _distance: number } => r !== undefined);
    } catch (e) {
      console.error('Vector search failed', e);
      return [];
    }
  }

  async indexAll() {
    const repos = await db.repositories.toArray();
    for (const repo of repos) {
      await this.indexRepo(repo);
    }
  }

  async save() {
    if (!this.vdb) return;
    try {
      const snapshot = this.vdb.serialize();
      // @ts-ignore
      await db.table('vectorStore').put({ id: 'main', snapshot, version: VECTOR_SNAPSHOT_VERSION });
    } catch (e) {
      console.error('Failed to save vector store snapshot', e);
    }
  }
}

export const vectorService = new VectorService();
