# Cloudflare Workers AI

`Cloudflare::AI` exposes buffered, JSON-compatible Workers AI inference through
the shared JSPI host-call bridge.

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

Streaming is intentionally not supported. Passing `stream: true` or
`"stream" => true` raises `ArgumentError`; a future streaming ABI will be
needed to carry a `ReadableStream` without buffering the entire response.

Missing or incorrectly typed bindings raise `Cloudflare::BindingError`, a
rejected inference raises `Cloudflare::HostError`, and malformed or non-JSON
results raise `Cloudflare::ProtocolError`.
