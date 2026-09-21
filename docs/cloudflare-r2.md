# Cloudflare R2

`Cloudflare::R2` provides the basic R2 bucket operations through the shared
host-call bridge. Add the bucket binding to `wrangler.jsonc`:

```jsonc
{
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "my-bucket" }]
}
```

Get a bucket from the Rack environment and upload a Ruby String. Strings are
forwarded as raw bytes, so binary data is preserved:

```ruby
bucket = env["cloudflare.env"].BUCKET
object = bucket.put(
  "greeting.txt",
  "Hello from PicoRuby\n",
  httpMetadata: { contentType: "text/plain" },
  customMetadata: { source: "worker" }
)
puts object.etag
```

`head(key)` returns an object metadata wrapper or `nil`. `delete(key_or_keys)`
deletes one key or an array of keys. `list(options = {})` returns a listing with
`objects`, `truncated?`, `cursor`, and `delimited_prefixes`. R2 options must be
JSON-compatible Hashes; this covers options such as `range`, `onlyIf`,
`httpMetadata`, `customMetadata`, and `storageClass` that do not require a
JavaScript `Headers`, `Date`, or `ArrayBuffer` value.

## Streaming downloads

`get(key, options = {})` returns `nil`, an object metadata wrapper for a failed
precondition, or an object whose `body` is an opaque
`Cloudflare::StreamDescriptor`. Set that descriptor as `cloudflare.hijack` to
send the original R2 byte stream directly to the response:

```ruby
object = bucket.get("greeting.txt", range: { offset: 0, length: 1024 })
return [404, { "content-type" => "text/plain" }, ["not found"]] unless object

env["cloudflare.hijack"] = object.body
[200, { "content-type" => object.http_metadata["contentType"] || "application/octet-stream" }, []]
```

The R2 stream is JavaScript-owned and cannot be read or transformed in Ruby.
Do not set `content-length` or `transfer-encoding`; Workers controls stream
framing. Multipart uploads and direct `Headers`/`Date`/`ArrayBuffer` R2 option
values are not yet exposed.
