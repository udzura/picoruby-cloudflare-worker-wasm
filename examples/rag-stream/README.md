# Workers AI + Vectorize RAG streaming with PicoRuby / Sinatra

This example stores short documents in Cloudflare Vectorize, retrieves matching
documents, and streams a Workers AI answer through
`Cloudflare::StreamDescriptor` and `cloudflare.hijack`. The browser shows the
retrieved sources before it incrementally renders the answer, citations, and
token/neuron usage.

## Create a Vectorize index

Create this 1,024-dimension index once, then set its name in
`wrangler.jsonc` if you choose a different name:

```console
npx wrangler vectorize create picoruby-rag-stream-documents --dimensions=1024 --metric=cosine
```

## Build and run

From the repository's `spike/` directory:

```console
export PICORUBY_ROOT=/absolute/path/to/picoruby
export PICORUBY_WORKER_WASM_GEM_DIR=..
export PICORUBY_APP=../examples/rag-stream/app.rb
export WRANGLER_CONFIG=../examples/rag-stream/wrangler.jsonc
npm install
npm run build
npm run dev
```

Workers AI and Vectorize both use remote bindings and require a logged-in
Cloudflare account. They can consume quota even during local development.

Register a document before opening the browser UI:

```console
curl -X POST http://127.0.0.1:8787/api/documents \
  -H 'content-type: application/json' \
  -d '{"id":"picoruby","title":"PicoRuby","text":"PicoRuby is a compact Ruby implementation for microcontrollers and small environments."}'
```

The UI first calls `/api/search` to display sources, then `/api/rag` to create
the server-owned prompt and stream the answer. This performs retrieval twice so
that the returned sources and answer remain independently server-generated.

Validate without publishing:

```console
npx wrangler deploy --dry-run --config "$WRANGLER_CONFIG" --outdir .wrangler-dist
```

Restore the default spike app before its complete test suite:

```console
unset PICORUBY_APP WRANGLER_CONFIG
npm run build:app
npm test
```
