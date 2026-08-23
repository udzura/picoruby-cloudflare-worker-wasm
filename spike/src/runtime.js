const encoder = new TextEncoder();
const decoder = new TextDecoder();

function copyToWasm(module, bytes) {
  const size = Math.max(bytes.byteLength, 1);
  const pointer = module._malloc(size);
  if (pointer === 0) {
    throw new Error("PicoRuby Wasm allocation failed");
  }
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

function readWasmString(module, pointer, length) {
  if (pointer === 0 || length === 0) return "";
  return decoder.decode(module.HEAPU8.subarray(pointer, pointer + length));
}

function readRuntimeError(module) {
  return readWasmString(
    module,
    module._picorb_worker_error_ptr(),
    module._picorb_worker_error_len(),
  );
}

export async function createRuntime(createPicoRuby, wasmModule, appBytecode) {
  const module = await createPicoRuby({
    instantiateWasm(imports, successCallback) {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      successCallback(instance, wasmModule);
      return instance.exports;
    },
  });

  const bytecode = new Uint8Array(appBytecode);
  const pointer = copyToWasm(module, bytecode);
  try {
    const status = module._picorb_worker_init(pointer, bytecode.byteLength);
    if (status !== 0) {
      throw new Error(`PicoRuby initialization failed: ${readRuntimeError(module)}`);
    }
  } finally {
    module._free(pointer);
  }
  return module;
}

export function dispatch(module, request) {
  const method = encoder.encode(request.method);
  const url = encoder.encode(request.url);
  const methodPointer = copyToWasm(module, method);
  const urlPointer = copyToWasm(module, url);

  try {
    const status = module._picorb_worker_dispatch(
      methodPointer,
      method.byteLength,
      urlPointer,
      url.byteLength,
    );
    if (status !== 0) {
      throw new Error(`PicoRuby dispatch failed: ${readRuntimeError(module)}`);
    }
    return readWasmString(
      module,
      module._picorb_worker_result_ptr(),
      module._picorb_worker_result_len(),
    );
  } finally {
    module._free(urlPointer);
    module._free(methodPointer);
  }
}
