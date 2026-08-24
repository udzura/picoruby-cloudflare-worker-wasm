# Rack compatibility

The initial adapter targets the Rack application protocol: an object accepting
an environment Hash and returning `[status, headers, body]`. It does not bundle
the Rack gem or promise that every CRuby Rack framework runs on PicoRuby.

## Supported contract

The adapter currently provides:

- direct registration with `Rackup::Handler::CloudflareWorker.run(App)`;
- CGI variables for method, script/path, query, server name/port/protocol,
  authority, content headers, and other `HTTP_` request headers;
- `rack.url_scheme`, `rack.input`, `rack.errors`, and
  `rack.response_finished`;
- binary-safe `rack.input` methods `read`, `gets`, `each`, `rewind`, and
  `close` over the buffered request body;
- Integer status and lowercase response-header validation;
- String and Array-of-String response header values, including repeated
  `set-cookie` values;
- Enumerable response bodies yielding Strings;
- response body `close`, including errors and HEAD requests;
- reverse-order `rack.response_finished` callbacks;
- empty response bodies for HEAD, 204, 205, and 304.

The JavaScript host reads the Worker `Request` body asynchronously. The complete
response is still buffered before a Worker `Response` is created. Ruby dispatch
is synchronous from the application's perspective, but a C-backed method may
suspend the Wasm stack through JSPI while awaiting a JavaScript Promise.

## Rack::Lint status

`test/rack_lint_test.rb` wraps a representative application with the official
Rack 3.2.7 `Rack::Lint`. It passes on CRuby through this adapter, covering the
environment, input/error interfaces, response tuple, headers, body iteration,
body close, content length, and response-finished callback path.

`Rack::Lint` is a development-time CRuby dependency only. It is not loaded into
PicoRuby: the upstream implementation depends on facilities such as complex
regular expressions, `Encoding`, `Forwardable`, URI utilities, and CRuby IO
types that are not all present in this minimal runtime. The smaller
`test/rack_adapter_test.rb` runs without the Rack gem and directly tests the
PicoRuby-facing adapter.

## Intentional gaps

- The final Fetch `Response` range is enforced as 200 through 599. Rack itself
  accepts status values starting at 100, so informational final responses are
  outside this adapter.
- Streaming bodies that respond to `call`, full/partial hijacking, early hints,
  protocol upgrades, and `to_path` optimization are not supported.
- `rack.session`, `rack.logger`, multipart tempfile factories, and other
  optional services are not installed by the server.
- Request bodies, Enumerable response bodies, and ABI frames have fixed memory
  limits and are fully buffered.
- `rack.response_finished` runs after the Ruby body has been buffered, not after
  Cloudflare finishes sending the network response.
- `config.ru` parsing and `Rack::Builder` are not supported; register the
  handler directly from the compiled application.
- The adapter validates the practical response subset itself, but it does not
  reproduce every `Rack::Lint` diagnostic inside PicoRuby.

Framework compatibility therefore depends both on its Rack behavior and on
whether its Ruby implementation can run within PicoRuby's available language
and standard-library subset.

## Asynchronous evolution

The spike verifies a JSPI-backed C method that suspends Ruby, awaits a
JavaScript Promise, and resumes on the same Ruby stack. This keeps binding calls
synchronous-looking to Ruby and does not require Fiber or `mruby-task` for the
single-request execution model. Emscripten's Wasm-native setjmp/longjmp support
is required so suspension does not cross an intervening JavaScript exception
wrapper.

This probe is not yet a Cloudflare binding API. Binding lookup, argument and
result encoding, rejected-Promise mapping to Ruby exceptions, and resource
limits still need explicit adapters and tests.

Streaming request/response bodies would require a further host-driven protocol
instead of one request frame and one response frame. Any incompatible wire or
lifecycle change will receive a new ABI version and versioned exports rather
than silently changing `picorb_worker_dispatch_v1`.
