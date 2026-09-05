import assert from "node:assert/strict";
import fs from "node:fs";

import createPicoRuby from "../dist/picoruby-worker.js";
import {
  closeRuntime,
  createCloudflareBindings,
  createCloudflareKvBindings,
  createCloudflareQueueBindings,
  createEnvironmentBindings,
  createRuntime,
  dispatch,
  handleRequest,
  mergeBindings,
  RequestBodyTooLargeError,
} from "../src/runtime.js";
import {
  decodeHostResult,
  HostResultKind,
  hostErrorMessage,
} from "../src/host-bridge.js";

const wasmModule = new WebAssembly.Module(
  fs.readFileSync(new URL("../dist/picoruby-worker.wasm", import.meta.url)),
);
const appBytecode = fs.readFileSync(new URL("../dist/app.bin", import.meta.url));
const kvAppBytecode = fs.readFileSync(new URL("../dist/kv_app.bin", import.meta.url));
const bindingsAppBytecode = fs.readFileSync(new URL("../dist/bindings_app.bin", import.meta.url));
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
}, { PICORUBY_KV: "kv" });
const genericKvStore = new Map();
const genericKvOptions = new Map();
const genericKvBindings = createCloudflareKvBindings({
  FIRST_KV: {
    async get(key, type) {
      assert.equal(type, "arrayBuffer");
      const value = genericKvStore.get(key);
      return value === undefined ? null : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    },
    async put(key, value, options) {
      genericKvStore.set(key, new Uint8Array(value));
      genericKvOptions.set(key, options);
    },
  },
}, { FIRST_KV: "kv" });
const genericValue = new Uint8Array([0, 1, 2, 255]);
let hostResult = decodeHostResult(
  await genericKvBindings.picorbWorkerKvPutBridge("FIRST_KV", "binary", genericValue),
);
assert.equal(hostResult.kind, HostResultKind.ok);
assert.deepEqual(genericKvStore.get("binary"), genericValue);
assert.deepEqual(genericKvOptions.get("binary"), {});

hostResult = decodeHostResult(
  await genericKvBindings.picorbWorkerKvPutBridge("FIRST_KV", "ttl", genericValue, '{"ttl":60}'),
);
assert.equal(hostResult.kind, HostResultKind.ok);
assert.deepEqual(genericKvOptions.get("ttl"), { expirationTtl: 60 });
assert.deepEqual(genericKvStore.get("ttl"), genericValue);

for (const optionsJson of [
  "", "{", "null", "[]", "true", "60",
  '{"ttl":59}', '{"ttl":0}', '{"ttl":-1}', '{"ttl":60.5}',
  '{"ttl":"60"}', '{"ttl":false}', '{"ttl":null}',
  '{"ttl":9007199254740992}', '{"ttl":1e309}', '{"unknown":60}',
]) {
  const frame = await genericKvBindings.picorbWorkerKvPutBridge("FIRST_KV", "invalid", genericValue, optionsJson);
  assert.equal(decodeHostResult(frame).kind, HostResultKind.error, optionsJson);
  assert.equal(genericKvStore.has("invalid"), false, "invalid options must not write KV");
}

hostResult = decodeHostResult(
  await genericKvBindings.picorbWorkerKvGetBridge("FIRST_KV", "binary"),
);
assert.equal(hostResult.kind, HostResultKind.ok);
assert.deepEqual(hostResult.payload, genericValue);

hostResult = decodeHostResult(
  await genericKvBindings.picorbWorkerKvGetBridge("FIRST_KV", "missing"),
);
assert.equal(hostResult.kind, HostResultKind.missing);

const missingBindingFrame = await genericKvBindings.picorbWorkerKvGetBridge("MISSING_KV", "key");
hostResult = decodeHostResult(missingBindingFrame);
assert.equal(hostResult.kind, HostResultKind.error);
assert.match(hostErrorMessage(missingBindingFrame), /Cloudflare binding MISSING_KV is not registered/);

const environmentBindings = createEnvironmentBindings({
  TEXT_VALUE: "value",
  JSON_VALUE: { enabled: true, retries: 3 },
  SECRET_VALUE: "not-logged",
  KV_BINDING: { get() {}, put() {} },
}, { KV_BINDING: "kv" });
hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("TEXT_VALUE"));
assert.equal(hostResult.kind, HostResultKind.ok);
assert.equal(new TextDecoder().decode(hostResult.payload), "value");

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("JSON_VALUE"));
assert.equal(hostResult.kind, HostResultKind.ok);
assert.equal(new TextDecoder().decode(hostResult.payload), '{"enabled":true,"retries":3}');

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("SECRET_VALUE"));
assert.equal(hostResult.kind, HostResultKind.ok);
assert.equal(new TextDecoder().decode(hostResult.payload), "not-logged");

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("KV_BINDING"));
assert.equal(hostResult.kind, HostResultKind.missing);

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("MISSING_VALUE"));
assert.equal(hostResult.kind, HostResultKind.missing);

const invalidEnvironmentFrame = await environmentBindings.picorbWorkerEnvGetBridge("");
assert.equal(decodeHostResult(invalidEnvironmentFrame).kind, HostResultKind.error);
assert.match(hostErrorMessage(invalidEnvironmentFrame), /Environment variable name must be a non-empty string/);

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvBindingTypeBridge("KV_BINDING"));
assert.equal(hostResult.kind, HostResultKind.ok);
assert.equal(new TextDecoder().decode(hostResult.payload), "kv");

const sentQueueMessages = [];
const queueBindings = createCloudflareQueueBindings({
  QUEUE_FOO: {
    async send(body, options) {
      sentQueueMessages.push([body, options]);
    },
  },
}, { QUEUE_FOO: "queue" });
hostResult = decodeHostResult(
  await queueBindings.picorbWorkerQueueSendBridge("QUEUE_FOO", new TextEncoder().encode("direct-message")),
);
assert.equal(hostResult.kind, HostResultKind.ok);
assert.deepEqual(sentQueueMessages, [["direct-message", { contentType: "text" }]]);

const missingQueueFrame = await queueBindings.picorbWorkerQueueSendBridge(
  "MISSING_QUEUE",
  new TextEncoder().encode("message"),
);
assert.equal(decodeHostResult(missingQueueFrame).kind, HostResultKind.error);
assert.match(hostErrorMessage(missingQueueFrame), /Cloudflare binding MISSING_QUEUE is not registered/);

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

const namedKvStore = new Map();
const namedKvOptions = new Map();
const runtimeQueueMessages = [];
const runtimeWorkerEnv = {
  TEXT_VALUE: "worker-value",
  JSON_VALUE: { retries: 3 },
  SECRET_VALUE: "secret-value",
  KV_BINDING: { get() {}, put() {} },
  BUCKET: { get() {}, put() {}, head() {}, list() {} },
  SECOND_KV: {
    async get(key, type) {
      assert.equal(type, "arrayBuffer");
      if (key === "reject") throw new Error("KV backend rejected the read");
      const value = namedKvStore.get(key);
      return value === undefined ? null : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    },
    async put(key, value, options) {
      if (key === "reject") throw new Error("KV backend rejected the write");
      namedKvStore.set(key, new Uint8Array(value));
      namedKvOptions.set(key, options);
    },
  },
  QUEUE_FOO: {
    async send(body, options) {
      if (body === "reject") throw new Error("Queue backend rejected the message");
      runtimeQueueMessages.push([body, options]);
    },
  },
};
runtimeWorkerEnv.PICORUBY_KV = runtimeWorkerEnv.SECOND_KV;
const runtimeWarnings = [];
const originalConsoleError = console.error;
console.error = (...parts) => runtimeWarnings.push(parts.join(" "));
let bindingsRuntime;
try {
  bindingsRuntime = await createRuntime(
    createPicoRuby,
    wasmModule,
    bindingsAppBytecode,
    createCloudflareBindings(runtimeWorkerEnv, {
      KV_BINDING: "kv",
      PICORUBY_KV: "kv",
      QUEUE_FOO: "queue",
      SECOND_KV: "kv",
    }),
  );
} finally {
  console.error = originalConsoleError;
}

const environmentResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/env"),
);
assert.equal(
  await environmentResponse.text(),
  'worker-value|{"retries":3}|secret-value|present|missing',
);

const environmentOverlayResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/env/overlay"),
);
assert.equal(
  await environmentOverlayResponse.text(),
  '["worker-value", ["overridden", "overridden", true], "overridden", [nil, "default", false], ["one", false], [nil, "two", nil], false, false, "#<ENV (Cloudflare request overlay)>"]',
);
assert.equal(runtimeWarnings.length, 4);
for (const warning of runtimeWarnings) {
  assert.match(warning, /ENV changes are request-local and do not update Cloudflare bindings/);
  assert.doesNotMatch(warning, /secret-value|overridden|worker-value/);
}

const environmentOverlayResetResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/env/overlay/reset"),
);
assert.equal(await environmentOverlayResetResponse.text(), '["worker-value", "secret-value"]');

const cloudflareEnvironmentResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/cloudflare/env"),
);
assert.equal(
  await cloudflareEnvironmentResponse.text(),
  'worker-value|{"retries":3}|Cloudflare::KV|Cloudflare::Queue',
);

const cloudflareEnvironmentInspectResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/cloudflare/env/inspect"),
);
const cloudflareEnvironmentInspect = await cloudflareEnvironmentInspectResponse.text();
assert.match(cloudflareEnvironmentInspect, /^#<Cloudflare::Environment>\n/);
assert.doesNotMatch(cloudflareEnvironmentInspect, /secret-value/);
assert.doesNotMatch(cloudflareEnvironmentInspect, /@bindings/);

const namedSetResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/kv/named/set"),
);
assert.equal(await namedSetResponse.text(), "named-set");
assert.equal(new TextDecoder().decode(namedKvStore.get("named-key")), "named-value");
assert.deepEqual(namedKvOptions.get("named-key"), {});

const ttlResponse = await dispatch(bindingsRuntime, new Request("https://example.com/kv/ttl"));
assert.equal(await ttlResponse.text(), "ttl-set");
for (const [key, ttl] of [
  ["ttl-direct", 60], ["ttl-from-env", 120], ["ttl-class-put", 180],
  ["ttl-class-set", 240], ["ttl-module-set", 300],
]) {
  assert.deepEqual(namedKvOptions.get(key), { expirationTtl: ttl });
  assert.deepEqual(namedKvStore.get(key), new Uint8Array([0, 255]), "TTL writes remain binary-safe");
}
assert.deepEqual(namedKvOptions.get("ttl-nil"), {});

const invalidTtlResponse = await dispatch(bindingsRuntime, new Request("https://example.com/kv/ttl/invalid"));
assert.match(await invalidTtlResponse.text(), /host-error=Cloudflare KV ttl must be an integer of at least 60 seconds/);
assert.equal(namedKvStore.has("ttl-invalid"), false);

const rejectedPutResponse = await dispatch(bindingsRuntime, new Request("https://example.com/kv/put-rejected"));
assert.match(await rejectedPutResponse.text(), /host-error=KV backend rejected the write/);

const namedGetResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/kv/named/get"),
);
assert.equal(await namedGetResponse.text(), "named-value");

const nulKeySetResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/kv/nul-key/set"),
);
assert.equal(await nulKeySetResponse.text(), "nul-set");
assert.equal(new TextDecoder().decode(namedKvStore.get("account\u0000other")), "nul-value");
assert.equal(namedKvStore.has("account"), false, "a NUL byte must not truncate the KV key");

const nulKeyGetResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/kv/nul-key/get"),
);
assert.equal(await nulKeyGetResponse.text(), "nul-value");

const invalidUtf8KeyResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/kv/invalid-utf8-key"),
);
assert.equal(
  await invalidUtf8KeyResponse.text(),
  "host-error=Cloudflare KV key must be valid UTF-8",
);
assert.equal(namedKvStore.has("�"), false, "an invalid UTF-8 key must not be replaced and written");

const kvAliasResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/kv/from-env-alias"),
);
assert.equal(await kvAliasResponse.text(), "same");

const missingBindingResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/kv/missing-binding"),
);
assert.match(await missingBindingResponse.text(), /host-error=Cloudflare binding MISSING_KV is not registered/);

const rejectedKvResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/kv/rejected"),
);
assert.match(await rejectedKvResponse.text(), /host-error=KV backend rejected the read/);

const queueSendResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/queue/send"),
);
assert.equal(await queueSendResponse.text(), "queue-sent");

const queueFromEnvResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/queue/from-env"),
);
assert.equal(await queueFromEnvResponse.text(), "queue-sent-from-env");
assert.deepEqual(runtimeQueueMessages, [
  ["queue-message", { contentType: "text" }],
  ["from-env-message", { contentType: "text" }],
]);

const rejectedQueueResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/queue/rejected"),
);
assert.match(await rejectedQueueResponse.text(), /host-error=Queue backend rejected the message/);

const typeErrorResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/type-error"),
);
assert.match(await typeErrorResponse.text(), /argument-error=Cloudflare binding `QUEUE_FOO' is not a Cloudflare::KV/);

const unsupportedResourceResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/unsupported-resource"),
);
assert.equal(await unsupportedResourceResponse.text(), "missing=NoMethodError");

const unsupportedResourceAsKvResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/unsupported-resource-as-kv"),
);
assert.match(
  await unsupportedResourceAsKvResponse.text(),
  /host-error=Cloudflare binding BUCKET is not registered/,
);

const missingBindingMethodResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/missing"),
);
assert.equal(await missingBindingMethodResponse.text(), "missing=NoMethodError");

await closeRuntime(bindingsRuntime);

console.log("PicoRuby Rack runtime tests passed");
