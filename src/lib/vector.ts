import { LunaVDB } from '@chatluna/luna-vdb';
import { aiService } from './ai';
import { db } from './db';
import type { Repository } from '@/types';

const VECTOR_SNAPSHOT_VERSION = 'v1';

// Define a simple table for storing the vector DB snapshot
// We'll extend the DB schema dynamically or just use a separate store key in 'syncState' or similar
// Actually, let's add a 'vector_store' table to Dexie in db.ts, but for now I'll use a key in 'syncState' or 'settings' if possible,
// or just add a new table. Since I can't easily change db.ts schema without version bump (which is fine),
// I'll try to store it in 'syncState' as a blob/buffer if it fits, or better: update db.ts.

export class VectorService {
  private vdb: LunaVDB | null = null;
  private initialized = false;

  async init() {
    if (this.initialized) return;
    
    try {
        this.vdb = new LunaVDB();
        
        // Load snapshot from DB if exists
        // @ts-ignore - Dynamic table access or need to update type definition in db.ts
        const record = await db.table('vectorStore').get('main');
        if (record && record.snapshot && record.version === VECTOR_SNAPSHOT_VERSION) {
            this.vdb = LunaVDB.deserialize(record.snapshot);
        } else if (record && record.snapshot && record.version !== VECTOR_SNAPSHOT_VERSION) {
            // Version mismatch: rebuild will happen as we re-index; we simply skip loading old snapshot.
            console.info('Vector snapshot version changed, rebuilding index');
        }
        
        this.initialized = true;
    } catch (e) {
        console.error("Failed to initialize LunaVDB", e);
        // Fallback to empty
        this.vdb = new LunaVDB();
        this.initialized = true;
    }
  }

  async indexRepo(repo: Repository) {
    if (!this.initialized) await this.init();
    if (!this.vdb) return;

    // Create text representation for embedding
    const text = `
      Name: ${repo.full_name}
      Description: ${repo.description || ''}
      Language: ${repo.language || ''}
      Topics: ${repo.topics.join(', ')}
      AI Tags: ${repo.ai_tags?.join(', ') || ''}
      AI Summary: ${repo.ai_summary || ''}
      Readme: ${(repo.readme_content || '').slice(0, 500)}
    `.trim();

    // Get embedding from AI service
    let embedding = repo.embedding;
    if (!embedding) {
        try {
            embedding = await aiService.getEmbedding(text);
            // Save embedding back to DB to avoid re-computing
            await db.repositories.update(repo.id, { embedding });
        } catch (e) {
            console.error(`Failed to get embedding for ${repo.full_name}`, e);
            return;
        }
    }

    if (embedding) {
        await this.vdb.add({
            embeddings: [{
                id: repo.id.toString(),
                embeddings: embedding
            }]
        });
    }
  }

  async search(query: string, limit = 10) {
    if (!this.initialized) await this.init();
    if (!this.vdb) return [];

    try {
        const queryEmbedding = await aiService.getEmbedding(query);
        // Convert number[] to Float32Array
        const vector = new Float32Array(queryEmbedding);
        
        const results = await this.vdb.search(vector, limit);
        
        // Map results back to repositories
        const mappedResults = await Promise.all(results.neighbors.map(async (n) => {
            const id = parseInt(n.id);
            const repo = await db.repositories.get(id);
            return {
                ...repo,
                _distance: n.distance
            };
        }));
        
        return mappedResults.filter(r => r !== undefined);
    } catch (e) {
        console.error("Vector search failed", e);
        return [];
    }
  }
  
  async indexAll() {
      const repos = await db.repositories.toArray();
      // Batch processing could be better
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
          console.error("Failed to save vector store snapshot", e);
      }
  }
}

export const vectorService = new VectorService();
