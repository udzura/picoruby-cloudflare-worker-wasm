# Cloudflare environment proxy and ENV values

Every Rack request environment contains a `Cloudflare::Environment` proxy under
`cloudflare.env`. Its methods resolve properties from the Worker `env` object:

```ruby
cloudflare = request.env["cloudflare.env"]
cache = cloudflare.CACHE_KV       # Cloudflare::KV
events = cloudflare.EVENTS_QUEUE  # Cloudflare::Queue
api_url = cloudflare.API_URL      # String
```

The Ruby object is a request-scoped proxy, not a Wasm pointer to a JavaScript
object. The JavaScript callbacks close over the original Worker `env`, and the
proxy caches resolved Ruby wrappers for the duration of the Rack request. An
unknown or unsupported property raises `NoMethodError`.

KV and Queue resources are detected by their host APIs. Scalar text, JSON, and
secret values are returned as Strings; JSON values use compact JSON encoding.

Worker variables and secrets are exposed through the ordinary PicoRuby `ENV`
object as a special direct bypass:

```ruby
api_url = ENV["API_URL"]
api_token = ENV["API_TOKEN"] # a Cloudflare secret works the same way

if ENV.key?("FEATURE_FLAGS")
  flags_json = ENV["FEATURE_FLAGS"]
end
```

`ENV[key]` returns a PicoRuby String or `nil`, and `ENV.key?(key)` returns a
boolean. The bridge is read-only. It does not expose `ENV[]=`, enumeration, or
the process environment used while building the Wasm module.

Cloudflare text variables and secrets are returned unchanged. JSON variables
are serialized to compact JSON strings, matching their JavaScript `env` value.
Resource bindings (KV, Queues, D1, service bindings, and similar objects) are
not `ENV` values and return `nil` from that interface. Access supported
resources through `env["cloudflare.env"]` instead.

An invalid key raises `ArgumentError`; a host bridge failure raises
`Cloudflare::HostError`. ENV lookups themselves are synchronous: Worker `env`
is already present for the request, so this path does not suspend through JSPI.
