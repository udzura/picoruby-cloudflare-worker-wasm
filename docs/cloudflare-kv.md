# Cloudflare KV

The spike binds one namespace as `PICORUBY_KV` in `spike/wrangler.jsonc`.
Wrangler creates a local namespace for `wrangler dev`. Its automatic resource
provisioning creates the remote namespace on the first deploy and records its
ID in the configuration.

Ruby applications use `Cloudflare::KV`:

```ruby
Cloudflare::KV.set("greeting", "hello")
value = Cloudflare::KV.get("greeting")
# value is "hello", or nil when the key does not exist
```

Values remain binary-safe PicoRuby Strings. The Worker host reads KV with
`arrayBuffer` and sends the exact bytes through the JSPI bridge. `set` returns
`nil` after the KV write Promise resolves.

`Cloudflare.kv_get` and `Cloudflare.kv_set` are the C-backed direct wrappers.
They are kept public as the thin host boundary; application code should use
`Cloudflare::KV` instead.

## Scope and limits

- Only the fixed `PICORUBY_KV` binding is supported.
- `get` and `set` are the only operations. Metadata, expiration, delete, list,
  and multiple namespaces are not included yet.
- Keys follow Cloudflare's basic constraints: they must not be empty, `.` or
  `..`, and are limited to 512 bytes.
- Values are limited to 8 MiB so the complete buffered Rack response can still
  fit the Worker ABI and VM memory budget. This is lower than Workers KV's
  platform maximum.
- A rejected KV Promise currently reaches the Worker-level error handler as a
  500 response. Converting those failures into Ruby exceptions is future work.

The normal spike app exposes the fixed `spike-key` sample through `/kv/set` and
`/kv/get`. Use local development while exercising its write endpoint. For an
isolated binary-value check, select the fixture:

```console
PICORUBY_APP=test/kv_app.rb npm run dev
curl http://localhost:8787/kv/get
curl http://localhost:8787/kv/set
curl http://localhost:8787/kv/get
```
