# PicoRuby Cloudflare Workers spike

This is a bindings-free Cloudflare Workers feasibility project. It builds a
PicoRuby Wasm runtime, compiles `app.rb` to bytecode, and exposes the app through
the mrbgem's Rack-compatible handler. The released `picoruby-worker-wasm` is
resolved from GitHub at the tag recorded in the build configuration.

## Prerequisites

- A PicoRuby source checkout compatible with this gem
- Emscripten 5.0.7 (`spike/.emscripten-version` is checked before a build)
- Node.js and npm

Install Worker development dependencies, point the project at PicoRuby, and
build the runtime:

```console
cd spike
npm install
export PICORUBY_ROOT=/absolute/path/to/picoruby
npm run build
```

`npm run build` performs all build-time work:

1. invokes PicoRuby's Rakefile with `build_config/picoruby-worker-wasm.rb`;
2. clones `udzura/picoruby-cloudflare-worker-wasm` as the mrbgem dependency;
3. generates `dist/picoruby-worker.js` and `dist/picoruby-worker.wasm`;
4. compiles `app.rb` with the matching host `mrbc` into `dist/app.bin`.

When developing unreleased changes in the parent mrbgem, bypass the GitHub pin:

```console
PICORUBY_WORKER_WASM_GEM_DIR=.. npm run build
```

After changing only `app.rb`, rebuild just the bytecode:

```console
npm run build:app
```

Run locally, execute the generated-Wasm test, or validate the deploy bundle:

```console
npm run dev
npm test
npm run check
```

`npm run dev` first compiles `app.rb`, starts Wrangler, and watches `app.rb`.
Each saved Ruby change runs the equivalent of `npm run build:app`; Wrangler
then observes the updated `dist/app.bin` and reloads the local Worker. To run
only the Ruby bytecode watcher, use `npm run watch:app`.

The example registers `App` with
`Rackup::Handler::CloudflareWorker.run(App)` and exposes:

- `GET /ruby_version`
- `GET /factorial`
- any method at `/hello`
- `POST /echo?name=pico`, which returns the binary request body
- any method at `/debug/request`, which dumps the Rack request state

`npm test` loads the generated Wasm in Node and checks the ABI version, lack of
WASI imports, Rack routing/env behavior, binary bodies, repeated cookies, HEAD,
404, and the request body size limit.

The Worker creates one PicoRuby VM per isolate. JavaScript buffers each Request
asynchronously, then Ruby dispatch and response generation are synchronous.
Cloudflare bindings and asynchronous Ruby are intentionally outside this spike.

The release tag is paired with its commit SHA so an existing PicoRuby build
cache is also checked out to the expected source. For local experiments,
override both values together:

```console
PICORUBY_WORKER_WASM_REF=<tag-or-branch> \
PICORUBY_WORKER_WASM_REV=<commit> \
npm run build
```
