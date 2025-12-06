/* tslint:disable */
/* eslint-disable */
export interface EmbeddedResource {
    id: string;
    embeddings: number[];
}

export interface Neighbor {
    id: string;
    distance: number;
}

export interface Resource {
    embeddings: EmbeddedResource[];
}

export interface SearchResult {
    neighbors: Neighbor[];
}


export class LunaVDB {
  free(): void;
  [Symbol.dispose](): void;
  static deserialize(index: Uint8Array): LunaVDB;
  add(resource: Resource): void;
  constructor(resource?: Resource | null);
  size(): number;
  clear(): void;
  index(resource: Resource): void;
  remove(ids: string[]): void;
  search(query: Float32Array, k: number): SearchResult;
  serialize(): Uint8Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_lunavdb_free: (a: number, b: number) => void;
  readonly lunavdb_add: (a: number, b: any) => void;
  readonly lunavdb_clear: (a: number) => void;
  readonly lunavdb_deserialize: (a: number, b: number) => number;
  readonly lunavdb_index: (a: number, b: any) => void;
  readonly lunavdb_new: (a: number) => number;
  readonly lunavdb_remove: (a: number, b: number, c: number) => void;
  readonly lunavdb_search: (a: number, b: number, c: number, d: number) => any;
  readonly lunavdb_serialize: (a: number) => [number, number];
  readonly lunavdb_size: (a: number) => number;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
