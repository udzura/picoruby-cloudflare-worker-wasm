# Cloudflare KV

The spike binds one namespace as `PICORUBY_KV` in `spike/wrangler.jsonc`.
Wrangler creates a local namespace for `wrangler dev`. Its automatic resource
provisioning creates the remote namespace on the first deploy and records its
ID in the configuration.

Rack applications access a namespace through the Cloudflare environment proxy:

```ruby
class App
  def self.call(env)
    cache = env["cloudflare.env"].CACHE_KV
    cache.put("greeting", "hello")
    value = cache.get("greeting")
    [200, { "content-type" => "text/plain" }, [value || "missing"]]
  end
end
```

The Ruby-oriented equivalent uses the same cached proxy binding:

```ruby
cache = Cloudflare::KV.from_env(request.env, "CACHE_KV")
```

`Cloudflare::KV.from_env` validates that the named binding is KV. Asking for a
missing binding, Queue, or scalar value raises `Cloudflare::BindingError`.

The earlier default API remains available for `PICORUBY_KV` compatibility:

```ruby
Cloudflare::KV.set("greeting", "hello")
value = Cloudflare::KV.get("greeting")
# value is "hello", or nil when the key does not exist
```

Direct construction also remains available:

```ruby
cache = Cloudflare::KV.new("CACHE_KV")
cache.put("greeting", "hello")
cache.get("greeting")
```

Values remain binary-safe PicoRuby Strings. The Worker host reads KV with
`arrayBuffer` and sends the exact bytes through the JSPI bridge. `put` (and its
`set` alias) returns
`nil` after the KV write Promise resolves.

Pass `ttl:` to expire a value after a number of seconds:

```ruby
cache.put("greeting", "hello", ttl: 300)
# Also supported by set, Cloudflare::KV.put/set, and Cloudflare.kv_set.
```

`ttl` must be a JavaScript-safe integer of at least 60 seconds, following
[Workers KV's expiration limits](https://developers.cloudflare.com/kv/api/write-key-value-pairs/#expiring-keys).
Omitting it (or passing `nil`) writes without expiration. Invalid TTL values
raise `ArgumentError` before crossing the host bridge. Options cross the Ruby-to-JS
bridge as a JSON object (`{"ttl":300}`); JS maps `ttl` to `expirationTtl`.
This keeps the bridge extensible without adding positional arguments for each
future option. Only `ttl:` is currently supported.

`Cloudflare.kv_get` and `Cloudflare.kv_set` remain aliases for the default
namespace. Rack application code should normally resolve bindings through
`env["cloudflare.env"]` or `Cloudflare::KV.from_env`.

All asynchronous host calls use a shared, versioned result frame. A rejected
KV Promise raises `Cloudflare::HostError`. Missing, unregistered, or incorrectly
typed namespaces raise `Cloudflare::BindingError`; malformed bridge results
raise `Cloudflare::ProtocolError`.

## Scope and limits

- `get` and `put` (`set`) are the only operations. Relative expiration via
  `ttl:` is supported; metadata, absolute expiration, delete, list, and batch
  operations are not included yet.
- Keys follow Cloudflare's basic constraints: they must not be empty, `.` or
  `..`, and are limited to 512 bytes. Ruby keys must contain valid UTF-8;
  embedded NUL bytes are preserved rather than treated as terminators.
- Values are limited to 8 MiB so the complete buffered Rack response can still
  fit the Worker ABI and VM memory budget. This is lower than Workers KV's
  platform maximum.
- Namespace names must be non-empty and at most 256 bytes. An absent or
  non-KV binding raises `Cloudflare::BindingError`.

The normal spike app exposes the fixed `spike-key` sample through `/kv/set` and
`/kv/get`. Use local development while exercising its write endpoint. For an
isolated binary-value check, select the fixture:

```console
PICORUBY_APP=test/kv_app.rb npm run dev
curl http://localhost:8787/kv/get
curl http://localhost:8787/kv/set
curl http://localhost:8787/kv/get
```
