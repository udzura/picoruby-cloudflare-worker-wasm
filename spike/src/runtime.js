const ABI_VERSION = 1;
const REQUEST_MAGIC = new Uint8Array([0x50, 0x52, 0x51, 0x31]); // PRQ1
const RESPONSE_MAGIC = new Uint8Array([0x50, 0x52, 0x52, 0x31]); // PRR1
const DEFAULT_MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class RequestBodyTooLargeError extends Error {
  constructor(limit) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

async function unavailableKvGet() {
  throw new Error("PICORUBY_KV binding is not configured");
}

async function unavailableKvSet() {
  throw new Error("PICORUBY_KV binding is not configured");
}

const defaultRuntimeBindings = {
  picorbWorkerJspiAdd: async (left, right) => {
    await Promise.resolve();
    return left + right;
  },
  picorbWorkerKvGet: unavailableKvGet,
  picorbWorkerKvSet: unavailableKvSet,
};

export function mergeBindings(...bindingSets) {
  const bindings = {};

  for (const bindingSet of bindingSets) {
    if (!bindingSet || typeof bindingSet !== "object" || Array.isArray(bindingSet)) {
      throw new TypeError("PicoRuby Worker bindings must be an object");
    }

    for (const [name, callback] of Object.entries(bindingSet)) {
      if (!name.startsWith("picorbWorker") || typeof callback !== "function") {
        throw new TypeError(`Invalid PicoRuby Worker binding: ${name}`);
      }
      if (Object.hasOwn(bindings, name)) {
        throw new Error(`Duplicate PicoRuby Worker binding: ${name}`);
      }
      bindings[name] = callback;
    }
  }

  return bindings;
}

export function createCloudflareKvBindings(env) {
  const namespace = env.PICORUBY_KV;
  if (!namespace || typeof namespace.get !== "function" || typeof namespace.put !== "function") {
    throw new Error("PICORUBY_KV binding is not configured");
  }

  return {
    picorbWorkerKvGet: async (key) => {
      const value = await namespace.get(key, "arrayBuffer");
      return value === null ? null : new Uint8Array(value);
    },
    picorbWorkerKvSet: async (key, value) => {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      await namespace.put(key, bytes.buffer);
    },
  };
}

class FrameWriter {
  constructor() {
    this.parts = [];
    this.length = 0;
  }

  appendBytes(bytes) {
    this.parts.push(bytes);
    this.length += bytes.byteLength;
  }

  appendU32(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error(`Value cannot be encoded as u32: ${value}`);
    }
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.appendBytes(bytes);
  }

  appendString(value) {
    this.appendLengthPrefixedBytes(encoder.encode(value));
  }

  appendLengthPrefixedBytes(bytes) {
    this.appendU32(bytes.byteLength);
    this.appendBytes(bytes);
  }

  finish() {
    const frame = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      frame.set(part, offset);
      offset += part.byteLength;
    }
    return frame;
  }
}

class FrameReader {
  constructor(frame) {
    this.frame = frame;
    this.offset = 0;
  }

  readBytes(length) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.frame.byteLength) {
      throw new Error("Truncated PicoRuby Worker response frame");
    }
    const bytes = this.frame.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  readU32() {
    const bytes = this.readBytes(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }

  readString() {
    return decoder.decode(this.readBytes(this.readU32()));
  }

  finish() {
    if (this.offset !== this.frame.byteLength) {
      throw new Error("PicoRuby Worker response frame has trailing bytes");
    }
  }
}

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

async function readRequestBody(request, limit) {
  if (!request.body) return new Uint8Array();

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
      throw new RequestBodyTooLargeError(limit);
    }
  }

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel("PicoRuby request body limit exceeded");
        throw new RequestBodyTooLargeError(limit);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function encodeRackRequest(request, options = {}) {
  const maxRequestBodyBytes = options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  const url = new URL(request.url);
  const scheme = url.protocol.slice(0, -1);
  const port = url.port || (scheme === "https" ? "443" : "80");
  const protocol = request.cf?.httpProtocol || "HTTP/1.1";
  const headers = Array.from(request.headers.entries());
  const body = await readRequestBody(request, maxRequestBodyBytes);

  const writer = new FrameWriter();
  writer.appendBytes(REQUEST_MAGIC);
  writer.appendString(request.method);
  writer.appendString(scheme);
  writer.appendString(url.hostname);
  writer.appendString(port);
  writer.appendString(url.host);
  writer.appendString(url.pathname || "/");
  writer.appendString(url.search.length > 0 ? url.search.slice(1) : "");
  writer.appendString(protocol);
  writer.appendU32(headers.length);
  for (const [name, value] of headers) {
    writer.appendString(name);
    writer.appendString(value);
  }
  writer.appendLengthPrefixedBytes(body);
  return writer.finish();
}

export function decodeRackResponse(frame, requestMethod = "GET") {
  const reader = new FrameReader(frame);
  const magic = reader.readBytes(RESPONSE_MAGIC.byteLength);
  for (let index = 0; index < RESPONSE_MAGIC.byteLength; index += 1) {
    if (magic[index] !== RESPONSE_MAGIC[index]) {
      throw new Error("Unsupported PicoRuby Worker response frame");
    }
  }

  const status = reader.readU32();
  const headerCount = reader.readU32();
  if (status < 200 || status > 599 || headerCount > 1024) {
    throw new Error("Invalid PicoRuby Worker response frame metadata");
  }

  const headers = new Headers();
  for (let index = 0; index < headerCount; index += 1) {
    headers.append(reader.readString(), reader.readString());
  }
  const body = reader.readBytes(reader.readU32()).slice();
  reader.finish();

  const bodyAllowed = requestMethod !== "HEAD" && status !== 204 && status !== 205 && status !== 304;
  return new Response(bodyAllowed ? body : null, { status, headers });
}

export async function createRuntime(createPicoRuby, wasmModule, appBytecode, runtimeBindings = {}) {
  const bindings = mergeBindings(runtimeBindings);
  const module = await createPicoRuby({
    ...defaultRuntimeBindings,
    ...bindings,
    instantiateWasm(imports, successCallback) {
      const instance = new WebAssembly.Instance(wasmModule, imports);
      successCallback(instance, wasmModule);
      return instance.exports;
    },
  });

  const actualAbiVersion = module._picorb_worker_abi_version();
  if (actualAbiVersion !== ABI_VERSION) {
    throw new Error(`PicoRuby Worker ABI ${ABI_VERSION} is required (found ${actualAbiVersion})`);
  }

  const bytecode = new Uint8Array(appBytecode);
  const pointer = copyToWasm(module, bytecode);
  try {
    const status = await module.ccall(
      "picorb_worker_init",
      "number",
      ["number", "number"],
      [pointer, bytecode.byteLength],
      { async: true },
    );
    if (status !== 0) {
      throw new Error(`PicoRuby initialization failed: ${readRuntimeError(module)}`);
    }
  } finally {
    module._free(pointer);
  }
  return module;
}

export async function closeRuntime(module) {
  await module.ccall(
    "picorb_worker_close",
    null,
    [],
    [],
    { async: true },
  );
}

export async function handleRequest(
  createPicoRuby,
  wasmModule,
  appBytecode,
  request,
  ...bindingSets
) {
  const bindings = mergeBindings(...bindingSets);
  const module = await createRuntime(createPicoRuby, wasmModule, appBytecode, bindings);
  try {
    return await dispatch(module, request);
  } finally {
    await closeRuntime(module);
  }
}

export async function dispatch(module, request, requestOptions = {}) {
  const frame = await encodeRackRequest(request, requestOptions);
  const pointer = copyToWasm(module, frame);
  try {
    const status = await module.ccall(
      "picorb_worker_dispatch_v1",
      "number",
      ["number", "number"],
      [pointer, frame.byteLength],
      { async: true },
    );
    if (status !== 0) {
      throw new Error(`PicoRuby dispatch failed: ${readRuntimeError(module)}`);
    }

    const responsePointer = module._picorb_worker_response_ptr();
    const responseLength = module._picorb_worker_response_len();
    const responseFrame = module.HEAPU8.slice(responsePointer, responsePointer + responseLength);
    return decodeRackResponse(responseFrame, request.method);
  } finally {
    module._free(pointer);
  }
}
