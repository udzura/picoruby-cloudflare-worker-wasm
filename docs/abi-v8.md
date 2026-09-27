# Worker ABI version 8

ABI v8 adds an optional `afterRequest` hook to the existing `PRQ2` request and
`PRR2` response frames. JavaScript and Wasm must be rebuilt together.

When the hook is set, the request frame appends a JSON object string for
JavaScript-provided Rack env values (or `{}`), followed by `u32 1`. Without the
hook, the frame retains its earlier shape; `rackEnv` alone appends only the JSON
string. The Ruby adapter rejects additions that overwrite existing Rack keys.

After the Ruby app and `rack.response_finished` callbacks run, the adapter
selects env entries that contain JSON-compatible values. It omits resource
wrappers, streams, callbacks, cyclic values, and values nested beyond eight
levels. The resulting snapshot is capped at 64 KiB and appended to the response
frame as a JSON string after the response body. The snapshot is a copy: the
JavaScript hook cannot mutate the original Ruby env.

The hook receives `(request, env, ctx, rackEnv, response)`: the first three arguments are
the original Worker objects supplied to the handler, and `rackEnv` is
the JSON snapshot. Returning `undefined` keeps the Ruby response; returning a
`Response` replaces it. A thrown exception propagates to the Worker handler.
Replacing a streamed response cancels its original body.
The hook runs only after a successful Ruby dispatch.
