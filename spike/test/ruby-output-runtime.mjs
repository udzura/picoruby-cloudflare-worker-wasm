import assert from "node:assert/strict";
import fs from "node:fs";
import createPicoRuby from "../dist/picoruby-worker.js";
import { createCloudflareBindings, handleRequest } from "../src/runtime.js";

const wasm = new WebAssembly.Module(fs.readFileSync(new URL("../dist/picoruby-worker.wasm", import.meta.url)));
const app = fs.readFileSync(new URL("../dist/ruby_output_app.bin", import.meta.url));
const decoder = new TextDecoder();
const bindings = createCloudflareBindings({}, {});

async function withTimeout(promise, stage) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Ruby output stalled at ${stage}`)), 5000))]);
}

const response = await withTimeout(handleRequest(createPicoRuby, wasm, app, new Request("https://example.test/stream"), bindings), "response");
assert.equal(response.status, 200);
const reader = response.body.getReader();
assert.equal(decoder.decode((await withTimeout(reader.read(), "first chunk")).value), "first\n");
assert.equal(decoder.decode((await withTimeout(reader.read(), "second chunk")).value), "second\n");
assert.equal((await withTimeout(reader.read(), "close")).done, true);

const failure = await withTimeout(handleRequest(createPicoRuby, wasm, app, new Request("https://example.test/error"), bindings), "error response");
assert.equal(failure.status, 200);
assert.equal(await withTimeout(failure.text(), "error body"), "first\nStream error: RuntimeError: sample failure\n");

const cancelled = await withTimeout(handleRequest(createPicoRuby, wasm, app, new Request("https://example.test/cancel"), bindings), "cancel response");
const cancelReader = cancelled.body.getReader();
assert.equal(decoder.decode((await withTimeout(cancelReader.read(), "cancel first chunk")).value), "first\n");
await withTimeout(cancelReader.cancel("client left"), "cancel");

console.log("Ruby output stream: early response, chunks, exception, close and cancellation passed");
