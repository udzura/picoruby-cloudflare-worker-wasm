# picoruby-actived1

A PicoRuby mrbgem for the Cloudflare Workers D1 binding. ActiveD1 builds
prepared statements from a schema generated on the development machine. The
application bytecode contains the schema and column accessors.

## Run the spike

From the repository root, with the spike's PicoRuby and Emscripten prerequisites
installed, run:

```sh
cd spike
npm ci
export PICORUBY_ROOT=/absolute/path/to/picoruby
export PICORUBY_BUILD_CONFIG=build_config/actived1.rb
export PICORUBY_APP=lib/actived1/app.rb

npx wrangler d1 migrations apply DB --local
../picoruby-actived1/exe/actived1 generate --output lib/actived1/generated/actived1_schema.rb
npm run build
npm run dev
```

```sh
curl -X POST http://localhost:8787/posts -H 'content-type: application/json' -d '{"title":"Hello"}'
curl http://localhost:8787/posts/1
curl -X PATCH http://localhost:8787/posts/1 -H 'content-type: application/json' -d '{"title":"Updated"}'
curl -X DELETE http://localhost:8787/posts/1
```

The spike compiles a sibling `generated/actived1_schema.rb` before the app.
After a migration, regenerate that file and run `npm run build:app`.
`actived1 generate` invokes the project's Wrangler with `--local` and accepts
`--database`, `--config`, `--persist-to` and `--output`. Run it from the
Wrangler project directory. It reads table names and `table_xinfo` in one SQL
query. The generated metadata preserves declared types, the declared NOT NULL
flag, SQL defaults and generated-column write restrictions.

## Use in another app

Add `conf.gem gemdir: "/path/to/picoruby-actived1"` to a PicoRuby Worker
build with `picoruby-worker-wasm` (D1 support) and `mruby-regexp`.
Compile the generated schema and your entrypoint together, in that order.
Scope the binding to each Rack dispatch. The spike's Sinatra app uses:

```ruby
class Post < ActiveD1::Base
end

class PostsApp < Sinatra::Base
  def self.call(env)
    ActiveD1.with_database(env["cloudflare.env"].DB) { super(env) }
  end

  get "/posts" do
    content_type "application/json"
    JSON.generate(Post.order(id: :desc).limit(20).all.map { |post| post.attributes })
  end
end
```

Inside that scope:

```ruby
post = Post.create(title: "First post")
post = Post.find(post.id)
post.title = "New title"
post.save
post.update(published: true)
Post.where(published: true).order(id: :desc).limit(10).offset(0).all
Post.where(body: nil).count
Post.where(title: "New title").exists?
Post.query("SELECT * FROM posts WHERE title LIKE ?", ["New%"])
post.destroy
```

- Model names use a small set of English pluralization rules (`BlogEntry` maps
  to `blog_entries`). Set `self.table_name = "people"` in a model for exceptions.
  The generator skips tables without a single primary key and reports their names.
  Use a non-null primary key to identify persisted records.
- Attribute hashes and raw query results use D1 column names as string keys.
  `record[:name]` and `record[:name] = value` also work for unusual column
  names and columns that overlap model methods. Generated columns are read-only.
- D1 handles defaults and SQLite affinity. Booleans bind as SQLite integers.
  Numeric and text values come back as D1 returns them. Supply dates and JSON
  as strings. The Worker bridge supports finite numbers, safe integers, strings,
  booleans and null as parameters.
- Chaining is lazy. `first` defaults to primary-key order and returns nil for
  an empty page. `find` raises `ActiveD1::RecordNotFound`. `count` and
  `exists?` respect pagination and execute in SQL.
- `create`, `save` and `update` hydrate the record with `RETURNING *`.
  Saving an unchanged record skips D1. A stale update or delete raises
  `RecordNotFound`. Include the primary key in raw projections to update
  or destroy a record.
- Batch operations remain available through the underlying D1 binding.

## Verification

From `spike/`, after the build above:

```sh
ruby ../picoruby-actived1/test/actived1_test.rb
npm run test:actived1
node bench/actived1.mjs
```

The integration test sends HTTP requests through Sinatra on PicoRuby.wasm and
an isolated workerd D1 database. The benchmark runs the same bytecode on Node
with a local Miniflare D1 binding. It reports elapsed time and Node main-thread
CPU separately for initialization and CRUD. The bridge measurement replays a
20-row result to isolate JS decoding, validation and encoding. Linear memory
is the Wasm allocation size. Production Workers CPU and live heap usage
require separate measurements.
