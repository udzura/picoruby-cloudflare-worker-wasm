# Cloudflare Access middleware

`Cloudflare::Access` is Rack middleware defined by this Worker mrbgem.
When `Rack` is already defined at load time, `Rack::Cloudflare::Access` aliases it.
The runtime does not create the Rack namespace when Rack is absent.

```ruby
app = Rack::Builder.new do
  use Rack::Cloudflare::Access, team: "my-team"
  run lambda { |env|
    identity = env["cloudflare.identity"]
    [200, { "content-type" => "text/plain" }, [identity.email]]
  }
end
Rackup::Handler::CloudflareWorker.run(app)
```

Omit `team:` to read `CF_ACCESS_TEAM` from each request's `cloudflare.env`.
Use only the prefix of `<team>.cloudflareaccess.com`, not a full URL.
At the start of each call the middleware clears any old identity, reads the
`CF_Authorization` cookie, and calls `Cloudflare::Access.get_identity(token, team:)`.
The class method constructs the URL and cookie in Ruby, calls [Cloudflare.fetch](cloudflare-fetch.md),
checks the HTTP status and decodes the JSON into an `AccessIdentity`.
The middleware stores it at `env["cloudflare.identity"]` before calling the app.
The object exposes `email`, `user_uuid` and the full JSON object as `raw_data`.
Identity and token data are not cached between requests.

Missing/invalid team configuration returns 503. Missing/invalid cookies and
Access HTTP 401/403 responses return 401. Network, other HTTP and protocol
failures return 502. These responses do not call the app.
Exceptions raised by the downstream app propagate normally.

The class method can also be called directly:

```ruby
identity = Cloudflare::Access.get_identity(token, team: "my-team")
```

It raises `ArgumentError` for invalid arguments, `Cloudflare::Access::Unauthorized`
for Access 401/403, `Cloudflare::HostError` for network/other HTTP failures,
and `Cloudflare::ProtocolError` for invalid identity JSON.

This calls the [Access identity endpoint](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
with the authorization cookie. It decodes the returned JSON, not a local JWT
payload, and does not locally validate JWT signatures, issuer, expiry or audience.
Protect the app with Access and implement the token validation required by your deployment.
It does not implement service-token authentication.

Run `ruby test/access_test.rb` for middleware tests and `node spike/test/fetch.mjs`
for transport tests. The template integration suite exercises the middleware
and fetch through rebuilt Wasm using mock responses.
