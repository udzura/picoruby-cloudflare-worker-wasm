# Cloudflare D1

`Cloudflare::D1` exposes D1 prepared statements without carrying JavaScript
objects across the Wasm boundary. Ruby statement objects contain only a binding
name, SQL string, and scalar parameters. Each terminal operation serializes
that data as JSON and performs the asynchronous D1 call through JSPI.

Resolve a database through the request environment:

```ruby
db = env["cloudflare.env"].DB
# Equivalent explicit form:
db = Cloudflare::D1.from_env(env, "DB")
```

Configure the binding in `wrangler.jsonc`; the generated binding registry reads
the `binding` name from `d1_databases`:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-database",
      "database_id": "<database-id>"
    }
  ]
}
```

## Prepared statements

`prepare` creates a reusable Ruby statement specification. `bind` returns a new
statement and leaves the original unchanged, so one prepared SQL string can be
used with different parameters:

```ruby
statement = db.prepare("SELECT id, name FROM users WHERE id = ?1")

alice = statement.bind(1).first
bob = statement.bind(2).first
```

`query` is shorthand for `prepare(sql).bind(*params)`:

```ruby
statement = db.query(
  "SELECT id, name FROM users WHERE active = ?1 ORDER BY id",
  true
)
```

Terminal operations are:

```ruby
result = statement.run       # Cloudflare::D1::Result, including D1 metadata
rows = statement.rows        # Array<Cloudflare::D1::Row>
row = statement.first        # Row or nil
name = statement.first(:name) # one column value or nil
raw = statement.raw
raw_with_names = statement.raw(column_names: true)
```

Rows have String keys from JSON and also accept Symbols with `[]`:

```ruby
row["name"]
row[:name]
```

`Result` exposes `success?`, `rows`, `meta`, `changes`, `last_row_id`,
`duration`, `rows_read`, `rows_written`, and `changed_db?`.

## Batch

`batch` accepts a non-empty Array of statements belonging to the same D1
binding and returns one `Result` per statement in the same order:

```ruby
results = db.batch([
  db.query("INSERT INTO users (name) VALUES (?1)", "Alice"),
  db.query("INSERT INTO users (name) VALUES (?1)", "Bob"),
])
```

D1 executes a batch sequentially and rolls the batch back if a statement
fails. This initial API therefore exposes `batch` rather than an arbitrary
Ruby transaction block.

## Parameter and bridge limits

Parameters may be `nil`, String, Integer, Float, `true`, or `false`. Integers
must be within JavaScript's safe integer range and Floats must be finite.
Strings are copied when bound. Hash, Array, Symbol, arbitrary objects, BLOBs,
and BigInt values are not accepted as parameters in this version.

Requests and responses use JSON strings and are limited to 8 MiB at the Wasm
boundary. A rejected D1 Promise raises `Cloudflare::HostError`; missing or
incorrectly typed bindings raise `Cloudflare::BindingError`; malformed bridge
data raises `Cloudflare::ProtocolError`.

Dataset/query builders, model classes, `exec`, D1 Sessions/read replication,
and BLOB parameter encoding are intentionally deferred. See Cloudflare's
[D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[prepared statement API](https://developers.cloudflare.com/d1/worker-api/prepared-statements/),
and [return object reference](https://developers.cloudflare.com/d1/worker-api/return-object/)
for the corresponding platform behavior.
