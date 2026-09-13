# CookieSimple session example

This app uses `Rack::Session::CookieSimple` from `mruby-rack` with the Worker
Web Crypto bindings. Session data is JSON-serialized, encrypted with AES-GCM,
and stored in the `rack.session` cookie.

The example sets `secure: false` so that the cookie works with Wrangler's local
HTTP server. Use `secure: true` when deploying over HTTPS.

## Run locally

Build and run it through the repository's runnable Worker project:

```console
cd spike
cp ../examples/cookie-simple/.dev.vars.example .dev.vars

PICORUBY_ROOT=/absolute/path/to/picoruby \
PICORUBY_WORKER_WASM_GEM_DIR=.. \
MRUBY_RACK_GEM_DIR=/absolute/path/to/the-latest/mruby-rack \
PICORUBY_APP=../examples/cookie-simple/app.rb \
npm run build

npm run dev
```

Open <http://localhost:8787/>. The first response is `visits=1`; reload with
the returned cookie to increment the counter.

The checked-in `SESSION_SECRET` is only a predictable local-development value.
Production deployments should omit `.dev.vars` and configure an unpredictable
32-byte secret:

```console
npx wrangler secret put SESSION_SECRET
```
