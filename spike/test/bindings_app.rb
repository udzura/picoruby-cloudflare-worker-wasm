class DurablePojoSource
  def to_pojo
    { "source" => "to_pojo", "nested" => [{ "ok" => true }] }
  end
end

class InvalidDurablePojoSource
  def to_pojo
    "not a POJO"
  end
end

class BindingsApp
  def self.call(env)
    case env["PATH_INFO"]
    when "/env"
      text = ENV["TEXT_VALUE"] || "missing"
      json = ENV["JSON_VALUE"] || "missing"
      secret = ENV["SECRET_VALUE"] || "missing"
      present = ENV.key?("TEXT_VALUE") ? "present" : "missing"
      resource = ENV["KV_BINDING"] || "missing"
      [200, { "content-type" => "text/plain; charset=utf-8" }, [
        "#{text}|#{json}|#{secret}|#{present}|#{resource}",
      ]]
    when "/env/overlay"
      original = ENV.fetch("TEXT_VALUE")
      ENV["TEXT_VALUE"] = "overridden"
      assigned = [ENV["TEXT_VALUE"], ENV.fetch("TEXT_VALUE"), ENV.key?("TEXT_VALUE")]
      deleted = ENV.delete("TEXT_VALUE")
      missing = [ENV["TEXT_VALUE"], ENV.fetch("TEXT_VALUE", "default"), ENV.key?("TEXT_VALUE")]
      ENV.update("FIRST" => "one", "REMOVED" => nil)
      updated = [ENV["FIRST"], ENV.key?("REMOVED")]
      ENV.replace("SECOND" => "two")
      replaced = [ENV["FIRST"], ENV["SECOND"], ENV["SECRET_VALUE"]]
      [200, { "content-type" => "text/plain" }, [
        [original, assigned, deleted, missing, updated, replaced,
         ENV.is_a?(Hash), ENV.respond_to?(:shift), ENV.inspect].inspect,
      ]]
    when "/env/overlay/reset"
      [200, { "content-type" => "text/plain" }, [[ENV["TEXT_VALUE"], ENV["SECRET_VALUE"]].inspect]]
    when "/env/value-types"
      [200, { "content-type" => "text/plain" }, [[
        ENV["JSON_VALUE"], ENV["ARRAY_VALUE"], ENV["BOOL_VALUE"],
        ENV["NUMBER_VALUE"], ENV["NULL_VALUE"], ENV.key?("NULL_VALUE"),
      ].inspect]]
    when "/cloudflare/env"
      cloudflare = env["cloudflare.env"]
      [200, { "content-type" => "text/plain; charset=utf-8" }, [
        "#{cloudflare.TEXT_VALUE}|#{cloudflare.JSON_VALUE}|#{cloudflare.SECOND_KV.class}|#{cloudflare.QUEUE_FOO.class}",
      ]]
    when "/cloudflare/env/value-types"
      cloudflare = env["cloudflare.env"]
      missing_error = begin
        cloudflare.fetch("MISSING_VALUE")
      rescue KeyError => error
        error.class
      end
      [200, { "content-type" => "text/plain" }, [[
        cloudflare.JSON_VALUE, cloudflare.ARRAY_VALUE, cloudflare.BOOL_VALUE,
        cloudflare.NUMBER_VALUE, cloudflare.NULL_VALUE,
        cloudflare.key?("NULL_VALUE"), cloudflare.fetch("NULL_VALUE"),
        cloudflare["MISSING_VALUE"], cloudflare.key?("MISSING_VALUE"), missing_error,
      ].inspect]]
    when "/cloudflare/env/inspect"
      cloudflare = env["cloudflare.env"]
      cloudflare.SECRET_VALUE
      [200, { "content-type" => "text/plain" }, ["#{cloudflare.inspect}\n#{env.inspect}"]]
    when "/kv/named/set"
      env["cloudflare.env"].SECOND_KV.put("named-key", "named-value")
      [200, { "content-type" => "text/plain; charset=utf-8" }, ["named-set"]]
    when "/kv/named/get"
      value = Cloudflare::KV.from_env(env, "SECOND_KV").get("named-key")
      [200, { "content-type" => "text/plain; charset=utf-8" }, [value || "missing"]]
    when "/kv/nul-key/set"
      env["cloudflare.env"].SECOND_KV.put("account\x00other", "nul-value")
      [200, { "content-type" => "text/plain" }, ["nul-set"]]
    when "/kv/nul-key/get"
      value = env["cloudflare.env"].SECOND_KV.get("account\x00other")
      [200, { "content-type" => "text/plain" }, [value || "missing"]]
    when "/kv/invalid-utf8-key"
      begin
        env["cloudflare.env"].SECOND_KV.put("\xff", "invalid-value")
      rescue ArgumentError => error
        [200, { "content-type" => "text/plain" }, ["argument-error=#{error.message}"]]
      end
    when "/kv/ttl"
      value = "\x00\xff"
      results = [
        env["cloudflare.env"].SECOND_KV.put("ttl-direct", value, ttl: 60),
        Cloudflare::KV.from_env(env, "SECOND_KV").put("ttl-from-env", value, ttl: 120),
        env["cloudflare.env"].SECOND_KV.put("ttl-nil", value, ttl: nil),
      ]
      [200, { "content-type" => "text/plain" }, [results == [nil, nil, nil] ? "ttl-set" : "unexpected-result"]]
    when "/kv/ttl/invalid"
      begin
        env["cloudflare.env"].SECOND_KV.put("ttl-invalid", "value", ttl: 59)
      rescue ArgumentError => error
        [200, { "content-type" => "text/plain" }, ["argument-error=#{error.message}"]]
      end
    when "/kv/put-rejected"
      begin
        env["cloudflare.env"].SECOND_KV.put("reject", "value", ttl: 60)
      rescue Cloudflare::HostError => error
        [200, { "content-type" => "text/plain" }, ["host-error=#{error.message}"]]
      end
    when "/kv/from-env-alias"
      direct = env["cloudflare.env"].SECOND_KV
      explicit = Cloudflare::KV.from_env(env, "SECOND_KV")
      [200, { "content-type" => "text/plain; charset=utf-8" }, [direct.equal?(explicit) ? "same" : "different"]]
    when "/kv/missing-binding"
      begin
        Cloudflare::KV.from_env(env, "MISSING_KV").get("key")
      rescue Cloudflare::BindingError => error
        [200, { "content-type" => "text/plain; charset=utf-8" }, ["binding-error=#{error.message}"]]
      end
    when "/kv/rejected"
      begin
        Cloudflare::KV.from_env(env, "SECOND_KV").get("reject")
      rescue Cloudflare::HostError => error
        [200, { "content-type" => "text/plain; charset=utf-8" }, ["host-error=#{error.message}"]]
      end
    when "/queue/send"
      env["cloudflare.env"].QUEUE_FOO.send("queue-message")
      [200, { "content-type" => "text/plain; charset=utf-8" }, ["queue-sent"]]
    when "/queue/from-env"
      Cloudflare::Queue.from_env(env, "QUEUE_FOO").send("from-env-message")
      [200, { "content-type" => "text/plain; charset=utf-8" }, ["queue-sent-from-env"]]
    when "/queue/rejected"
      begin
        env["cloudflare.env"].QUEUE_FOO.send("reject")
      rescue Cloudflare::HostError => error
        [200, { "content-type" => "text/plain; charset=utf-8" }, ["host-error=#{error.message}"]]
      end
    when "/durable-object/missing"
      value = Cloudflare::DurableObject.from_env(env, "OBJECTS").get("missing")
      [200, { "content-type" => "text/plain" }, [value.nil? ? "missing" : "present"]]
    when "/durable-object/pojo"
      store = env["cloudflare.env"].OBJECTS
      value = Cloudflare::DurableObject::POJO.new
      value["name"] = "Alice"
      store.put("pojo", value)
      loaded = store.get("pojo")
      [200, { "content-type" => "text/plain" }, [[loaded.class, loaded["name"]].inspect]]
    when "/durable-object/hash"
      store = env["cloudflare.env"].OBJECTS
      store.put("hash", { "items" => [{ "id" => 1 }] })
      loaded = store.get("hash")
      [200, { "content-type" => "text/plain" }, [[loaded.class, loaded["items"][0].class].inspect]]
    when "/durable-object/array"
      store = env["cloudflare.env"].OBJECTS
      store.put("array", [{ "id" => 1 }])
      loaded = store.get("array")
      [200, { "content-type" => "text/plain" }, [[loaded.class, loaded[0].class].inspect]]
    when "/durable-object/to-pojo"
      store = env["cloudflare.env"].OBJECTS
      store.put("convertible", DurablePojoSource.new)
      loaded = store.get("convertible")
      [200, { "content-type" => "text/plain" }, [[loaded["source"], loaded["nested"][0].class].inspect]]
    when "/durable-object/invalid"
      begin
        env["cloudflare.env"].OBJECTS.put("invalid", Object.new)
      rescue ArgumentError => error
        [200, { "content-type" => "text/plain" }, ["argument-error=#{error.message}"]]
      end
    when "/durable-object/invalid-conversion"
      begin
        env["cloudflare.env"].OBJECTS.put("invalid-conversion", InvalidDurablePojoSource.new)
      rescue ArgumentError => error
        [200, { "content-type" => "text/plain" }, ["argument-error=#{error.message}"]]
      end
    when "/durable-object/invalid-nested"
      begin
        env["cloudflare.env"].OBJECTS.put("invalid-nested", { "value" => Object.new })
      rescue ArgumentError => error
        [200, { "content-type" => "text/plain" }, ["argument-error=#{error.message}"]]
      end
    when "/durable-object/circular"
      begin
        value = []
        value << value
        env["cloudflare.env"].OBJECTS.put("circular", value)
      rescue ArgumentError => error
        [200, { "content-type" => "text/plain" }, ["argument-error=#{error.message}"]]
      end
    when "/d1/run"
      result = env["cloudflare.env"].DB.prepare("SELECT ?1 AS id, ?2 AS name").bind(7, "Alice").run
      row = result.rows[0]
      [200, { "content-type" => "text/plain" }, [[
        result.class, result.success?, row.class, row[:id], row["name"],
        result.changes, result.last_row_id, result.duration,
        result.rows_read, result.rows_written, result.changed_db?,
      ].inspect]]
    when "/d1/query"
      rows = Cloudflare::D1.from_env(env, "DB")
        .query("SELECT ?1 AS id, ?2 AS name", 8, "Bob")
        .rows
      [200, { "content-type" => "text/plain" }, [[rows[0][:id], rows[0][:name]].inspect]]
    when "/d1/first"
      statement = env["cloudflare.env"].DB.prepare("SELECT ?1 AS id, ?2 AS name")
      first = statement.bind(9, "Carol").first
      name = statement.bind(10, "Dave").first(:name)
      [200, { "content-type" => "text/plain" }, [[first[:id], first[:name], name, statement.params].inspect]]
    when "/d1/raw"
      rows = env["cloudflare.env"].DB
        .query("SELECT ?1 AS id, ?2 AS name", 11, "Eve")
        .raw(column_names: true)
      [200, { "content-type" => "text/plain" }, [rows.inspect]]
    when "/d1/batch"
      db = env["cloudflare.env"].DB
      results = db.batch([
        db.query("INSERT INTO users (name) VALUES (?1)", "Alice"),
        db.query("INSERT INTO users (name) VALUES (?1)", "Bob"),
      ])
      [200, { "content-type" => "text/plain" }, [[
        results.map { |result| result.class },
        results.map { |result| result.changes },
        results.map { |result| result.last_row_id },
      ].inspect]]
    when "/d1/invalid-param"
      errors = [Object.new, 9_007_199_254_740_992, 1.0 / 0.0].map do |value|
        begin
          env["cloudflare.env"].DB.query("SELECT ?1", value)
          "missing"
        rescue ArgumentError => error
          error.class
        end
      end
      [200, { "content-type" => "text/plain" }, [errors.inspect]]
    when "/d1/empty-batch"
      begin
        env["cloudflare.env"].DB.batch([])
      rescue ArgumentError => error
        [200, { "content-type" => "text/plain" }, ["argument-error=#{error.message}"]]
      end
    when "/d1/immutable"
      sql = "SELECT ?1 AS id, ?2 AS name"
      name = "Frank"
      statement = env["cloudflare.env"].DB.prepare(sql).bind(12, name)
      sql.replace("SELECT 0")
      name.replace("Changed")
      row = statement.first
      [200, { "content-type" => "text/plain" }, [[
        row[:id], row[:name], statement.sql.frozen?, statement.params.frozen?,
        statement.params[1].frozen?,
      ].inspect]]
    when "/d1/from-env-alias"
      direct = env["cloudflare.env"].DB
      explicit = Cloudflare::D1.from_env(env, "DB")
      [200, { "content-type" => "text/plain" }, [direct.equal?(explicit) ? "same" : "different"]]
    when "/ai/run"
      result = env["cloudflare.env"].AI.run(
        "@cf/test/model", { "prompt" => "Hello", "temperature" => 0.25 }
      )
      [200, { "content-type" => "text/plain" }, [[
        result["response"], result["usage"]["total_tokens"],
      ].inspect]]
    when "/ai/from-env-alias"
      direct = env["cloudflare.env"].AI
      explicit = Cloudflare::AI.from_env(env, "AI")
      [200, { "content-type" => "text/plain" }, [direct.equal?(explicit) ? "same" : "different"]]
    when "/ai/stream"
      begin
        env["cloudflare.env"].AI.run("@cf/test/model", { "stream" => true })
      rescue ArgumentError => error
        [200, { "content-type" => "text/plain" }, ["argument-error=#{error.message}"]]
      end
    when "/vectorize/query"
      result = env["cloudflare.env"].VECTOR_INDEX.query(
        [0.1, 0.2, 0.3], top_k: 2, return_values: true,
        return_metadata: :all, namespace: "docs", filter: { "kind" => "post" }
      )
      match = result["matches"][0]
      [200, { "content-type" => "text/plain" }, [[
        result["count"], match["id"], match["score"], match["metadata"]["kind"],
      ].inspect]]
    when "/vectorize/query-by-id"
      result = env["cloudflare.env"].VECTOR_INDEX.query_by_id("seed", top_k: 1)
      [200, { "content-type" => "text/plain" }, [[result["matches"][0]["id"]].inspect]]
    when "/vectorize/mutations"
      index = env["cloudflare.env"].VECTOR_INDEX
      vector = { "id" => "one", "values" => [0.1, 0.2], "metadata" => { "kind" => "post" } }
      results = [
        index.insert([vector]), index.upsert([vector]),
        index.get_by_ids(["one"]), index.delete_by_ids(["one"]), index.describe,
      ]
      [200, { "content-type" => "text/plain" }, [[
        results[0]["count"], results[1]["count"], results[2][0]["id"],
        results[3]["count"], results[4]["dimensions"],
      ].inspect]]
    when "/vectorize/from-env-alias"
      direct = env["cloudflare.env"].VECTOR_INDEX
      explicit = Cloudflare::Vectorize.from_env(env, "VECTOR_INDEX")
      [200, { "content-type" => "text/plain" }, [direct.equal?(explicit) ? "same" : "different"]]
    when "/vectorize/invalid-top-k"
      begin
        env["cloudflare.env"].VECTOR_INDEX.query([0.1], top_k: 51, return_values: true)
      rescue ArgumentError => error
        [200, { "content-type" => "text/plain" }, ["argument-error=#{error.message}"]]
      end
    when "/binding/type-error"
      begin
        Cloudflare::KV.from_env(env, "QUEUE_FOO")
      rescue Cloudflare::BindingError => error
        [200, { "content-type" => "text/plain; charset=utf-8" }, ["binding-error=#{error.message}"]]
      end
    when "/binding/unsupported-resource"
      begin
        Cloudflare::KV.from_env(env, "BUCKET")
      rescue Cloudflare::BindingError => error
        [200, { "content-type" => "text/plain" }, ["binding-error=#{error.message}"]]
      end
    when "/binding/misconfigured-kv"
      begin
        Cloudflare::KV.from_env(env, "BROKEN_KV").get("key")
      rescue Cloudflare::BindingError => error
        [200, { "content-type" => "text/plain" }, ["binding-error=#{error.message}"]]
      end
    when "/binding/mutable-name"
      name = "SECOND_KV"
      binding = Cloudflare::KV.from_env(env, name)
      name.replace("KV_BINDING")
      same_binding = binding.equal?(Cloudflare::KV.from_env(env, "SECOND_KV"))
      binding.put("stable-binding", "stable-value")
      [200, { "content-type" => "text/plain" }, [
        [binding.binding_name, binding.binding_name.frozen?, same_binding].inspect,
      ]]
    when "/binding/introspection"
      cloudflare = env["cloudflare.env"]
      missing_error = begin
        cloudflare.fetch("MISSING_BINDING")
      rescue KeyError => error
        error.class
      end
      [200, { "content-type" => "text/plain" }, [[
        cloudflare.respond_to?(:SECOND_KV), cloudflare.respond_to?(:MISSING_BINDING),
        cloudflare["SECOND_KV"].class, cloudflare["MISSING_BINDING"],
        cloudflare.fetch("TEXT_VALUE"), cloudflare.fetch("MISSING_BINDING", "default"),
        cloudflare.fetch("MISSING_BINDING") { |name| "block:#{name}" }, missing_error,
        cloudflare.class, cloudflare["class"],
      ].inspect]]
    when "/binding/missing"
      begin
        env["cloudflare.env"].MISSING_BINDING
      rescue NoMethodError => error
        [200, { "content-type" => "text/plain; charset=utf-8" }, ["missing=#{error.class}"]]
      end
    when "/binding/missing-from-env"
      begin
        Cloudflare::KV.from_env(env, "MISSING_KV")
      rescue Cloudflare::BindingError => error
        [200, { "content-type" => "text/plain" }, ["binding-error=#{error.message}"]]
      end
    when "/kv/protocol-error"
      begin
        Cloudflare::KV.from_env(env, "SECOND_KV").get("key")
      rescue Cloudflare::ProtocolError => error
        [200, { "content-type" => "text/plain" }, ["protocol-error=#{error.message}"]]
      end
    when "/errors/hierarchy"
      hierarchy = [
        Cloudflare::BindingError < Cloudflare::Error,
        Cloudflare::HostError < Cloudflare::Error,
        Cloudflare::ProtocolError < Cloudflare::Error,
        Cloudflare::Error < StandardError,
      ]
      [200, { "content-type" => "text/plain" }, [hierarchy.inspect]]
    when "/kv/formal-api"
      cache = Cloudflare::KV.from_env(env, "SECOND_KV")
      direct_new_error = begin
        Cloudflare::KV.new("SECOND_KV")
      rescue NoMethodError => error
        error.class
      end
      [200, { "content-type" => "text/plain" }, [[
        cache.respond_to?(:get), cache.respond_to?(:put), cache.respond_to?(:set),
        Cloudflare::KV.respond_to?(:get), Cloudflare.respond_to?(:kv_get), direct_new_error,
      ].inspect]]
    when "/dispatch/serialized"
      key = env["QUERY_STRING"]
      value = Cloudflare::KV.from_env(env, "SECOND_KV").get(key)
      [200, { "content-type" => "text/plain" }, [value]]
    else
      [404, { "content-type" => "text/plain; charset=utf-8" }, ["Not found"]]
    end
  end
end

Rackup::Handler::CloudflareWorker.run(BindingsApp)
