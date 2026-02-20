import Dexie, { type Table } from 'dexie';
import type { Repository, SyncState, UserSettings } from '@/types';

export class StarAgentDB extends Dexie {
  repositories!: Table<Repository>;
  syncState!: Table<SyncState>;
  settings!: Table<UserSettings>;

  constructor() {
    super('StarAgentDB');
    this.version(1).stores({
      repositories: 'id, full_name, language, *topics, *ai_tags, created_at, updated_at, starred_at',
      syncState: 'id',
      settings: 'id',
      vectorStore: 'id' // For storing VDB snapshots
    });
  }
}

export const db = new StarAgentDB();