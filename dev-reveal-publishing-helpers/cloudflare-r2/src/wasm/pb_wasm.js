/**
 * ESM wrapper for pb_wasm — Cloudflare Workers compatible.
 * Imports WASM binary via Workers CompiledWasm rule.
 */
import wasmModule from './pb_wasm_bg.wasm';

// ── Internals ────────────────────────────────────────────────────────

let wasm;
let WASM_VECTOR_LEN = 0;
let cachedDataViewMemory0 = null;
let cachedUint8ArrayMemory0 = null;
const cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return { read: arg.length, written: buf.length };
    };
}

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }
    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;
    const mem = getUint8ArrayMemory0();
    let offset = 0;
    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) { arg = arg.slice(offset); }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);
        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }
    WASM_VECTOR_LEN = offset;
    return ptr;
}

function isLikeNone(x) { return x === undefined || x === null; }

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

function handleError(f, args) {
    try { return f.apply(this, args); }
    catch (e) { const idx = addToExternrefTable0(e); wasm.__wbindgen_exn_store(idx); }
}

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_8c4e43fe74559d73: function(arg0, arg1) { return Error(getStringFromWasm0(arg0, arg1)); },
        __wbg_String_8f0eb39a4a4c2f66: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_0095a73b8b156f76: function(arg0) { return typeof(arg0) === 'function'; },
        __wbg___wbindgen_is_object_5ae8e5880f2c1fbd: function(arg0) { const val = arg0; return typeof(val) === 'object' && val !== null; },
        __wbg___wbindgen_is_string_cd444516edc5b180: function(arg0) { return typeof(arg0) === 'string'; },
        __wbg___wbindgen_is_undefined_9e4d92534c42d778: function(arg0) { return arg0 === undefined; },
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) { throw new Error(getStringFromWasm0(arg0, arg1)); },
        __wbg_call_389efe28435a9388: function() { return handleError(function (arg0, arg1) { return arg0.call(arg1); }, arguments); },
        __wbg_call_4708e0c13bdc8e95: function() { return handleError(function (arg0, arg1, arg2) { return arg0.call(arg1, arg2); }, arguments); },
        __wbg_crypto_86f2631e91b51511: function(arg0) { return arg0.crypto; },
        __wbg_getRandomValues_b3f15fcbfabb0f8b: function() { return handleError(function (arg0, arg1) { arg0.getRandomValues(arg1); }, arguments); },
        __wbg_length_32ed9a279acd054c: function(arg0) { return arg0.length; },
        __wbg_msCrypto_d562bbe83e0d4b91: function(arg0) { return arg0.msCrypto; },
        __wbg_new_361308b2356cecd0: function() { return new Object(); },
        __wbg_new_3eb36ae241fe6f44: function() { return new Array(); },
        __wbg_new_dca287b076112a51: function() { return new Map(); },
        __wbg_new_no_args_1c7c842f08d00ebb: function(arg0, arg1) { return new Function(getStringFromWasm0(arg0, arg1)); },
        __wbg_new_with_length_a2c39cbe88fd8ff1: function(arg0) { return new Uint8Array(arg0 >>> 0); },
        __wbg_node_e1f24f89a7336c2e: function(arg0) { return arg0.node; },
        __wbg_process_3975fd6c72f520aa: function(arg0) { return arg0.process; },
        __wbg_prototypesetcall_bdcdcc5842e4d77d: function(arg0, arg1, arg2) { Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2); },
        __wbg_randomFillSync_f8c153b79f285817: function() { return handleError(function (arg0, arg1) { arg0.randomFillSync(arg1); }, arguments); },
        __wbg_require_b74f47fc2d022fd6: function() { return handleError(function () { return module.require; }, arguments); },
        __wbg_set_1eb0999cf5d27fc8: function(arg0, arg1, arg2) { return arg0.set(arg1, arg2); },
        __wbg_set_3f1d0b984ed272ed: function(arg0, arg1, arg2) { arg0[arg1] = arg2; },
        __wbg_set_f43e577aea94465b: function(arg0, arg1, arg2) { arg0[arg1 >>> 0] = arg2; },
        __wbg_static_accessor_GLOBAL_12837167ad935116: function() { const ret = typeof global === 'undefined' ? null : global; return isLikeNone(ret) ? 0 : addToExternrefTable0(ret); },
        __wbg_static_accessor_GLOBAL_THIS_e628e89ab3b1c95f: function() { const ret = typeof globalThis === 'undefined' ? null : globalThis; return isLikeNone(ret) ? 0 : addToExternrefTable0(ret); },
        __wbg_static_accessor_SELF_a621d3dfbb60d0ce: function() { const ret = typeof self === 'undefined' ? null : self; return isLikeNone(ret) ? 0 : addToExternrefTable0(ret); },
        __wbg_static_accessor_WINDOW_f8727f0cf888e0bd: function() { const ret = typeof window === 'undefined' ? null : window; return isLikeNone(ret) ? 0 : addToExternrefTable0(ret); },
        __wbg_subarray_a96e1fef17ed23cb: function(arg0, arg1, arg2) { return arg0.subarray(arg1 >>> 0, arg2 >>> 0); },
        __wbg_versions_4e31226f5e8dc909: function(arg0) { return arg0.versions; },
        __wbindgen_cast_0000000000000001: function(arg0) { return arg0; },
        __wbindgen_cast_0000000000000002: function(arg0) { return arg0; },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) { return getArrayU8FromWasm0(arg0, arg1); },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) { return getStringFromWasm0(arg0, arg1); },
        __wbindgen_cast_0000000000000005: function(arg0) { return BigInt.asUintN(64, arg0); },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return { __proto__: null, "./pb_wasm_bg.js": import0 };
}

// ── WASM instantiation (Workers: import gives WebAssembly.Module) ────
const instance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
wasm = instance.exports;
wasm.__wbindgen_start();

// ── Exported functions ───────────────────────────────────────────────

export function createCommitment(params_json, private_key_hex) {
    const ptr0 = passStringToWasm0(params_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(private_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.createCommitment(ptr0, len0, ptr1, len1);
    if (ret[2]) { throw takeFromExternrefTable0(ret[1]); }
    return takeFromExternrefTable0(ret[0]);
}

export function drandNextRoundAfter(unix_time) { return BigInt.asUintN(64, wasm.drandNextRoundAfter(unix_time)); }
export function drandRoundTime(round) { return wasm.drandRoundTime(round); }
export function drandTimeToRound(unix_time) { return BigInt.asUintN(64, wasm.drandTimeToRound(unix_time)); }

export function encodeDIDKey(public_key_hex) {
    let deferred3_0, deferred3_1;
    try {
        const ptr0 = passStringToWasm0(public_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.encodeDIDKey(ptr0, len0);
        var ptr2 = ret[0], len2 = ret[1];
        if (ret[3]) { ptr2 = 0; len2 = 0; throw takeFromExternrefTable0(ret[2]); }
        deferred3_0 = ptr2; deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally { wasm.__wbindgen_free(deferred3_0, deferred3_1, 1); }
}

export function generateKeypair() {
    const ret = wasm.generateKeypair();
    if (ret[2]) { throw takeFromExternrefTable0(ret[1]); }
    return takeFromExternrefTable0(ret[0]);
}

export function hashBytes(data) {
    let deferred2_0, deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.hashBytes(ptr0, len0);
        deferred2_0 = ret[0]; deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally { wasm.__wbindgen_free(deferred2_0, deferred2_1, 1); }
}

export function hashManifest(manifest_json) {
    let deferred3_0, deferred3_1;
    try {
        const ptr0 = passStringToWasm0(manifest_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.hashManifest(ptr0, len0);
        var ptr2 = ret[0], len2 = ret[1];
        if (ret[3]) { ptr2 = 0; len2 = 0; throw takeFromExternrefTable0(ret[2]); }
        deferred3_0 = ptr2; deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally { wasm.__wbindgen_free(deferred3_0, deferred3_1, 1); }
}

export function prngNext(seed_hex, index) {
    const ptr0 = passStringToWasm0(seed_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.prngNext(ptr0, len0, index);
    if (ret[2]) { throw takeFromExternrefTable0(ret[1]); }
    return takeFromExternrefTable0(ret[0]);
}

export function selectBatch(items_json, beacon_randomness_hex, count) {
    const ptr0 = passStringToWasm0(items_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(beacon_randomness_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.selectBatch(ptr0, len0, ptr1, len1, count);
    if (ret[2]) { throw takeFromExternrefTable0(ret[1]); }
    return takeFromExternrefTable0(ret[0]);
}

export function selectPerItem(beacon_randomness_hex, commitment_hash, item_hash, reveal_probability) {
    const ptr0 = passStringToWasm0(beacon_randomness_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(commitment_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(item_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.selectPerItem(ptr0, len0, ptr1, len1, ptr2, len2, reveal_probability);
    if (ret[2]) { throw takeFromExternrefTable0(ret[1]); }
    return ret[0] !== 0;
}

export function signMessage(private_key_hex, message) {
    let deferred4_0, deferred4_1;
    try {
        const ptr0 = passStringToWasm0(private_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.signMessage(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0], len3 = ret[1];
        if (ret[3]) { ptr3 = 0; len3 = 0; throw takeFromExternrefTable0(ret[2]); }
        deferred4_0 = ptr3; deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally { wasm.__wbindgen_free(deferred4_0, deferred4_1, 1); }
}

export function threshold(p) {
    let deferred1_0, deferred1_1;
    try {
        const ret = wasm.threshold(p);
        deferred1_0 = ret[0]; deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally { wasm.__wbindgen_free(deferred1_0, deferred1_1, 1); }
}

export function verifyCommitment(commitment_json) {
    const ptr0 = passStringToWasm0(commitment_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.verifyCommitment(ptr0, len0);
    if (ret[2]) { throw takeFromExternrefTable0(ret[1]); }
    return ret[0] !== 0;
}

export function verifySignature(did_key, message, signature_hex) {
    const ptr0 = passStringToWasm0(did_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(signature_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.verifySignature(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) { throw takeFromExternrefTable0(ret[1]); }
    return ret[0] !== 0;
}
