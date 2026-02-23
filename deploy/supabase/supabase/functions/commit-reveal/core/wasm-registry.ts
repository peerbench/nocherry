/**
 * WASM dependency injection — each deployment target registers its
 * platform-specific WASM module at startup, core modules call getWasm().
 */

import type { WasmInterface } from './types.ts'

let wasmModule: WasmInterface | null = null;

export function registerWasm(wasm: WasmInterface): void {
  wasmModule = wasm;
}

export function getWasm(): WasmInterface {
  if (!wasmModule) {
    throw new Error('WASM not registered — call registerWasm() at startup');
  }
  return wasmModule;
}
