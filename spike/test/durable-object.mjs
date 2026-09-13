import assert from "node:assert/strict";

import { createCloudflareDurableObjectBindings } from "../src/runtime.js";
import { decodeHostResult, HostResultKind, hostErrorMessage } from "../src/host-bridge.js";

const values = new Map();
const namespace = {
  getByName(name) {
    return {
      async get() {
        return values.get(name) ?? null;
      },
      async put(json) {
        values.set(name, json);
      },
    };
  },
};
const bindings = createCloudflareDurableObjectBindings(
  { OBJECTS: namespace },
  { OBJECTS: "durable_object" },
);
const decoder = new TextDecoder();

let result = decodeHostResult(await bindings.picorbWorkerDurableObjectGetBridge("OBJECTS", "alice"));
assert.equal(result.kind, HostResultKind.missing);

result = decodeHostResult(await bindings.picorbWorkerDurableObjectPutBridge(
  "OBJECTS", "alice", '{"name":"Alice","visits":1}',
));
assert.equal(result.kind, HostResultKind.ok);
assert.equal(values.get("alice"), '{"name":"Alice","visits":1}');

result = decodeHostResult(await bindings.picorbWorkerDurableObjectGetBridge("OBJECTS", "alice"));
assert.equal(result.kind, HostResultKind.ok);
assert.equal(decoder.decode(result.payload), '{"name":"Alice","visits":1}');

result = decodeHostResult(await bindings.picorbWorkerDurableObjectPutBridge("OBJECTS", "list", '[{"id":1}]'));
assert.equal(result.kind, HostResultKind.ok);

for (const json of ["null", '"text"', "{"]) {
  result = decodeHostResult(await bindings.picorbWorkerDurableObjectPutBridge("OBJECTS", "invalid", json));
  assert.equal(result.kind, HostResultKind.protocolError);
  assert.equal(values.has("invalid"), false);
}

const missing = await bindings.picorbWorkerDurableObjectGetBridge("MISSING", "alice");
assert.equal(decodeHostResult(missing).kind, HostResultKind.bindingError);
assert.match(hostErrorMessage(missing), /Cloudflare binding MISSING is not registered/);

const wrongType = createCloudflareDurableObjectBindings(
  { OBJECTS: namespace },
  { OBJECTS: "kv" },
);
result = decodeHostResult(await wrongType.picorbWorkerDurableObjectGetBridge("OBJECTS", "alice"));
assert.equal(result.kind, HostResultKind.bindingError);

console.log("Durable Object bridge: JSON POJO get/put, missing and errors passed");
