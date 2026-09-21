import assert from "node:assert/strict";

import { decodeQueueResponse, dispatchQueue } from "../src/runtime.js";

const encoder = new TextEncoder();

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function string(value) {
  const bytes = encoder.encode(value);
  return [u32(bytes.byteLength), bytes];
}

function frame(parts) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

const response = frame([
  encoder.encode("PQR1"),
  u32(0), u32(0), u32(1),
  u32(1), u32(0),
  u32(1),
  ...string("info"),
  ...string('{"queue":"events","count":1}'),
  ...string("Queue batch processed"),
]);

assert.deepEqual(decodeQueueResponse(response, 1), {
  batch: { kind: 0, delaySeconds: 0 },
  messages: [{ kind: 1, delaySeconds: 0 }],
  log: {
    level: "info",
    metadata: { queue: "events", count: 1 },
    message: "Queue batch processed",
  },
});

const heap = new Uint8Array(4096);
heap.set(response, 1024);
const module = {
  HEAPU8: heap,
  _malloc() { return 1; },
  _free() {},
  async ccall() { return 0; },
  _picorb_worker_response_ptr() { return 1024; },
  _picorb_worker_response_len() { return response.byteLength; },
};
const calls = [];
const batch = {
  queue: "events",
  messages: [{
    id: "message-1",
    timestamp: new Date(1_700_000_000_000),
    body: "body",
    attempts: 1,
    ack() { calls.push("ack"); },
    retry() { calls.push("retry"); },
  }],
  ackAll() { calls.push("ack-all"); },
  retryAll() { calls.push("retry-all"); },
};
const logs = [];
const originalInfo = console.info;
console.info = (message, metadata) => logs.push([message, metadata]);
try {
  await dispatchQueue(module, batch);
} finally {
  console.info = originalInfo;
}
assert.deepEqual(calls, ["ack"]);
assert.deepEqual(logs, [["Queue batch processed", { queue: "events", count: 1 }]]);

console.log("PicoRuby Queue codec and logging tests passed");
