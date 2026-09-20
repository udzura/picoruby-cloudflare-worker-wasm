# Workers AI streaming with PicoRuby / Sinatra

`POST /api/chat` returns the Workers AI SSE stream through
`Cloudflare::HostStreamBody`. Static Assets serves the browser UI, which
handles SSE/UTF-8 split across network chunks, displays text incrementally,
and supports cancellation. Sinatra returns the body directly; no `chunked`
helper is required.

## Build once

From the repository's `spike/` directory:

```console
export PICORUBY_ROOT=/absolute/path/to/picoruby
export PICORUBY_WORKER_WASM_GEM_DIR=..
export PICORUBY_APP=../examples/ai-stream/app.rb
export WRANGLER_CONFIG=../examples/ai-stream/wrangler.jsonc
npm install
npm run build
```

This rebuilds ABI v3 and selects the example as `dist/app.bin`. The example
Worker explicitly registers AI; the spike's generated registry is unchanged.

## Local demo without an AI account

Still in `spike/`:

```console
node ../examples/ai-stream/demo.mjs
```

Open <http://127.0.0.1:8787/> and send a message. The demo substitutes only the
AI binding with delayed Japanese SSE chunks; the real Wasm, Sinatra, response
ABI and browser client are used. It makes no Workers AI API calls. The prompt
does not affect the canned response. Ctrl-C stops the server.

## Real Workers AI

Stop the demo, then run:

```console
npm run dev
```

Wrangler uses `WRANGLER_CONFIG` above. The AI binding calls remote Workers AI,
requires a logged-in Cloudflare account, and uses its AI quota. The model is
`@cf/meta/llama-3.1-8b-instruct`; edit `app.rb` to change it. The browser and SSE
API share the same origin.

Validate the bundle without publishing:

```console
npx wrangler deploy --dry-run --config "$WRANGLER_CONFIG" --outdir .wrangler-dist
```

The example has no authentication; add access control before public use.

## Validation and limits

Tests cover generated Wasm + Sinatra and real workerd with a controlled HTTP
upstream: the first chunk must arrive before the upstream can finish. Local
browser checks cover incremental Japanese text and cancellation. Real-model
inference and deployment are not part of these tests.

The Ruby VM closes at handoff. Ruby cannot enumerate, transform or observe
completion of the stream; middleware must preserve the body. See
[ABI v3](../../docs/abi-v3.md) for cleanup and cancellation semantics.

Restore the default spike app before running its complete suite:

```console
unset PICORUBY_APP WRANGLER_CONFIG
npm run build:app
npm test
```
