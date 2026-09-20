# Workers AI streaming with PicoRuby / Sinatra

`POST /api/chat` returns the Workers AI SSE stream through
`Cloudflare::StreamDescriptor` and the `cloudflare.hijack` Rack extension.
Static Assets serves the browser UI, which handles SSE/UTF-8 split across
network chunks, displays text incrementally, and supports cancellation. The
small `cloudflare_hijack` Sinatra helper sets the descriptor and returns an
empty, valid Rack body.

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
`@cf/zai-org/glm-4.7-flash`; edit `app.rb` to change it. The browser and SSE API
share the same origin. The AI binding explicitly uses `remote: true`, and the
watcher forwards `WRANGLER_CONFIG` to Wrangler.

Validate the bundle without publishing:

```console
npx wrangler deploy --dry-run --config "$WRANGLER_CONFIG" --outdir .wrangler-dist
```

The example has no authentication; add access control before public use.

## Validation and limits

Tests cover generated Wasm with both plain Rack and Sinatra, plus real workerd
with a controlled HTTP upstream: the first chunk must arrive before the
upstream can finish. Local
browser checks cover incremental Japanese text and cancellation. Real-model
streaming was also verified manually using the remote AI binding; the
automated tests remain independent of an AI account. Deployment is untested.

The Ruby VM closes at handoff. Ruby cannot read, transform or observe
completion of the stream. Middleware that replaces the response must clear
`cloudflare.hijack`. See
[ABI v3](../../docs/abi-v3.md) for cleanup and cancellation semantics.

Restore the default spike app before running its complete suite:

```console
unset PICORUBY_APP WRANGLER_CONFIG
npm run build:app
npm test
```
