import { gzip, ungzip } from 'pako';
import { db } from './db';
import type { Repository, SyncState, UserSettings } from '@/types';

interface BackupPayload {
  version: string;
  exported_at: string;
  repositories: Repository[];
  syncState: SyncState[];
  settings: UserSettings[];
  vectorStore?: {
    id: string;
    version?: string;
    snapshot?: string; // base64
  };
}

const BACKUP_VERSION = '1';

const bufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToBuffer = (b64: string) => {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export const backupService = {
  async exportAll(): Promise<BackupPayload> {
    const [repositories, syncState, settings, vectorStore] = await Promise.all([
      db.repositories.toArray(),
      db.syncState.toArray(),
      db.settings.toArray(),
      // @ts-ignore
      db.table('vectorStore').get('main')
    ]);

    return {
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      repositories,
      syncState,
      settings,
      vectorStore: vectorStore
        ? {
            id: vectorStore.id,
            version: vectorStore.version,
            snapshot: vectorStore.snapshot ? bufferToBase64(vectorStore.snapshot) : undefined
          }
        : undefined
    };
  },

  async download(): Promise<void> {
    const payload = await this.exportAll();
    const json = JSON.stringify(payload);
    const compressed = gzip(json);
    const blob = new Blob([compressed], { type: 'application/gzip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `star-agent-backup-${Date.now()}.json.gz`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async importBlob(file: File) {
    const buffer = await file.arrayBuffer();
    let text: string | null = null;
    try {
      const decompressed = ungzip(new Uint8Array(buffer), { to: 'string' });
      text = decompressed as string;
    } catch (err) {
      // fallback to plain text
      text = new TextDecoder().decode(buffer);
    }
    const payload = JSON.parse(text) as BackupPayload;
    return this.import(payload);
  },

  async import(payload: BackupPayload) {
    if (!payload || payload.version !== BACKUP_VERSION) {
      throw new Error('Invalid or incompatible backup file');
    }

    await db.transaction('rw', db.repositories, db.syncState, db.settings, db.table('vectorStore'), async () => {
      await db.repositories.clear();
      await db.syncState.clear();
      await db.settings.clear();
      // @ts-ignore
      await db.table('vectorStore').clear();

      if (payload.repositories?.length) {
        await db.repositories.bulkPut(payload.repositories);
      }
      if (payload.syncState?.length) {
        await db.syncState.bulkPut(payload.syncState);
      }
      if (payload.settings?.length) {
        await db.settings.bulkPut(payload.settings);
      }
      if (payload.vectorStore?.snapshot) {
        const snapshot = base64ToBuffer(payload.vectorStore.snapshot);
        // @ts-ignore
        await db.table('vectorStore').put({
          id: payload.vectorStore.id || 'main',
          version: payload.vectorStore.version,
          snapshot
        });
      }
    });
  }
};
