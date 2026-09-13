import assert from "node:assert/strict";

import {
  parseCloudflareBindingTypes,
  renderCloudflareBindingTypes,
} from "../scripts/cloudflare-binding-registry.mjs";

const source = `{
  // Resource sections may use JSONC syntax.
  "kv_namespaces": [{ "binding": "CACHE_KV", "id": "test" }],
  "queues": { "producers": [{ "binding": "EVENTS_QUEUE", "queue": "events" }] },
  "durable_objects": { "bindings": [{ "name": "OBJECTS", "class_name": "PicoRubyDurableObject" }] },
  "vars": { "IGNORED_SCALAR": "value" },
  "env": {
    "staging": {
      "kv_namespaces": [{ "binding": "STAGING_KV", "id": "test" }],
    },
  },
}`;

assert.deepEqual(parseCloudflareBindingTypes(source), [
  ["CACHE_KV", "kv"],
  ["EVENTS_QUEUE", "queue"],
  ["OBJECTS", "durable_object"],
]);
assert.deepEqual(parseCloudflareBindingTypes(source, "staging"), [["STAGING_KV", "kv"]]);
assert.match(renderCloudflareBindingTypes([["CACHE_KV", "kv"]], "wrangler.jsonc"), /\["CACHE_KV", "kv"\]/);
assert.throws(
  () => parseCloudflareBindingTypes('{"kv_namespaces":[{"binding":"SAME"}],"queues":{"producers":[{"binding":"SAME"}]}}'),
  /Duplicate Cloudflare binding name: SAME/,
);

console.log("Cloudflare binding registry tests passed");
