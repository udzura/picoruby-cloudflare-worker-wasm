import assert from "node:assert/strict";
import { HostStreamRegistry, decodeRackResponse } from "../src/runtime.js";
import { HostResultKind, decodeHostResult, encodeHostResult } from "../src/host-bridge.js";

const encoder = new TextEncoder();
function frame(id, status = 200, mode = 1) {
  const parts = [encoder.encode("PRR2")];
  const u32 = value => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); parts.push(bytes); };
  const string = value => { const bytes = encoder.encode(value); u32(bytes.length); parts.push(bytes); };
  u32(status); u32(2);
  string("content-length"); string("999");
  string("transfer-encoding"); string("chunked");
  u32(mode); u32(id);
  return Uint8Array.from(parts.flatMap(part => [...part]));
}
function register(registry, source) {
  const result = registry.register(source);
  assert.equal(result.kind, HostResultKind.hostStream);
  const decoded = decodeHostResult(encodeHostResult(result.kind, result.payload));
  return new DataView(decoded.payload.buffer).getUint32(0, true);
}
const registry = new HostStreamRegistry();
let upstream;
let pulls = 0;
let cancelled;
const source = new ReadableStream({
  start(controller) { upstream = controller; },
  pull() { pulls++; },
  cancel(reason) { cancelled = reason; },
}, { highWaterMark: 0 });
const id = register(registry, source);
const response = decodeRackResponse(frame(id), "GET", registry);
assert.equal(response.headers.get("content-length"), null);
assert.equal(response.headers.get("transfer-encoding"), null);
assert.equal(pulls, 0, "no eager draining");
registry.discard(); // transferred stream survives VM/registry disposal
const reader = response.body.getReader();
upstream.enqueue(encoder.encode("first"));
assert.equal(new TextDecoder().decode((await reader.read()).value), "first");
assert.throws(() => decodeRackResponse(frame(id), "GET", registry), /already transferred/);
await reader.cancel("browser stopped");
assert.equal(cancelled, "browser stopped");

for (const [method, status] of [["HEAD", 200], ["GET", 204], ["GET", 205], ["GET", 304]]) {
  let calls = 0;
  const id = register(registry, new ReadableStream({ cancel() { calls++; } }));
  const response = decodeRackResponse(frame(id, status), method, registry);
  assert.equal(response.body, null);
  assert.equal(calls, 1);
}
let unused = 0;
register(registry, new ReadableStream({ cancel() { unused++; return Promise.reject(new Error("cancel failed")); } }));
registry.discard(); registry.discard();
assert.equal(unused, 1);

const abort = new AbortController();
let aborted;
const abortId = register(registry, new ReadableStream({ cancel(reason) { aborted = reason; } }));
const abortReader = decodeRackResponse(frame(abortId), "GET", registry, abort.signal).body.getReader();
const pending = abortReader.read();
abort.abort(new Error("disconnected"));
await assert.rejects(pending, /disconnected/);
assert.match(aborted.message, /disconnected/);

let failing;
const failId = register(registry, new ReadableStream({ start(controller) { failing = controller; } }));
const failReader = decodeRackResponse(frame(failId), "GET", registry).body.getReader();
failing.error(new Error("upstream failed"));
await assert.rejects(failReader.read(), /upstream failed/);
assert.throws(() => decodeRackResponse(frame(1, 200, 2), "GET", registry), /body mode/);
assert.throws(() => decodeRackResponse(frame(1).slice(0, -1), "GET", registry), /Truncated/);
assert.throws(() => registry.register({}), /ReadableStream/);
console.log("host streams: incremental read, ownership, cancel, abort, error and framing passed");
