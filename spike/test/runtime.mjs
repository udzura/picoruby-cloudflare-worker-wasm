import assert from "node:assert/strict";
import fs from "node:fs";

import createPicoRuby from "../dist/picoruby-worker.js";
import {
  closeRuntime,
  createCloudflareKvBindings,
  createRuntime,
  dispatch,
  handleRequest,
  mergeBindings,
  RequestBodyTooLargeError,
} from "../src/runtime.js";

const wasmModule = new WebAssembly.Module(
  fs.readFileSync(new URL("../dist/picoruby-worker.wasm", import.meta.url)),
);
const appBytecode = fs.readFileSync(new URL("../dist/app.bin", import.meta.url));
const kvAppBytecode = fs.readFileSync(new URL("../dist/kv_app.bin", import.meta.url));
const imports = WebAssembly.Module.imports(wasmModule);
const allowedWasiImports = new Set([
  "fd_close",
  "fd_fdstat_get",
  "fd_seek",
  "fd_write",
]);
const unexpectedWasiImports = imports.filter(
  ({ module, name }) =>
    module.startsWith("wasi_") &&
    (module !== "wasi_snapshot_preview1" || !allowedWasiImports.has(name)),
);
assert.deepEqual(
  unexpectedWasiImports,
  [],
  "only Emscripten-provided stdio shims may use the WASI namespace",
);

assert.throws(
  () => mergeBindings({ picorbWorkerExample: async () => {} }, { picorbWorkerExample: async () => {} }),
  /Duplicate PicoRuby Worker binding: picorbWorkerExample/,
);

const runtime = await createRuntime(
  createPicoRuby,
  wasmModule,
  appBytecode,
);

const versionResponse = await dispatch(
  runtime,
  new Request("https://example.com/ruby_version"),
);
assert.equal(versionResponse.status, 200);
assert.match(await versionResponse.text(), /^PicoRuby .+ \| mruby .+ \(Ruby .+\)$/);

const factorialResponse = await dispatch(
  runtime,
  new Request("https://example.com/factorial"),
);
assert.equal(await factorialResponse.text(), "factorial(6) = 720");

const sinatraResponse = await dispatch(
  runtime,
  new Request("https://example.com/sinatra/codex"),
);
assert.equal(sinatraResponse.status, 200);
assert.equal(
  await sinatraResponse.text(),
  "Hello, codex from Sinatra 4.2.1 on PicoRuby",
);

const requestBody = new Uint8Array([0, 1, 2, 255]);
const echoResponse = await dispatch(
  runtime,
  new Request("https://example.com/echo?name=pico", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: requestBody,
    duplex: "half",
  }),
);
assert.equal(echoResponse.status, 201);
assert.equal(echoResponse.headers.get("x-request-method"), "POST");
assert.equal(echoResponse.headers.get("x-query-string"), "name=pico");
assert.deepEqual(new Uint8Array(await echoResponse.arrayBuffer()), requestBody);
if (typeof echoResponse.headers.getSetCookie === "function") {
  assert.deepEqual(echoResponse.headers.getSetCookie(), [
    "first=1; Path=/",
    "second=2; Path=/",
  ]);
}

const headResponse = await dispatch(
  runtime,
  new Request("https://example.com/hello", { method: "HEAD" }),
);
assert.equal(headResponse.status, 200);
assert.equal((await headResponse.arrayBuffer()).byteLength, 0);

const debugResponse = await dispatch(
  runtime,
  new Request("https://example.com/debug/request?name=pico", {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      "x-debug-header": "visible",
    },
    body: "debug body",
    duplex: "half",
  }),
);
const debugBody = await debugResponse.text();
assert.equal(debugResponse.status, 200);
assert.match(debugBody, /REQUEST_METHOD="POST"/);
assert.match(debugBody, /PATH_INFO="\/debug\/request"/);
assert.match(debugBody, /QUERY_STRING="name=pico"/);
assert.match(debugBody, /HTTP_X_DEBUG_HEADER="visible"/);
assert.match(debugBody, /rack\.input\.bytesize=10/);
assert.match(debugBody, /rack\.input="debug body"/);

const errorResponse = await dispatch(
  runtime,
  new Request("https://example.com/debug/raise"),
);
assert.equal(errorResponse.status, 500);
assert.equal(
  await errorResponse.text(),
  "handled by Sinatra error handler: RuntimeError",
);

const recoveredResponse = await dispatch(
  runtime,
  new Request("https://example.com/factorial"),
);
assert.equal(
  await recoveredResponse.text(),
  "factorial(6) = 720",
  "the PicoRuby VM remains usable after an application exception",
);

const missingResponse = await dispatch(
  runtime,
  new Request("https://example.com/missing"),
);
assert.equal(missingResponse.status, 404);
assert.equal(await missingResponse.text(), "<h1>Not Found</h1>");

const jspiResponse = await dispatch(
  runtime,
  new Request("https://example.com/debug/jspi"),
);
assert.equal(await jspiResponse.text(), "jspi_add=42,50");

await assert.rejects(
  dispatch(
    runtime,
    new Request("https://example.com/echo", {
      method: "POST",
      body: new Uint8Array([1, 2, 3, 4]),
      duplex: "half",
    }),
    { maxRequestBodyBytes: 3 },
  ),
  RequestBodyTooLargeError,
);

await closeRuntime(runtime);

let createdRuntimeCount = 0;
let asyncHostCallCount = 0;
const countedCreatePicoRuby = async (options) => {
  createdRuntimeCount += 1;
  return await createPicoRuby(options);
};

const firstVmResponse = await handleRequest(
  countedCreatePicoRuby,
  wasmModule,
  appBytecode,
  new Request("https://example.com/factorial"),
  {
    picorbWorkerJspiAdd: async (left, right) => {
      asyncHostCallCount += 1;
      await Promise.resolve();
      return left + right;
    },
  },
);
assert.equal(await firstVmResponse.text(), "factorial(6) = 720");
assert.equal(asyncHostCallCount, 0, "ordinary requests do not call the async host");

const secondVmResponse = await handleRequest(
  countedCreatePicoRuby,
  wasmModule,
  appBytecode,
  new Request("https://example.com/debug/jspi"),
  {
    picorbWorkerJspiAdd: async (left, right) => {
      asyncHostCallCount += 1;
      await Promise.resolve();
      return left + right;
    },
  },
);
assert.equal(await secondVmResponse.text(), "jspi_add=42,50");
assert.equal(createdRuntimeCount, 2, "each request gets a fresh PicoRuby VM");
assert.equal(asyncHostCallCount, 2, "Ruby resumes across repeated async host calls");

const kvStore = new Map();
const expectedKvValue = new TextEncoder().encode("PicoRuby KV\u0000value");
const kvBindings = createCloudflareKvBindings({
  PICORUBY_KV: {
    async get(key, type) {
      assert.equal(type, "arrayBuffer");
      const value = kvStore.get(key);
      return value === undefined ? null : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    },
    async put(key, value) {
      kvStore.set(key, new Uint8Array(value));
    },
  },
});
const kvRuntime = await createRuntime(createPicoRuby, wasmModule, kvAppBytecode, kvBindings);

const missingKvResponse = await dispatch(
  kvRuntime,
  new Request("https://example.com/kv/get"),
);
assert.equal(await missingKvResponse.text(), "missing");

const setKvResponse = await dispatch(
  kvRuntime,
  new Request("https://example.com/kv/set"),
);
assert.equal(await setKvResponse.text(), "kv_set");
assert.deepEqual(kvStore.get("spike-key"), expectedKvValue);

const getKvResponse = await dispatch(
  kvRuntime,
  new Request("https://example.com/kv/get"),
);
assert.deepEqual(
  new Uint8Array(await getKvResponse.arrayBuffer()),
  kvStore.get("spike-key"),
);

await closeRuntime(kvRuntime);

console.log("PicoRuby Rack runtime tests passed");
