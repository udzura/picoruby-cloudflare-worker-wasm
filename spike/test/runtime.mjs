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
  captureHostCall,
  decodeHostResult,
  HostResultKind,
  hostErrorMessage,
} from "../src/host-bridge.js";

let invalidOperationResult = decodeHostResult(await captureHostCall(async () => null));
assert.equal(invalidOperationResult.kind, HostResultKind.protocolError);
invalidOperationResult = decodeHostResult(await captureHostCall(async () => ({ kind: 99 })));
assert.equal(invalidOperationResult.kind, HostResultKind.protocolError);

const wasmModule = new WebAssembly.Module(
  fs.readFileSync(new URL("../dist/picoruby-worker.wasm", import.meta.url)),
);
const appBytecode = fs.readFileSync(new URL("../dist/app.bin", import.meta.url));
const kvAppBytecode = fs.readFileSync(new URL("../dist/kv_app.bin", import.meta.url));
const bindingsAppBytecode = fs.readFileSync(new URL("../dist/bindings_app.bin", import.meta.url));
const cryptoAppBytecode = fs.readFileSync(new URL("../dist/crypto_app.bin", import.meta.url));
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

const cryptoRuntime = await createRuntime(createPicoRuby, wasmModule, cryptoAppBytecode);
const randomResponse = await dispatch(cryptoRuntime, new Request("https://example.com/random"));
assert.equal(await randomResponse.text(), "[16, false, true]");
const cryptoResponse = await dispatch(cryptoRuntime, new Request("https://example.com/crypto"));
assert.equal(await cryptoResponse.text(), "[12, 27, true, false]");
const tamperedCryptoResponse = await dispatch(
  cryptoRuntime,
  new Request("https://example.com/crypto/tampered"),
);
assert.equal(await tamperedCryptoResponse.text(), "Web Crypto AES_GCM decryption failed");
await closeRuntime(cryptoRuntime);

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
const kvBindings = createCloudflareBindings({
  CACHE_KV: {
    async get(key, type) {
      assert.equal(type, "arrayBuffer");
      const value = kvStore.get(key);
      return value === undefined ? null : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    },
    async put(key, value) {
      kvStore.set(key, new Uint8Array(value));
    },
  },
}, { CACHE_KV: "kv" });
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
  "null", "[]", "true", "60",
  '{"ttl":59}', '{"ttl":0}', '{"ttl":-1}', '{"ttl":60.5}',
  '{"ttl":"60"}', '{"ttl":false}', '{"ttl":null}',
  '{"ttl":9007199254740992}', '{"ttl":1e309}', '{"unknown":60}',
]) {
  const frame = await genericKvBindings.picorbWorkerKvPutBridge("FIRST_KV", "invalid", genericValue, optionsJson);
  assert.equal(decodeHostResult(frame).kind, HostResultKind.argumentError, optionsJson);
  assert.equal(genericKvStore.has("invalid"), false, "invalid options must not write KV");
}
for (const optionsJson of ["", "{"]) {
  const frame = await genericKvBindings.picorbWorkerKvPutBridge("FIRST_KV", "invalid", genericValue, optionsJson);
  assert.equal(decodeHostResult(frame).kind, HostResultKind.protocolError, optionsJson);
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
assert.equal(hostResult.kind, HostResultKind.bindingError);
assert.match(hostErrorMessage(missingBindingFrame), /Cloudflare binding MISSING_KV is not registered/);

const environmentBindings = createEnvironmentBindings({
  TEXT_VALUE: "value",
  JSON_VALUE: { enabled: true, retries: 3 },
  BOOL_VALUE: false,
  NULL_VALUE: null,
  SECRET_VALUE: "not-logged",
  KV_BINDING: { get() {}, put() {} },
}, { KV_BINDING: "kv" });
hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("TEXT_VALUE"));
assert.equal(hostResult.kind, HostResultKind.ok);
assert.equal(new TextDecoder().decode(hostResult.payload), '"value"');

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("JSON_VALUE"));
assert.equal(hostResult.kind, HostResultKind.ok);
assert.equal(new TextDecoder().decode(hostResult.payload), '{"enabled":true,"retries":3}');

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("SECRET_VALUE"));
assert.equal(hostResult.kind, HostResultKind.ok);
assert.equal(new TextDecoder().decode(hostResult.payload), '"not-logged"');

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("BOOL_VALUE"));
assert.equal(hostResult.kind, HostResultKind.ok);
assert.equal(new TextDecoder().decode(hostResult.payload), "false");

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("NULL_VALUE"));
assert.equal(hostResult.kind, HostResultKind.ok);
assert.equal(new TextDecoder().decode(hostResult.payload), "null");

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("KV_BINDING"));
assert.equal(hostResult.kind, HostResultKind.missing);

hostResult = decodeHostResult(await environmentBindings.picorbWorkerEnvGetBridge("MISSING_VALUE"));
assert.equal(hostResult.kind, HostResultKind.missing);

const invalidEnvironmentFrame = await environmentBindings.picorbWorkerEnvGetBridge("");
assert.equal(decodeHostResult(invalidEnvironmentFrame).kind, HostResultKind.argumentError);
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

const invalidQueueMessageFrame = await queueBindings.picorbWorkerQueueSendBridge(
  "QUEUE_FOO",
  new Uint8Array([0xff]),
);
assert.equal(decodeHostResult(invalidQueueMessageFrame).kind, HostResultKind.argumentError);
assert.match(hostErrorMessage(invalidQueueMessageFrame), /Cloudflare Queue message must be valid UTF-8/);

const missingQueueFrame = await queueBindings.picorbWorkerQueueSendBridge(
  "MISSING_QUEUE",
  new TextEncoder().encode("message"),
);
assert.equal(decodeHostResult(missingQueueFrame).kind, HostResultKind.bindingError);
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
const durableObjectStore = new Map();
const runtimeQueueMessages = [];
const serializedDispatchEvents = [];
let releaseFirstSerializedDispatch;
const firstSerializedDispatchGate = new Promise((resolve) => {
  releaseFirstSerializedDispatch = resolve;
});
let markFirstSerializedDispatchStarted;
const firstSerializedDispatchStarted = new Promise((resolve) => {
  markFirstSerializedDispatchStarted = resolve;
});
const runtimeWorkerEnv = {
  TEXT_VALUE: "worker-value",
  JSON_VALUE: { retries: 3 },
  ARRAY_VALUE: ["first", 2],
  BOOL_VALUE: false,
  NUMBER_VALUE: 42,
  NULL_VALUE: null,
  SECRET_VALUE: "secret-value",
  class: "binding-named-class",
  KV_BINDING: { get() {}, put() {} },
  BUCKET: { get() {}, put() {}, head() {}, list() {} },
  BROKEN_KV: {},
  SECOND_KV: {
    async get(key, type) {
      assert.equal(type, "arrayBuffer");
      if (key === "serialized-first") {
        serializedDispatchEvents.push("first:start");
        markFirstSerializedDispatchStarted();
        await firstSerializedDispatchGate;
        serializedDispatchEvents.push("first:end");
        return new TextEncoder().encode("first-response").buffer;
      }
      if (key === "serialized-second") {
        serializedDispatchEvents.push("second:start");
        serializedDispatchEvents.push("second:end");
        return new TextEncoder().encode("second-response").buffer;
      }
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
  OBJECTS: {
    getByName(name) {
      return {
        async get() {
          return durableObjectStore.get(name) ?? null;
        },
        async put(json) {
          durableObjectStore.set(name, json);
        },
      };
    },
  },
};
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
      QUEUE_FOO: "queue",
      SECOND_KV: "kv",
      BROKEN_KV: "kv",
      OBJECTS: "durable_object",
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

const environmentValueTypesResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/env/value-types"),
);
assert.equal(
  await environmentValueTypesResponse.text(),
  String.raw`["{\"retries\":3}", "[\"first\",2]", "false", "42", "null", true]`,
);

const mutableBindingNameResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/mutable-name"),
);
assert.equal(await mutableBindingNameResponse.text(), '["SECOND_KV", true, true]');
assert.equal(new TextDecoder().decode(namedKvStore.get("stable-binding")), "stable-value");

const bindingIntrospectionResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/introspection"),
);
assert.equal(
  await bindingIntrospectionResponse.text(),
  '[true, false, Cloudflare::KV, nil, "worker-value", "default", "block:MISSING_BINDING", KeyError, Cloudflare::Environment, "binding-named-class"]',
);

const cloudflareEnvironmentResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/cloudflare/env"),
);
assert.equal(
  await cloudflareEnvironmentResponse.text(),
  'worker-value|{"retries" => 3}|Cloudflare::KV|Cloudflare::Queue',
);

const cloudflareEnvironmentValueTypesResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/cloudflare/env/value-types"),
);
assert.equal(
  await cloudflareEnvironmentValueTypesResponse.text(),
  '[{"retries" => 3}, ["first", 2], false, 42, nil, true, nil, nil, false, KeyError]',
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
  ["ttl-direct", 60], ["ttl-from-env", 120],
]) {
  assert.deepEqual(namedKvOptions.get(key), { expirationTtl: ttl });
  assert.deepEqual(namedKvStore.get(key), new Uint8Array([0, 255]), "TTL writes remain binary-safe");
}
assert.deepEqual(namedKvOptions.get("ttl-nil"), {});

const invalidTtlResponse = await dispatch(bindingsRuntime, new Request("https://example.com/kv/ttl/invalid"));
assert.match(await invalidTtlResponse.text(), /argument-error=Cloudflare KV ttl must be a safe integer of at least 60 seconds/);
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
  "argument-error=Cloudflare KV key must be valid UTF-8",
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
assert.match(await missingBindingResponse.text(), /binding-error=undefined Cloudflare binding `MISSING_KV'/);

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

const missingDurableObjectResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/durable-object/missing"),
);
assert.equal(await missingDurableObjectResponse.text(), "missing");

for (const [path, expected] of [
  ["pojo", '[Cloudflare::DurableObject::POJO, "Alice"]'],
  ["hash", "[Cloudflare::DurableObject::POJO, Cloudflare::DurableObject::POJO]"],
  ["array", "[Array, Cloudflare::DurableObject::POJO]"],
  ["to-pojo", '["to_pojo", Cloudflare::DurableObject::POJO]'],
]) {
  const response = await dispatch(
    bindingsRuntime,
    new Request(`https://example.com/durable-object/${path}`),
  );
  assert.equal(await response.text(), expected);
}
assert.equal(durableObjectStore.get("pojo"), '{"name":"Alice"}');
assert.equal(durableObjectStore.get("hash"), '{"items":[{"id":1}]}');
assert.equal(durableObjectStore.get("array"), '[{"id":1}]');
assert.equal(durableObjectStore.get("convertible"), '{"source":"to_pojo","nested":[{"ok":true}]}');

for (const name of ["invalid", "invalid-conversion", "invalid-nested", "circular"]) {
  const response = await dispatch(
    bindingsRuntime,
    new Request(`https://example.com/durable-object/${name}`),
  );
  assert.match(await response.text(), /argument-error=Cloudflare Durable Object/);
  assert.equal(durableObjectStore.has(name), false);
}

const typeErrorResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/type-error"),
);
assert.match(await typeErrorResponse.text(), /binding-error=Cloudflare binding `QUEUE_FOO' is not a Cloudflare::KV/);

const unsupportedResourceResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/unsupported-resource"),
);
assert.match(await unsupportedResourceResponse.text(), /binding-error=undefined Cloudflare binding `BUCKET'/);

const misconfiguredKvResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/misconfigured-kv"),
);
assert.match(
  await misconfiguredKvResponse.text(),
  /binding-error=Cloudflare KV binding BROKEN_KV is not configured/,
);

const missingBindingMethodResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/missing"),
);
assert.equal(await missingBindingMethodResponse.text(), "missing=NoMethodError");

const missingBindingFromEnvResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/binding/missing-from-env"),
);
assert.match(
  await missingBindingFromEnvResponse.text(),
  /binding-error=undefined Cloudflare binding `MISSING_KV'/,
);

const hierarchyResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/errors/hierarchy"),
);
assert.equal(await hierarchyResponse.text(), "[true, true, true, true]");

const formalApiResponse = await dispatch(
  bindingsRuntime,
  new Request("https://example.com/kv/formal-api"),
);
assert.equal(
  await formalApiResponse.text(),
  "[true, true, false, false, false, NoMethodError]",
);

const firstSerializedResponsePromise = dispatch(
  bindingsRuntime,
  new Request("https://example.com/dispatch/serialized?serialized-first"),
);
await firstSerializedDispatchStarted;
const secondSerializedResponsePromise = dispatch(
  bindingsRuntime,
  new Request("https://example.com/dispatch/serialized?serialized-second"),
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(serializedDispatchEvents, ["first:start"]);
releaseFirstSerializedDispatch();
const [firstSerializedResponse, secondSerializedResponse] = await Promise.all([
  firstSerializedResponsePromise,
  secondSerializedResponsePromise,
]);
assert.equal(await firstSerializedResponse.text(), "first-response");
assert.equal(await secondSerializedResponse.text(), "second-response");
assert.deepEqual(serializedDispatchEvents, [
  "first:start", "first:end", "second:start", "second:end",
]);

const rejectedQueuedDispatch = dispatch(
  bindingsRuntime,
  new Request("https://example.com/echo", {
    method: "POST",
    body: new Uint8Array([1, 2]),
    duplex: "half",
  }),
  { maxRequestBodyBytes: 1 },
);
const recoveredQueuedDispatch = dispatch(
  bindingsRuntime,
  new Request("https://example.com/cloudflare/env"),
);
await assert.rejects(rejectedQueuedDispatch, RequestBodyTooLargeError);
assert.match(await (await recoveredQueuedDispatch).text(), /^worker-value\|/);

await closeRuntime(bindingsRuntime);

const malformedBridgeRuntime = await createRuntime(
  createPicoRuby,
  wasmModule,
  bindingsAppBytecode,
  mergeBindings(
    createEnvironmentBindings({ SECOND_KV: {} }, { SECOND_KV: "kv" }),
    { picorbWorkerKvGetBridge: async () => new Uint8Array([0]) },
  ),
);
const protocolErrorResponse = await dispatch(
  malformedBridgeRuntime,
  new Request("https://example.com/kv/protocol-error"),
);
assert.equal(
  await protocolErrorResponse.text(),
  "protocol-error=invalid Cloudflare KV host result",
);
await closeRuntime(malformedBridgeRuntime);

console.log("PicoRuby Rack runtime tests passed");
