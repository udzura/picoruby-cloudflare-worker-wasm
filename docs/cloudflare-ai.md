# Cloudflare Workers AI

`Cloudflare::AI` exposes JSON-compatible inference and host-owned streams
through the shared JSPI host-call bridge.

Configure an AI binding in `wrangler.jsonc`:

```jsonc
{
  "ai": { "binding": "AI" }
}
```

Resolve it from the Rack environment and run a model:

```ruby
ai = env["cloudflare.env"].AI
result = ai.run(
  "@cf/meta/llama-3.1-8b-instruct",
  { "prompt" => "Hello from PicoRuby" }
)
puts result["response"]
```

`Cloudflare::AI.from_env(env, "AI")` is the explicit equivalent. The model
must be a non-empty String and the input must be a Hash. Responses are parsed
from JSON and returned as ordinary PicoRuby JSON values.

`run` remains the model-agnostic API. For text-generation and embedding tasks,
explicit helpers validate the expected response shape and retain the complete
response under `raw`:

```ruby
generated = ai.generate(
  "@cf/meta/llama-3.1-8b-instruct",
  { "prompt" => "Hello from PicoRuby" }
)
puts generated.response
puts generated.usage["total_tokens"] if generated.usage

embedded = ai.embed(
  "@cf/pfnet/plamo-embedding-1b",
  { "text" => ["Ruby", "WebAssembly"] }
)
puts embedded.count
puts embedded.dimensions
first_vector = embedded.first
all_vectors = embedded.vectors
```

`generate` returns `Cloudflare::AI::TextGenerationResult`, with `response`,
optional `usage`, and `raw`. `embed` returns `Cloudflare::AI::EmbeddingResult`,
with `vectors`, `shape`, `count`, `dimensions`, optional `pooling`, `first`, and
`raw`. They do not infer the task from the model name. A model with a different
response schema can continue to use `run` directly.

## Streaming

`run` and `generate` with `stream: true` register the JavaScript
`ReadableStream` and return an opaque `Cloudflare::StreamDescriptor`. Its `id`
is available for diagnostics, but applications cannot construct descriptors.
Set the descriptor in the Cloudflare Rack extension before returning a normal
Rack response:

```ruby
get "/chat" do
  content_type "text/event-stream"
  headers "cache-control" => "no-cache"
  descriptor = env["cloudflare.env"].AI.run(
    "@cf/meta/llama-3.1-8b-instruct",
    { "prompt" => "Tell a short story", "stream" => true }
  )
  env["cloudflare.hijack"] = descriptor
  body []
end
```

The same extension can be used without Sinatra:

```ruby
class App
  def self.call(env)
    descriptor = env["cloudflare.env"].AI.run(
      "@cf/meta/llama-3.1-8b-instruct",
      { "prompt" => "Tell a short story", "stream" => true }
    )
    env["cloudflare.hijack"] = descriptor
    [200, { "content-type" => "text/event-stream" }, []]
  end
end
```

When `cloudflare.hijack` contains a descriptor, the adapter preserves the
returned status and headers, ignores the Rack body contents, and uses the
registered stream as the Worker response body. The Rack body must still be a
valid enumerable and is closed without being iterated.

The JS host returns the original SSE bytes incrementally, without copying
chunks through Wasm. Client cancellation and request abort cancel the source.
Errors before response handoff can produce an HTTP error; later upstream
errors fail the stream and cannot change its status. Do not set a content
length or transfer encoding.

`embed` remains a buffered helper. StreamDescriptor cannot be read or
transformed in Ruby. Unselected and replaced descriptors are canceled when
dispatch finishes. Middleware that replaces a downstream response after it
sets `cloudflare.hijack` must also clear that environment entry. Ruby cleanup
callbacks run at handoff, not stream completion. See
[ABI v3](abi-v3.md) for lifecycle details and
[the browser example](../examples/ai-stream/README.md) for incremental display.

The binding and SSE response follow the official
[Workers AI API](https://developers.cloudflare.com/workers-ai/configuration/bindings/).

Missing or incorrectly typed bindings raise `Cloudflare::BindingError`, a
rejected inference raises `Cloudflare::HostError`, and malformed or non-JSON
results raise `Cloudflare::ProtocolError`.
