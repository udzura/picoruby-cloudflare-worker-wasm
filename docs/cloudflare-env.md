# Cloudflare environment proxy and ENV values

Every Rack request environment contains a `Cloudflare::Environment` proxy under
`cloudflare.env`. Its methods resolve properties from the Worker `env` object:

```ruby
cloudflare = request.env["cloudflare.env"]
cache = cloudflare.CACHE_KV       # Cloudflare::KV
events = cloudflare.EVENTS_QUEUE  # Cloudflare::Queue
database = cloudflare.DB          # Cloudflare::D1
ai = cloudflare.AI                # Cloudflare::AI
vectors = cloudflare.VECTOR_INDEX # Cloudflare::Vectorize
api_url = cloudflare.API_URL      # String
same_cache = cloudflare["CACHE_KV"]
```

The Ruby object is a request-scoped proxy, not a Wasm pointer to a JavaScript
object. The JavaScript callbacks close over the original Worker `env`, and the
proxy caches resolved Ruby wrappers for the duration of the Rack request. An
unknown or unsupported property returns `nil` from `[]`; `fetch` supports the
usual default and block forms and otherwise raises `KeyError`. Property syntax
continues to raise `NoMethodError`. `key?` and `respond_to?` use the same
resolver. Bindings whose names collide with Ruby methods remain available
through `[]` or `fetch`, for example `cloudflare["class"]`.

Binding names are copied and frozen when resolved. Mutating a caller-owned
String afterward cannot change the resource used by an existing KV or Queue
wrapper; `binding_name` returns the frozen normalized name.

Inspecting the proxy, including as part of the complete Rack environment,
never displays resolved values. This prevents variables and secrets from being
included accidentally in diagnostics through `Cloudflare::Environment#inspect`.

KV, Queue, Durable Object, D1, AI, and Vectorize resources are identified by the generated binding-type registry,
whose source is `wrangler.jsonc`. The runtime does not infer types from object
methods, so unsupported resources cannot be mistaken for KV. Text and secret
values are returned as Strings. JSON objects, arrays, booleans, numbers, and
null retain their types as `Hash`, `Array`, `true`/`false`, numeric values, and
`nil` respectively.

JSON null is present even though its value is `nil`: `key?` returns `true` and
`fetch` returns `nil`. For an undefined name, `key?` returns `false`, `[]`
returns `nil`, and `fetch` without a default or block raises `KeyError`.

Worker variables and secrets are exposed through the ordinary PicoRuby `ENV`
object as a special direct bypass:

```ruby
api_url = ENV["API_URL"]
api_token = ENV["API_TOKEN"] # a Cloudflare secret works the same way

if ENV.key?("FEATURE_FLAGS")
  flags_json = ENV["FEATURE_FLAGS"]
end
```

`ENV[key]` returns a PicoRuby String or `nil`; `ENV.fetch` and `ENV.key?` use
the same values. Assignments and other mutations create a request-local Ruby
overlay. They do not change the Cloudflare variable or secret, and emit a
value-free warning to stderr:

```ruby
ENV["API_URL"] = "http://test.invalid"
ENV["API_URL"] # => "http://test.invalid" for this request only
```

The dedicated `ENV` object is not a Hash. Its overlay is cleared before every
Rack request, including when a runtime is manually reused. `delete`, `clear`,
`update`/`merge!`, and `replace` follow the same model. Keys and non-nil values
must be Strings. Other Hash mutation methods, enumeration, and the process
environment used while building the Wasm module are not exposed.

Through `ENV`, Cloudflare text variables and secrets are returned unchanged,
while JSON values are serialized to compact JSON strings. Thus JSON `false`
and `null` become `"false"` and `"null"`; both remain present according to
`ENV.key?`.
Resource bindings (KV, Queues, D1, service bindings, and similar objects) are
not `ENV` values and return `nil` from that interface. Access supported
resources through `env["cloudflare.env"]` instead.

An invalid key raises `ArgumentError`. ENV lookups themselves are synchronous:
Worker `env` is already present for the request, so this path does not suspend
through JSPI.

Cloudflare integration errors share this hierarchy:

```ruby
Cloudflare::Error < StandardError
Cloudflare::BindingError < Cloudflare::Error  # missing or wrong binding type
Cloudflare::HostError < Cloudflare::Error     # host operation failed
Cloudflare::ProtocolError < Cloudflare::Error # malformed bridge data
```

Ruby argument and type mistakes continue to use core `ArgumentError` or
`TypeError`. Missing property syntax such as `cloudflare.UNKNOWN` raises
`NoMethodError`, while explicit resource resolution through `from_env` raises
`Cloudflare::BindingError` when the requested binding cannot be resolved.
