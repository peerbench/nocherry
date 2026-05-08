/**
 * WASM dependency injection — each deployment target registers its
 * platform-specific WASM module at startup, core modules call getWasm().
 *
 * When multiple nocherry packages (@nocherry/sdk + @nocherry/server) are
 * loaded into the same process, each registers independently. The identity
 * check below makes a duplicate-copy bug fail loudly at boot rather than
 * silently overwriting the registry — guards against subtle ABI drift when
 * npm hoists two physically distinct @nocherry/pb-wasm instances.
 */

import type { WasmInterface } from './types.ts'

let wasmModule: WasmInterface | null = null;

export function registerWasm(wasm: WasmInterface): void {
  if (wasmModule && wasmModule !== wasm) {
    throw new Error(
      'wasm registry conflict — multiple @nocherry/pb-wasm instances detected. ' +
      'Pin a single version in your root package.json or use npm overrides to deduplicate.',
    );
  }
  wasmModule = wasm;
}

export function getWasm(): WasmInterface {
  if (!wasmModule) {
    throw new Error('WASM not registered — call registerWasm() at startup');
  }
  return wasmModule;
}
