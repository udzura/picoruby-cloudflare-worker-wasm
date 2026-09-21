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

## Consumer API

Register a consumer in the same Ruby source as the Rack application, or in a
separate file compiled into the same Worker bytecode:

```ruby
class EventConsumer < Cloudflare::QueueConsumer::Base
  def call(_env)
    current_batch.messages.each do |message|
      bindings.EVENTS_KV.put(message.id, message.body)
      message.ack
    end
  end
end

Cloudflare::Queues.run(EventConsumer)
```

The consumer receives an env Hash with `cloudflare.env` (a
`Cloudflare::Environment`) and `cloudflare.batch` (the Queue batch).
`Cloudflare::QueueConsumer::Base` exposes them as `bindings` and
`current_batch` during `call` and clears that state when dispatch completes.

`current_batch.queue` is the configured Queue name. Each message exposes `id`,
`timestamp` (milliseconds since the Unix epoch), `body`, and `attempts`.
`body` is a UTF-8 String. Call `message.ack` or
`message.retry(delay_seconds: 30)` to settle an individual message. Use
`batch.ack_all` and `batch.retry_all(delay_seconds: 30)` for the entire batch.

When a consumer returns normally, Cloudflare acknowledges messages that were
not explicitly retried. If it raises, the Worker Queue callback rejects and
Cloudflare retries the whole batch. Explicit message actions keep Cloudflare's
normal precedence over a batch-level action.

Return `[:debug, metadata, message]`, `[:info, metadata, message]`,
`[:warn, metadata, message]`, or `[:error, metadata, message]` to emit a
Cloudflare Worker log at that level. `metadata` must be a JSON-serializable
Hash and `message` must be a String:

```ruby
[:info, { "queue" => current_batch.queue, "count" => current_batch.messages.size }, "Queue batch processed"]
```

The return value does not settle the Queue. Use `ack`, `retry`, `ack_all`, or
`retry_all` for that. Other return values are ignored.

The consumer accepts Rack-style middleware:

```ruby
class AuditQueue
  def initialize(app)
    @app = app
  end

  def call(env)
    # Record metrics or establish per-batch state here.
    @app.call(env)
  end
end

Cloudflare::Queues.run(EventConsumer) do
  use AuditQueue
end
```

Middleware is built by `Rack::Builder` in reverse declaration order, as with
Rack. Its `call` method receives the Queue env Hash. It follows Rack's callable
shape but is not a Rack request: Queue env does not contain request fields and
the consumer return value is ignored.

Add a consumer configuration alongside the producer binding:

```jsonc
{
  "queues": {
    "consumers": [
      { "queue": "events" }
    ]
  }
}
```

## Scope and limits

- Messages are limited to 128 KiB.
- The producer supports UTF-8 String bodies and single-message `send` only.
- JSON objects, byte messages, delay options, batch sends, metrics, and
  `ctx.waitUntil()` are not included yet. Consumer bodies are UTF-8 Strings,
  matching the initial producer API.
