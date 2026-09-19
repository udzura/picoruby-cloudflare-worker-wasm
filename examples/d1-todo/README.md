# D1 Todo example

This example combines a small Todo frontend with a Sinatra JSON API. Cloudflare
Static Assets serves `public/index.html` without starting PicoRuby, while
requests under `/api/*` run the Worker and store todos in the `DB` D1 binding.

The API provides:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/todos` | List todos, newest first |
| `POST` | `/api/todos` | Create a todo from `{ "title": "..." }` |
| `PATCH` | `/api/todos/:id` | Update from `{ "completed": true }` |
| `DELETE` | `/api/todos/:id` | Delete a todo |

Every parameterized operation explicitly follows the D1 prepared-statement
flow—`prepare(sql).bind(*params).run` (or `first`)—so the example also shows
how SQL and values remain separate.

## Run locally

Use the repository's runnable Worker project with the example-specific Wrangler
configuration. Exporting the paths once also makes them available to the app
watcher started by `npm run dev`.

```console
cd spike

export PICORUBY_ROOT=/absolute/path/to/picoruby
export PICORUBY_WORKER_WASM_GEM_DIR=..
export PICORUBY_APP=../examples/d1-todo/app.rb
export WRANGLER_CONFIG=../examples/d1-todo/wrangler.jsonc

npx wrangler d1 execute picoruby-worker-todo \
  --local \
  --config "$WRANGLER_CONFIG" \
  --file ../examples/d1-todo/schema.sql

npm run build
npm run dev
```

Open <http://localhost:8787/>.

## Deploy

Create a production D1 database, then replace the `database_id` in this
example's `wrangler.jsonc` with the value printed by Wrangler:

```console
npx wrangler d1 create picoruby-worker-todo
npx wrangler d1 execute picoruby-worker-todo \
  --remote \
  --config "$WRANGLER_CONFIG" \
  --file ../examples/d1-todo/schema.sql
```

Build the example as above and run
`npx wrangler deploy --config "$WRANGLER_CONFIG"` from `spike/`.
