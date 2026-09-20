import assert from "node:assert/strict";
import fs from "node:fs";
import createPicoRuby from "../dist/picoruby-worker.js";
import { createCloudflareBindings, createRuntime, closeRuntime, dispatch, handleRequest } from "../src/runtime.js";

const wasm = new WebAssembly.Module(fs.readFileSync(new URL("../dist/picoruby-worker.wasm", import.meta.url)));
const app = fs.readFileSync(new URL("../dist/stream_app.bin", import.meta.url));
const encoder = new TextEncoder();
const upstreams = [];
const bindings = createCloudflareBindings({ AI: { async run() {
  const entry = {};
  upstreams.push(entry);
  return new ReadableStream({
    start(controller) { entry.controller = controller; },
    cancel(reason) { entry.cancelled = reason; },
  }, { highWaterMark: 0 });
} } }, { AI: "ai" });
const request = path => new Request(`https://example.test/${path}`);
// handleRequest has already closed the VM when the first byte arrives.
const response = await handleRequest(createPicoRuby, wasm, app, request("stream"), bindings);
assert.equal(response.headers.get("content-type"), "text/event-stream;charset=utf-8");
assert.equal(response.headers.get("content-length"), null);
const reader = response.body.getReader();
upstreams[0].controller.enqueue(encoder.encode("data: first\n\n"));
assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
upstreams[0].controller.enqueue(encoder.encode("data: second\n\n"));
assert.equal(new TextDecoder().decode((await reader.read()).value), "data: second\n\n");
upstreams[0].controller.close();
assert.equal((await reader.read()).done, true);

const runtimes = await Promise.all([0, 1].map(() => createRuntime(createPicoRuby, wasm, app, bindings)));
const responses = await Promise.all(runtimes.map(runtime => dispatch(runtime, request("stream"))));
await Promise.all(runtimes.map(closeRuntime));
await responses[0].body.cancel("first client left");
assert.equal(upstreams[1].cancelled, "first client left");
assert.equal(upstreams[2].cancelled, undefined);
upstreams[2].controller.enqueue(encoder.encode("isolated"));
upstreams[2].controller.close();
assert.equal(await responses[1].text(), "isolated");

const unused = await handleRequest(createPicoRuby, wasm, app, request("unused"), bindings);
assert.equal(await unused.text(), "unused");
assert.ok(upstreams[3].cancelled);
await assert.rejects(handleRequest(createPicoRuby, wasm, app, request("invalid"), bindings), /header name/);
assert.ok(upstreams[4].cancelled);

const head = await handleRequest(createPicoRuby, wasm, app, new Request("https://example.test/stream", { method: "HEAD" }), bindings);
assert.equal(head.body, null);
assert.ok(upstreams[5].cancelled);

const invalid = createCloudflareBindings({ AI: { run: async () => ({ response: "not a stream" }) } }, { AI: "ai" });
// Sinatra turns application exceptions into a 500. No invalid body crosses the ABI.
const bad = await handleRequest(createPicoRuby, wasm, app, request("stream"), invalid);
assert.equal(bad.status, 500);
console.log("stream Wasm/Sinatra: early response, VM close, isolation, cancellation and discarded bodies passed");
