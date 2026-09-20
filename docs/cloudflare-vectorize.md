# Cloudflare Vectorize

Declare the index in `wrangler.jsonc`, then regenerate the binding registry:

```jsonc
{
  "vectorize": [{ "binding": "VECTOR_INDEX", "index_name": "documents" }]
}
```

```sh
npm run generate:bindings
```

Resolve the request-scoped Ruby wrapper from the Rack environment:

```ruby
index = env["cloudflare.env"].VECTOR_INDEX

matches = index.query(
  [0.1, 0.2, 0.3],
  top_k: 5,
  return_values: false,
  return_metadata: :indexed,
  namespace: "docs",
  filter: { "category" => "ruby" }
)

same_index = Cloudflare::Vectorize.from_env(env, "VECTOR_INDEX")
```

`query_by_id` accepts an existing vector ID and the same keyword options.
`return_metadata` accepts `:none`, `:indexed`, or `:all`. `top_k` is between 1
and 100, or at most 50 when returning vector values or all metadata.

Vector lifecycle methods use JSON-compatible Hashes and Arrays and return the
JSON-compatible response from Cloudflare:

```ruby
vectors = [{
  "id" => "document-1",
  "values" => [0.1, 0.2, 0.3],
  "metadata" => { "category" => "ruby" },
  "namespace" => "docs",
}]

index.insert(vectors)
index.upsert(vectors)
index.get_by_ids(["document-1"])
index.delete_by_ids(["document-1"])
index.describe
```

The bridge is buffered and JSON-only. It does not expose JavaScript objects to
Ruby, and it does not add a Vectorize-specific Wasm import; all methods use the
ABI v2 common host-call entry point.
