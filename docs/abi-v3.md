# Worker ABI version 3

ABI v3 adds host-owned response streams. JavaScript glue and Wasm must both
use v3; rebuild generated projects together. The `PRQ1` request and `PHC1`
host-call formats from [v2](abi-v2.md) are unchanged. The existing
`picorb_worker_dispatch_v1` export name refers to the request format.

## Host result (`PHB1`)

Kinds 0–5 retain their v2 meaning. Kind **6** is a host stream: its payload is
exactly one nonzero little-endian u32 handle. C constructs a
`Cloudflare::HostStreamBody` instead of a String. No stream bytes enter Wasm.

## Response (`PRR2`)

All integers are little-endian u32. `bytes` means a u32 byte length followed
by that many bytes.

```text
4 bytes  magic: "PRR2"
u32      status
u32      header pair count
repeat header pair count times:
  bytes  header name
  bytes  header value
u32      body mode
if body mode == 0 (inline):
  bytes  body
if body mode == 1 (host_stream):
  u32    stream handle
```

Unknown modes, missing/consumed handles, truncated frames and trailing bytes
are rejected. Inline responses retain the 8 MiB frame limit. Host-stream
payloads are not buffered and are not subject to that frame limit.

## Ownership and completion

Each VM gets a separate JS registry, even if its binding configuration is
reused. Handles are monotonically allocated and transferred once. Dispatch
cancels unused streams on success or failure, and closing a VM also discards
any remaining handles. A transferred stream belongs to the Response and
survives VM closure. The JS reader forwards demand, cancellation and upstream
errors; request abort cancels the upstream too. HEAD/204/205/304 cancel the
source without sending a body. Streaming responses omit `content-length`
and `transfer-encoding`; Workers selects HTTP transport framing.

This is an adapter-specific pass-through body, not generic Rack streaming.
Ruby `each` cannot consume it, and middleware must preserve the body object
rather than wrap/enumerate it. Ruby cleanup and `rack.response_finished` run
at dispatch/host handoff, **not** at network stream completion. They cannot
observe later upstream errors or client disconnects. Ruby chunk transforms,
completion callbacks, task scheduling and streaming request bodies remain
future work.
