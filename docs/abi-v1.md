# Worker ABI version 1

ABI v1 transports one fully buffered HTTP request and response per dispatch.
Frames contain no pointers and do not rely on NUL termination.

The current JavaScript host creates one Wasm instance per request, initializes
its PicoRuby VM with `picorb_worker_init`, dispatches once, and calls
`picorb_worker_close` in a `finally` block. JSPI may suspend the dispatch export
without changing either frame format.

## Integer and byte encodings

- `u32` is an unsigned 32-bit little-endian integer.
- `bytes` is `u32 byte_length` followed by `byte_length` raw bytes.
- Text fields are UTF-8 at the JavaScript boundary.
- Request and response body fields are raw bytes and may contain NUL or invalid
  UTF-8 sequences.

## Request frame (`PRQ1`)

```text
4 bytes  magic: "PRQ1"
bytes    request method
bytes    URL scheme
bytes    server name
bytes    server port
bytes    HTTP host/authority
bytes    percent-encoded path
bytes    query without the leading "?"
bytes    HTTP protocol
u32      header count
repeat header count times:
  bytes  lowercase header name
  bytes  header value
bytes    request body
```

The C boundary currently rejects frames larger than 2 MiB. The JavaScript glue
defaults to a 1 MiB request-body limit so headers and framing remain within the
C limit. It rejects more than 256 request headers at the Ruby boundary.

## Response frame (`PRR1`)

```text
4 bytes  magic: "PRR1"
u32      HTTP status
u32      header count
repeat header count times:
  bytes  lowercase header name
  bytes  header value
bytes    response body
```

Repeated headers are encoded as repeated name/value pairs. In particular,
multiple `set-cookie` values remain separate through the ABI. The C boundary
currently limits the complete response frame to 8 MiB.

## Versioning

The JavaScript glue requires `picorb_worker_abi_version() == 1` and calls only
`picorb_worker_dispatch_v1`. A future incompatible wire format or dispatch
lifecycle must use a new ABI version and a new version-suffixed dispatch export.
The old, spike-only method/URL ABI is intentionally not retained.
