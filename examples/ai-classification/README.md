# Text classification and choice selection with PicoRuby / Sinatra

A Ruby `POST /api/classify` endpoint calls Workers AI through `Cloudflare::AI.run`.
Static Assets serves a simple browser UI at `/`, showing the highest scoring
label and all confidence scores. A second form uses `@cf/baai/bge-reranker-base`
to rank editable choices against a query and display the best match. The model classifies English text as
POSITIVE or NEGATIVE; this is sentiment analysis, not arbitrary topic classification.

## Build and run

From the repository's `spike/` directory:

```console
export PICORUBY_ROOT=/absolute/path/to/picoruby
export PICORUBY_WORKER_WASM_GEM_DIR=..
export PICORUBY_APP=../examples/ai-classification/app.rb
export WRANGLER_CONFIG=../examples/ai-classification/wrangler.jsonc
npm install
npm run build
npm run dev
```

Open <http://127.0.0.1:8787/>. The `AI` binding uses `remote: true`, so local
inference requires a logged-in Cloudflare account (`npx wrangler login`) and
uses Workers AI quota. No API key is embedded in the browser.
If the current runtime is already built, `npm run build:app` compiles only the
selected Ruby app. Examples share `spike/dist/app.bin`; rebuild when switching.

## Sentiment API

```console
curl http://127.0.0.1:8787/api/classify \
  -H 'content-type: application/json' \
  -d '{"text":"This pizza is great!"}'
```

The endpoint returns the model's JSON array unchanged, for example:

```json
[{"label":"NEGATIVE","score":0.01},{"label":"POSITIVE","score":0.99}]
```

These scores are illustrative. Invalid JSON, a non-object payload, or a missing,
blank, or non-string `text` returns 400. Request bodies above 16 KiB return 413.
Inference failures return a generic JSON error with 502 and are logged by the
Worker. The sample has no authentication.

## Choice selection API

```console
curl http://127.0.0.1:8787/api/select \
  -H 'content-type: application/json' \
  -d '{"query":"Which animal purrs?","choices":["A dog barks.","A cat purrs.","A bird sings."]}'
```

Ruby converts `choices` to the model's `contexts: [{text: ...}]` input and
sets `top_k` to the number of choices. It returns the model response unchanged:

```json
{"response":[{"id":1,"score":0.9},{"id":2,"score":0.2},{"id":0,"score":0.1}]}
```

The example scores are illustrative. Each `id` is the zero-based index of the
original choice. The UI sorts by descending score, displays the highest scoring
choice, and lists all candidates with their raw relevance scores. These scores
are not probabilities of correctness; the model ranks relevance and does not
verify whether an answer is true. Even unrelated choices will produce a winner.

`query` must be a non-blank string and `choices` must contain 2–20 non-blank
strings. Invalid input returns 400; the same 16 KiB body limit and inference
error handling apply. In the UI, each non-blank line is a choice.

Model reference: [Cloudflare's bge-reranker-base documentation](https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/).

Model reference: [Cloudflare's distilbert-sst-2-int8 documentation](https://developers.cloudflare.com/workers-ai/models/distilbert-sst-2-int8/).

Validate the Worker bundle without publishing:

```console
npx wrangler deploy --dry-run --config "$WRANGLER_CONFIG" --outdir .wrangler-dist
```

Run the account-independent integration test after building this example:

```console
node ../examples/ai-classification/test.mjs
```

The test uses real workerd and PicoRuby Wasm with a mock AI binding to check
both models, input forwarding (including context IDs and `top_k`), results,
invalid inputs, size limits, and inference
failures. It makes no Workers AI calls.

Restore the default app after using the sample:

```console
unset PICORUBY_APP WRANGLER_CONFIG
npm run build:app
```
