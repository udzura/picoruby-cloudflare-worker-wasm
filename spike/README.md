# PicoRuby Cloudflare Workers spike

This is a Cloudflare Workers feasibility project. It builds a PicoRuby Wasm
runtime with Sinatra 4.2.1, compiles a `Sinatra::Base` application in
`lib/app.rb` to bytecode, and exposes it through the mrbgem's Rack-compatible
handler. The released
`picoruby-worker-wasm` is resolved from GitHub at the tag recorded in the build
configuration.

## Prerequisites

- A PicoRuby source checkout compatible with this gem
- Emscripten >= 5.0.0 (checked before a build)
- Node.js and npm

On macOS, install Emscripten via Homebrew:

```sh
brew install emscripten
export PATH="$(brew --prefix emscripten)/bin:$PATH"
emcc --version
```

If switching from emsdk, use a shell without `emsdk_env.sh` and unset
`EMSDK`, `EM_CONFIG`, and `EM_CACHE` to avoid mixing toolchains.
The version check accepts 5.0.0 and later; this does not mean every version has been tested.

Install Worker development dependencies, point the project at PicoRuby, and
build the runtime:

```console
cd spike
npm install
export PICORUBY_ROOT=/absolute/path/to/picoruby
npm run build
```

`npm run build` performs all build-time work:

1. copies the shared Worker runtime and binding-generator sources from
   `../templates/` into `src/` and `scripts/`;
2. invokes PicoRuby's Rakefile with `build_config/picoruby-worker-wasm.rb`;
3. checks out Mustermann, Rack, and Sinatra compatibility mrbgems from their
   `master` branches on GitHub;
4. uses the `mruby-regexp` bundled with PicoRuby;
5. clones `udzura/picoruby-cloudflare-worker-wasm` as the Worker mrbgem;
6. generates `dist/picoruby-worker.js` and `dist/picoruby-worker.wasm`;
7. compiles `lib/app.rb` with PicoRuby's host `mrbc` into `dist/app.bin`.

The files copied into `src/` and `scripts/` remain checked in so the spike is
runnable immediately. Edit their source files under `../templates/`; the next
build updates the spike copies without rewriting files whose contents match.

When developing unreleased changes in the parent mrbgem, bypass the GitHub pin:

```console
PICORUBY_WORKER_WASM_GEM_DIR=.. npm run build
```

When developing an unreleased change, each GitHub dependency can be overridden
with a local checkout:

```console
MRUBY_MUSTERMANN_GEM_DIR=/path/to/mruby-mustermann \
MRUBY_RACK_GEM_DIR=/path/to/mruby-rack \
PICORUBY_SINATRA_COVERS_GEM_DIR=/path/to/picoruby-sinatra-covers \
npm run build
```

After changing only the selected app, rebuild just the bytecode:

```console
npm run build:app
```

Select a different Ruby entrypoint with `PICORUBY_APP`. Relative paths are
resolved from `spike/`; absolute paths are also accepted. The generated file
remains `dist/app.bin`, so the Worker glue and Wrangler configuration do not
change. Without this environment variable, `lib/app.rb` is used:

```console
PICORUBY_APP=apps/debug.rb npm run dev
PICORUBY_APP=/absolute/path/to/production.rb npm run build:app
```

Restart `npm run dev` when changing `PICORUBY_APP`. The watcher observes only
the selected entrypoint; changes to files loaded by that entrypoint do not yet
trigger a rebuild.

Run locally, execute the generated-Wasm test, or validate the deploy bundle:

```console
npm run dev
npm test
npm run check
```

`npm run dev` first compiles the selected app, starts Wrangler, and watches its
source file. Each saved change runs the equivalent of `npm run build:app`;
Wrangler then observes the updated `dist/app.bin` and reloads the local Worker.
To run only the Ruby bytecode watcher, use `npm run watch:app`.

The example defines `App < Sinatra::Base` and registers it with
`Rackup::Handler::CloudflareWorker.run(App)` and exposes:

- `GET /ruby_version`
- `GET /factorial`
- `GET /sinatra/:name`, which exercises Sinatra 4.2.1 and Mustermann params
- any method at `/hello`
- `POST /echo?name=pico`, which returns the binary request body
- any method at `/debug/request`, which dumps the Rack request state
- any method at `/debug/raise`, which raises a dummy application exception
- `GET /debug/jspi`, which suspends and resumes Ruby twice through JSPI
`wrangler.jsonc` binds one namespace as `CACHE_KV`. To verify the binary-safe
named-binding API against Wrangler's local KV implementation, select
`test/kv_app.rb` as the Ruby entrypoint:

```console
PICORUBY_APP=test/kv_app.rb npm run dev
curl http://localhost:8787/kv/get
curl http://localhost:8787/kv/set
curl http://localhost:8787/kv/get
```

See [Cloudflare KV](../docs/cloudflare-kv.md),
[Cloudflare environment values](../docs/cloudflare-env.md),
[Cloudflare Queues](../docs/cloudflare-queue.md), and
[Durable Objects](../docs/cloudflare-durable-object.md), and
[Cloudflare D1](../docs/cloudflare-d1.md) for the Ruby API and its
current limits.

## Host binding factories

`wrangler.jsonc` is the source of truth for resource binding types. Generate
the checked-in registry after adding or changing KV, Queue, Durable Object, or D1 bindings:

```console
npm run generate:bindings
```

`npm run build` regenerates it, while `npm test` rejects a stale generated
file. The registry contains names and types only; variables, secret names, and
all values are omitted. Pass it to the unified factory, which captures the
current Worker `env` and creates the Emscripten callbacks:

```js
handleRequest(
  createPicoRuby,
  picoRubyWasm,
  appBytecode,
  request,
  createCloudflareBindings(env, cloudflareBindingTypes),
);
```

For an environment-specific Wrangler section, the generator also accepts
`--env NAME`. Resource binding sections are not inherited from the top-level
configuration, matching Wrangler's environment model.

The runtime does not infer a resource type from methods such as `get` and
`put`; unregistered resources are rejected. Callback names use the
`picorbWorker` prefix. Duplicate names are rejected, so
a later binding cannot silently replace an existing host operation. HTTP body
limits remain `dispatch` request options and are not binding callbacks.

`npm test` loads the generated Wasm in Node and checks the ABI version, expected
Emscripten imports, Sinatra/Mustermann routing, Rack env behavior, binary
bodies, repeated cookies, HEAD, Sinatra 404/500 handling, the request body size
limit, per-request VM creation, and JSPI suspension/resumption.

The Worker creates a fresh PicoRuby VM for each request. JavaScript buffers each
Request asynchronously, then Ruby dispatch and response generation are
synchronous except for JSPI-backed host calls. The common host bridge carries
success, missing values, and host errors in one binary result frame; rejected
KV, Queue, Durable Object, and D1 Promises become `Cloudflare::HostError` in Ruby.
Each Rack env has a `cloudflare.env` proxy for KV, Queue, Durable Object, D1,
variables, and secrets. `ENV` retains a
direct scalar-value bypass because Worker `env` is already available for the
request.

`Rack::Cloudflare::Access` is [Access middleware](../docs/cloudflare-access.md).
The Ruby helper uses the generic [fetch wrapper](../docs/cloudflare-fetch.md).
Run `node test/fetch.mjs` for the host bridge tests.

`/debug/jspi` is only a feasibility probe. Streaming fetch and other
Cloudflare binding adapters remain outside this spike.

The current `picoruby-sinatra-covers` scope intentionally disables sessions,
rack-protection, logging middleware, static files, templates, and development
reloading. This spike verifies Sinatra routing and response generation on the
buffered Worker Rack protocol; it is not yet a full Sinatra deployment profile.

The release tag is paired with its commit SHA so an existing PicoRuby build
cache is also checked out to the expected source. For local experiments,
override both values together:

```console
PICORUBY_WORKER_WASM_REF=<tag-or-branch> \
PICORUBY_WORKER_WASM_REV=<commit> \
npm run build
```
