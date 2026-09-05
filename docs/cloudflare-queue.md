# Cloudflare Queues

The initial producer API sends one text message at a time:

```ruby
class App
  def self.call(env)
    env["cloudflare.env"].EVENTS_QUEUE.send("event-created")
    [202, { "content-type" => "text/plain" }, ["queued"]]
  end
end
```

The explicit Ruby API resolves the same cached binding:

```ruby
queue = Cloudflare::Queue.from_env(request.env, "EVENTS_QUEUE")
queue.send("event-created")
```

`send` accepts a UTF-8 PicoRuby String, sends it with Cloudflare's `text`
content type, and returns `nil` after the Queue Promise resolves. A missing or
incorrectly typed Queue binding raises `Cloudflare::BindingError`; a rejected
Promise raises `Cloudflare::HostError`.

## Wrangler configuration

Configure a producer binding with the same name used from Ruby:

```jsonc
{
  "queues": {
    "producers": [
      {
        "binding": "EVENTS_QUEUE",
        "queue": "events"
      }
    ]
  }
}
```

## Scope and limits

- Messages are limited to 128 KiB.
- Only UTF-8 String bodies and single-message `send` are supported.
- JSON objects, byte messages, delay options, batch sends, metrics, and Queue
  consumer handlers are not included yet.
