import assert from "node:assert/strict";
import fs from "node:fs";
import createPicoRuby from "./generated/worker/runtime/picoruby-worker.js";
import { createCloudflareBindings, handleRequest, createRuntime, closeRuntime, dispatch } from "./generated/worker/runtime/runtime.js";
import { createPlugins } from "./generated/worker/plugins.js";
import { mockFetch, plugin, requests, response, aborted, streamController } from "../../../picoruby-ai-sdk-openai/test/openai.mjs";

const wasm = new WebAssembly.Module(fs.readFileSync(new URL("./generated/worker/runtime/picoruby-worker.wasm", import.meta.url)));
const app = fs.readFileSync(new URL("./generated/worker/app.bin", import.meta.url));
const env = { OPENAI_API_KEY: "offline-test", OPENAI_TEXT_MODEL: "test-model", OPENAI_EMBEDDING_MODEL: "embedding-test" };
const request = path => new Request(`https://example.test/${path}`);
const bindings = createCloudflareBindings(env, {}, { plugins: [plugin] });
const generate = await handleRequest(createPicoRuby, wasm, app, request("generate"), bindings);
assert.equal(await generate.text(), "Hello Ruby");
const embed = await handleRequest(createPicoRuby, wasm, app, request("embed"), bindings);
assert.deepEqual((await embed.json()).vectors, [[0.1, 0.2], [1.1, 1.2]]);

const complete = await handleRequest(createPicoRuby, wasm, app, request("stream"), bindings);
const completeReader = complete.body.getReader();
assert.equal(new TextDecoder().decode((await completeReader.read()).value), "first");
const event = value => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
streamController.enqueue(event({ type: "response.output_text.delta", item_id: "msg_mock", output_index: 0, content_index: 0, delta: " Ruby!" }));
assert.equal(new TextDecoder().decode((await completeReader.read()).value), " Ruby!");
streamController.enqueue(event({ type: "response.completed", response }));
streamController.close();
assert.equal((await completeReader.read()).done, true);

const stream = await handleRequest(createPicoRuby, wasm, app, request("stream"), bindings);
assert.equal(stream.headers.get("content-type"), "text/plain; charset=utf-8");
const reader = stream.body.getReader();
assert.equal(new TextDecoder().decode((await reader.read()).value), "first");
await reader.cancel("browser stopped");
assert.equal(aborted, true, "cancellation aborts the SDK request after VM closure");

const missing = createCloudflareBindings({ ...env, OPENAI_API_KEY: undefined }, {}, { plugins: createPlugins() });
await assert.rejects(handleRequest(createPicoRuby, wasm, app, request("generate"), missing), /OPENAI_API_KEY/);
const failing = createCloudflareBindings({ ...env, OPENAI_TEXT_MODEL: "fail" }, {}, { plugins: [plugin] });
await assert.rejects(handleRequest(createPicoRuby, wasm, app, request("generate"), failing), /mock failure/);
const failingStream = await handleRequest(createPicoRuby, wasm, app, request("stream"), failing);
await assert.rejects(failingStream.text(), /mock failure/);

// The same binding set must recreate plugins and stream registries for each VM.
const runtimes = await Promise.all([0, 1].map(() => createRuntime(createPicoRuby, wasm, app, bindings)));
const streams = [];
for (const runtime of runtimes) streams.push(await dispatch(runtime, request("stream")));
await Promise.all(runtimes.map(closeRuntime));
const first = streams[0].body.getReader();
assert.equal(new TextDecoder().decode((await first.read()).value), "first");
await first.cancel("first stopped");
const second = streams[1].body.getReader();
assert.equal(new TextDecoder().decode((await second.read()).value), "first");
await second.cancel("second stopped");

// Exercise the generated registration through createWorker, with only HTTP mocked.
const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch;
try {
  // Node cannot load Worker Wasm or cloudflare:workers imports directly.
  const indexUrl = new URL("./generated/worker/runtime/index.js", import.meta.url);
  const source = fs.readFileSync(indexUrl, "utf8")
    .replace('import wasm from "./picoruby-worker.wasm";',
      `import fs from "node:fs"; const wasm = new WebAssembly.Module(fs.readFileSync(new URL(${JSON.stringify(new URL("./picoruby-worker.wasm", indexUrl).href)})));`)
    .replace('export { PicoRubyDurableObject } from "./durable-object.js";', "")
    .replace(/from "(\.\.?\/[^"]+)"/g, (_match, path) => `from ${JSON.stringify(new URL(path, indexUrl).href)}`);
  const { createWorker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const worker = createWorker({ app, bindingTypes: {} });
  const generated = await worker.fetch(request("generate"), env, {});
  assert.equal(generated.status, 200);
  assert.equal(await generated.text(), "Hello Ruby");
} finally { globalThis.fetch = originalFetch; }
assert.ok(requests.some(({ url }) => url.endsWith("/responses")));
assert.ok(requests.some(({ url }) => url.endsWith("/embeddings")));
console.log("OpenAI Wasm/Rack: local mrbgem, generated registration, generation, embedding, streaming, cancellation, errors and VM isolation passed");
