import assert from "node:assert/strict";
import fs from "node:fs";
import createPicoRuby from "../dist/picoruby-worker.js";
import { createCloudflareBindings, handleRequest } from "../src/runtime.js";

const wasm = new WebAssembly.Module(fs.readFileSync(new URL("../dist/picoruby-worker.wasm", import.meta.url)));
const app = fs.readFileSync(new URL("../dist/ai_proxy_stream_app.bin", import.meta.url));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const logs = [];
const originalLog = console.log;
console.log = (...values) => { logs.push(values.join(" ")); };
let upstream;
let resolveCall;
const called = new Promise(resolve => { resolveCall = resolve; });
const ai = { run(model, input) {
  const stream = new ReadableStream({ start(controller) { upstream = controller; } }, { highWaterMark: 0 });
  resolveCall({ model, input });
  return stream;
} };
const bindings = createCloudflareBindings({ AI: ai }, { AI: "ai" });
const request = new Request("https://example.test/api/chat", { method: "POST", body: "Tell me a story" });
const response = await handleRequest(createPicoRuby, wasm, app, request, bindings);
assert.equal(response.status, 200);
assert.equal(response.headers.get("content-type"), "text/event-stream");
const call = await called;
assert.equal(call.model, "@cf/zai-org/glm-4.7-flash");
assert.equal(call.input.messages[0].content, "Tell me a story");
assert.equal(call.input.stream, true);
assert.equal(call.input.max_completion_tokens, 128);

const reader = response.body.getReader();
upstream.enqueue(encoder.encode("data: one"));
assert.equal(decoder.decode((await reader.read()).value), "data: one");
assert.equal(logs.length, 0, "an incomplete line must not be logged");
upstream.enqueue(encoder.encode("\n\n"));
assert.equal(decoder.decode((await reader.read()).value), "\n\n");
assert.ok(logs.some(line => line.includes("data: one")));
upstream.enqueue(encoder.encode("data: two\n\n"));
assert.equal(decoder.decode((await reader.read()).value), "data: two\n\n");
upstream.close();
assert.equal((await reader.read()).done, true);
assert.ok(logs.some(line => line.includes("data: two")));

console.log = originalLog;
console.log("Ruby AI stream proxy: forwarded request, incremental SSE and line logging passed");
