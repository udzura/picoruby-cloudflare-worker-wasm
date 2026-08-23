# picoruby-cloudflare-worker-wasm

An external PicoRuby mrbgem that builds a small, synchronous Rack-compatible
runtime for [Cloudflare Workers](https://workers.cloudflare.com/).

`spike/` is a runnable, bindings-free Worker project. It builds PicoRuby as
WebAssembly, compiles `spike/app.rb` to mruby bytecode, and imports both
artifacts from the Worker module.

See [spike/README.md](spike/README.md) for setup and build instructions.

## Rack application

Register a Rack-style application directly from the precompiled Ruby program:

```ruby
class App
  def self.call(env)
    body = env["rack.input"].read
    [200, { "content-type" => "application/octet-stream" }, [body]]
  end
end

Rackup::Handler::CloudflareWorker.run(App)
```

The runtime maps a Worker `Request` to a Rack environment and maps the returned
`[status, headers, body]` tuple to a Worker `Response`. Request and response
bodies are binary-safe but fully buffered in the initial implementation.

This is a Rack protocol adapter, not the complete CRuby Rack distribution.
See [docs/rack-compatibility.md](docs/rack-compatibility.md) for the supported
contract, limits, `Rack::Lint` results, and asynchronous roadmap.

## Current scope

- one PicoRuby VM per Worker isolate;
- versioned, length-prefixed binary ABI;
- precompiled application bytecode only;
- direct handler registration without `config.ru`;
- asynchronous request buffering in JavaScript followed by synchronous Ruby
  dispatch;
- no filesystem, sockets, runtime Ruby compilation, Cloudflare bindings,
  streaming bodies, or asynchronous Ruby execution.

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

ABI version 1 exports:

```text
picorb_worker_abi_version()
picorb_worker_init(app_mrb_ptr, app_mrb_len)
picorb_worker_dispatch_v1(request_frame_ptr, request_frame_len)
picorb_worker_response_ptr()
picorb_worker_response_len()
picorb_worker_error_ptr()
picorb_worker_error_len()
```

`picorb_worker_init` may be called once per Worker isolate. The JavaScript glue
checks `picorb_worker_abi_version()` before initialization. Dispatch is
synchronous once the request frame has been buffered. A Ruby exception or an
invalid response is reported through the error buffer and a non-zero status
code.

The v1 request frame begins with `PRQ1`; the response frame begins with `PRR1`.
All integers are unsigned 32-bit little-endian values and all variable data is
encoded as `byte_length` followed by exactly that many bytes. The complete
layout is documented in [docs/abi-v1.md](docs/abi-v1.md).

## Tests

Run the Ruby adapter tests and the official Rack lint integration test:

```console
bundle install
ruby test/rack_adapter_test.rb
bundle exec ruby test/rack_lint_test.rb
```

After building the spike, run the generated-Wasm integration test with
`npm test` from `spike/`.

## License and origin

This project is MIT licensed. It includes code derived from PicoRuby; see
[NOTICE](NOTICE) and [LICENSES/PicoRuby-MIT.txt](LICENSES/PicoRuby-MIT.txt)
for the upstream attribution and license text.
