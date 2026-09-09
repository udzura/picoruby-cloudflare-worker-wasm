# Buffered HTTP fetch

```ruby
response = Cloudflare.fetch("https://example.com/api",
  method: "POST", headers: { "content-type" => "text/plain" }, body: "hello")
response.status
response.headers["content-type"]
response.body
```

`Cloudflare.fetch` wraps the Worker's native fetch using JSPI.
The default method is GET; headers default to an empty Hash and body to nil.
Methods and header values are strings. Request and response bodies are buffered
UTF-8 text. The response exposes status, a Hash of lowercase header names, and body.
HTTP error statuses are returned to Ruby; callers decide how to handle them.

The JS bridge is `picorbWorkerFetchBridge(url, options_json)`, installed by
`createFetchBindings()` and `createCloudflareBindings()`. It carries an HTTP
response through the existing host-result protocol. It knows nothing about Access,
JWTs or identity JSON.

Only HTTP(S) URLs without embedded credentials are accepted. Redirects are not
followed, requests time out after ten seconds, and response bodies are limited to
1 MiB. The C boundary limits URLs to 8192 bytes and encoded options to 1 MiB.
This interface does not implement streaming or binary bodies.
`mruby-pack` is required for control-character escapes in PicoRuby's JSON parser.

Invalid request arguments raise `ArgumentError`. Network failures, redirects,
invalid UTF-8 and oversized responses raise `Cloudflare::HostError`.
Error messages omit URLs, credentials and response bodies.

Run `node spike/test/fetch.mjs` for transport checks. The template integration
suite also exercises POST headers/body and responses through Wasm.
