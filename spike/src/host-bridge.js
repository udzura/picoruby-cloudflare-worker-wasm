const RESULT_MAGIC = new Uint8Array([0x50, 0x48, 0x42, 0x31]); // PHB1
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const HostResultKind = Object.freeze({
  ok: 0,
  missing: 1,
  error: 2,
});

export class HostBridgeError extends Error {
  constructor(message) {
    super(message);
    this.name = "HostBridgeError";
  }
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError("Host bridge payload must be a Uint8Array or ArrayBuffer");
}

function writeU32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function readU32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

export function encodeHostResult(kind, payload = new Uint8Array()) {
  if (!Number.isInteger(kind) || kind < HostResultKind.ok || kind > HostResultKind.error) {
    throw new TypeError("Invalid host bridge result kind");
  }

  const bytes = asBytes(payload);
  const result = new Uint8Array(12 + bytes.byteLength);
  result.set(RESULT_MAGIC, 0);
  writeU32(result, 4, kind);
  writeU32(result, 8, bytes.byteLength);
  result.set(bytes, 12);
  return result;
}

export function decodeHostResult(frame) {
  const bytes = asBytes(frame);
  if (bytes.byteLength < 12) throw new HostBridgeError("Truncated PicoRuby host bridge result");

  for (let index = 0; index < RESULT_MAGIC.byteLength; index += 1) {
    if (bytes[index] !== RESULT_MAGIC[index]) {
      throw new HostBridgeError("Unsupported PicoRuby host bridge result");
    }
  }

  const kind = readU32(bytes, 4);
  const length = readU32(bytes, 8);
  if (kind > HostResultKind.error || length !== bytes.byteLength - 12) {
    throw new HostBridgeError("Invalid PicoRuby host bridge result");
  }
  return { kind, payload: bytes.slice(12) };
}

export async function captureHostCall(operation) {
  try {
    return encodeOperationResult(await operation());
  } catch (error) {
    return encodeHostError(error);
  }
}

export function captureHostCallSync(operation) {
  try {
    return encodeOperationResult(operation());
  } catch (error) {
    return encodeHostError(error);
  }
}

function encodeOperationResult(result) {
  if (!result || typeof result !== "object") {
    throw new TypeError("Host bridge operation must return a result object");
  }
  return encodeHostResult(result.kind, result.payload);
}

function encodeHostError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return encodeHostResult(HostResultKind.error, encoder.encode(message));
}

export function hostOk(payload) {
  return { kind: HostResultKind.ok, payload: asBytes(payload) };
}

export function hostMissing() {
  return { kind: HostResultKind.missing, payload: new Uint8Array() };
}

export function hostErrorMessage(frame) {
  const result = decodeHostResult(frame);
  return result.kind === HostResultKind.error ? decoder.decode(result.payload) : null;
}

export function utf8(value) {
  return encoder.encode(value);
}
