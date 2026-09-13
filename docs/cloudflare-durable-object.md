# Cloudflare Durable Object POJO storage

`Cloudflare::DurableObject` exposes a small JSON-backed object store. Resolve a
namespace binding from the Rack environment, then select a Durable Object
instance by name:

```ruby
store = Cloudflare::DurableObject.from_env(env, "OBJECTS")

profile = Cloudflare::DurableObject::POJO.new
profile["name"] = "Alice"
store.put("user-1", profile)

stored = store.get("user-1")
stored.class       # Cloudflare::DurableObject::POJO
stored["name"]     # "Alice"
```

`put` accepts a `POJO`, a Hash, an Array, or an object responding to `to_pojo`.
Hashes are recursively wrapped as `POJO`; Arrays retain their type and wrap any
nested Hash values. Values must contain only JSON-compatible primitives, Arrays,
and Hashes with String or Symbol keys; circular references and other values raise
`ArgumentError`. `get` returns `nil` for
a missing object, a `POJO` for a stored JSON object, or an Array for a stored
JSON array.

The Ruby/C/JavaScript bridge transfers only JSON strings. The provided
`PicoRubyDurableObject` RPC class validates the JSON and stores one value per
named Durable Object instance under its private storage key.

Configure and export the class from the Worker entry module:

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "OBJECTS", "class_name": "PicoRubyDurableObject" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["PicoRubyDurableObject"] }
  ]
}
```

```js
export { PicoRubyDurableObject } from "./generated/worker/runtime/index.js";
```

Durable Object names must be non-empty and no longer than 1024 bytes. JSON
payloads are limited to 1 MiB at the Wasm boundary. Host, binding, malformed
JSON, and protocol failures use the existing `Cloudflare::Error` hierarchy.
