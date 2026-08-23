# PicoRuby Cloudflare Workers spike

This is a bindings-free Cloudflare Workers feasibility project. The runtime is
built from a local PicoRuby checkout and loads this directory's precompiled
`app.rb` bytecode. `picoruby-worker-wasm` itself is cloned from GitHub by the
PicoRuby build system at the revision recorded in
`build_config/picoruby-worker-wasm.rb`.

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

After changing only `app.rb`, rebuild just the bytecode:

```console
npm run build:app
```

Run locally or validate the deploy bundle:

```console
npm run dev
npm run check
```

The example routes are `/ruby_version`, `/factorial`, and `/hello`. The Worker
creates one PicoRuby VM per Worker isolate. Calls into Ruby are synchronous;
Cloudflare bindings and asynchronous Ruby are intentionally outside this spike.

`PICORUBY_WORKER_WASM_REV` can override the pinned mrbgem revision for local
experiments, for example:

```console
PICORUBY_WORKER_WASM_REV=<commit> npm run build
```
