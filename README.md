# picoruby-cloudflare-worker-wasm

Minimal PicoRuby runtime support for [Cloudflare Workers](https://workers.cloudflare.com/).

`spike/` is a runnable, bindings-free Cloudflare Workers project. It builds a
small PicoRuby WebAssembly runtime, compiles `spike/app.rb` to bytecode, and
imports both artifacts from the Worker module.

See [spike/README.md](spike/README.md) for setup and build instructions.

An external PicoRuby mrbgem that builds a minimal, synchronous runtime for
Cloudflare Workers.

The gem loads precompiled mruby bytecode and calls:

```ruby
PicoRubyWorker.fetch(method, url)
```

It returns the String produced by that method to the JavaScript Worker host.

## Current scope

- one PicoRuby VM per Worker isolate;
- precompiled application bytecode only;
- synchronous Ruby dispatch;
- no filesystem, sockets, runtime Ruby compilation, Cloudflare bindings, or
  asynchronous Ruby execution.

`mruby-task` remains linked because it is required by `picoruby-mruby`, but the
provided Worker HAL supports neither scheduling nor Fiber-based task APIs.

## Use from a PicoRuby build

This repository is an external mrbgem, not a standalone PicoRuby checkout. Add
it to a PicoRuby build configuration and select its Worker task HAL:

```ruby
MRuby::CrossBuild.new("picoruby-worker-wasm") do |conf|
  conf.toolchain :clang

  conf.cc.command = "emcc"
  conf.linker.command = "emcc"
  conf.archiver.command = "emar"

  conf.cc.defines << "PICORB_PLATFORM_WASM"
  conf.cc.defines << "PICORB_PLATFORM_CLOUDFLARE_WORKERS"
  conf.cc.defines << "MRB_32BIT"
  conf.cc.defines << "MRB_INT64"
  conf.cc.defines << "MRB_NO_BOXING"
  conf.cc.defines << "MRB_UTF8_STRING"

  conf.ports :worker_wasm
  conf.picoruby(alloc_estalloc: false)
  conf.gem gemdir: "/absolute/path/to/picoruby-cloudflare-worker-wasm"
end
```

The current build uses Emscripten 5.0.7. It produces:

```text
picoruby-worker.js
picoruby-worker.wasm
```

The JavaScript glue is an ES module factory. The Cloudflare host passes its
precompiled `WebAssembly.Module` through Emscripten's `instantiateWasm` hook.

## C ABI

The generated module exports the following API:

```text
picorb_worker_init(app_mrb_ptr, app_mrb_len)
picorb_worker_dispatch(method_ptr, method_len, url_ptr, url_len)
picorb_worker_result_ptr()
picorb_worker_result_len()
picorb_worker_error_ptr()
picorb_worker_error_len()
```

`picorb_worker_init` may be called once per Worker isolate. Dispatch is
synchronous; a Ruby exception or a non-String result is reported through the
error buffer and a non-zero status code.

## License and origin

This project is MIT licensed. It includes code derived from PicoRuby; see
[NOTICE](NOTICE) and [LICENSES/PicoRuby-MIT.txt](LICENSES/PicoRuby-MIT.txt)
for the upstream attribution and license text.
