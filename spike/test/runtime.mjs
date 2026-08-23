import assert from "node:assert/strict";
import fs from "node:fs";

import createPicoRuby from "../dist/picoruby-worker.js";
import {
  createRuntime,
  dispatch,
  RequestBodyTooLargeError,
} from "../src/runtime.js";

const wasmModule = new WebAssembly.Module(
  fs.readFileSync(new URL("../dist/picoruby-worker.wasm", import.meta.url)),
);
const imports = WebAssembly.Module.imports(wasmModule);
assert.equal(
  imports.some(({ module }) => module.startsWith("wasi_")),
  false,
  "the Worker runtime must not import WASI",
);

const runtime = await createRuntime(
  createPicoRuby,
  wasmModule,
  fs.readFileSync(new URL("../dist/app.bin", import.meta.url)),
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

await assert.rejects(
  dispatch(runtime, new Request("https://example.com/debug/raise")),
  /PicoRuby dispatch failed: #<RuntimeError: Dummy Rack application error>/,
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
assert.equal(await missingResponse.text(), "Not found");

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

console.log("PicoRuby Rack runtime tests passed");
