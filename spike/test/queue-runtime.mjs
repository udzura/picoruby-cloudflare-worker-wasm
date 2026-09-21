import assert from "node:assert/strict";
import fs from "node:fs";

import createPicoRuby from "../dist/picoruby-worker.js";
import {
  closeRuntime,
  createRuntime,
  decodeQueueResponse,
  dispatchQueue,
  encodeQueueBatch,
} from "../src/runtime.js";

const wasmModule = new WebAssembly.Module(
  fs.readFileSync(new URL("../dist/picoruby-worker.wasm", import.meta.url)),
);
const appBytecode = fs.readFileSync(new URL("../dist/queue_app.bin", import.meta.url));

function queueBatch(bodies) {
  const calls = [];
  const messages = bodies.map((body, index) => ({
    id: `message-${index + 1}`,
    timestamp: new Date(1_700_000_000_000 + index),
    body,
    attempts: index + 1,
    ack() { calls.push(["ack", index]); },
    retry(options) { calls.push(["retry", index, options]); },
  }));
  return {
    queue: "events",
    messages,
    ackAll() { calls.push(["ack-all"]); },
    retryAll(options) { calls.push(["retry-all", options]); },
    calls,
  };
}

const encoded = encodeQueueBatch(queueBatch(["ack"]));
assert.equal(new TextDecoder().decode(encoded.subarray(0, 4)), "PCQ1");
assert.throws(
  () => encodeQueueBatch({ queue: "events", messages: [{ id: "id", timestamp: new Date(), body: {}, attempts: 1 }] }),
  /string ID and body/,
);
assert.throws(
  () => decodeQueueResponse(new Uint8Array([0]), 0),
  /Truncated PicoRuby Worker response frame/,
);

const runtime = await createRuntime(createPicoRuby, wasmModule, appBytecode);
try {
  const individual = queueBatch(["ack", "retry", "middleware"]);
  await dispatchQueue(runtime, individual);
  assert.deepEqual(individual.calls, [
    ["ack", 0],
    ["retry", 1, { delaySeconds: 12 }],
    ["ack", 2],
  ]);

  const all = queueBatch(["ack-all", "retry-all"]);
  await dispatchQueue(runtime, all);
  assert.deepEqual(all.calls, [["retry-all", { delaySeconds: 30 }]]);

  const failed = queueBatch(["raise"]);
  await assert.rejects(dispatchQueue(runtime, failed), /Queue consumer failure/);
  assert.deepEqual(failed.calls, []);
} finally {
  await closeRuntime(runtime);
}

console.log("PicoRuby Queue runtime tests passed");
