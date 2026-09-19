# Worker ABI version 2

ABI v2 keeps the ABI v1 `PRQ1` request, `PRR1` response, and `PHB1` host-result
frames. It replaces the operation-specific asynchronous Cloudflare imports with
one JSPI host-call import. Synchronous environment value and binding-type
lookups remain separate imports.

## Host call frame (`PHC1`)

```text
4 bytes  magic: "PHC1"
bytes    operation name in UTF-8
bytes    binding name in UTF-8, or empty for an unbound operation
u32      argument count
repeat argument count times:
  bytes  operation-specific argument
```

The current boundary accepts at most 16 arguments and an 8 MiB complete host
call frame. Arguments are byte strings so binary KV values do not need Base64
encoding. Each allowlisted operation defines which arguments are UTF-8, JSON,
or raw bytes and applies its own size and value validation.

The initial operation names are `kv.get`, `kv.put`, `queue.send`,
`durable_object.get`, `durable_object.put`, `d1.execute`, and `fetch`.
Unknown operations, invalid arity, malformed framing, and invalid text produce
a `PHB1` protocol-error result.

## Host result frame (`PHB1`)

The result format is unchanged from ABI v1:

```text
4 bytes  magic: "PHB1"
u32      result kind
u32      payload length
raw      payload bytes
```

Result kinds are `0` success, `1` missing value, `2` host operation error,
`3` binding resolution error, `4` invalid argument, and `5` bridge protocol
error.

## Versioning

The JavaScript glue requires `picorb_worker_abi_version() == 2`. The HTTP
dispatch export remains `picorb_worker_dispatch_v1` because its `PRQ1` and
`PRR1` wire formats did not change. ABI v1 JavaScript glue and ABI v2 Wasm are
not compatible because the imported host-call surface changed.
