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
    when "/cloudflare/env"
      cloudflare = env["cloudflare.env"]
      [200, { "content-type" => "text/plain; charset=utf-8" }, [
        "#{cloudflare.TEXT_VALUE}|#{cloudflare.JSON_VALUE}|#{cloudflare.SECOND_KV.class}|#{cloudflare.QUEUE_FOO.class}",
      ]]
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
      rescue Cloudflare::HostError => error
        [200, { "content-type" => "text/plain" }, ["host-error=#{error.message}"]]
      end
    when "/kv/ttl"
      value = "\x00\xff"
      results = [
        env["cloudflare.env"].SECOND_KV.put("ttl-direct", value, ttl: 60),
        Cloudflare::KV.from_env(env, "SECOND_KV").set("ttl-from-env", value, ttl: 120),
        Cloudflare::KV.put("ttl-class-put", value, ttl: 180),
        Cloudflare::KV.set("ttl-class-set", value, ttl: 240),
        Cloudflare.kv_set("ttl-module-set", value, ttl: 300),
        env["cloudflare.env"].SECOND_KV.put("ttl-nil", value, ttl: nil),
      ]
      [200, { "content-type" => "text/plain" }, [results == [nil, nil, nil, nil, nil, nil] ? "ttl-set" : "unexpected-result"]]
    when "/kv/ttl/invalid"
      begin
        env["cloudflare.env"].SECOND_KV.put("ttl-invalid", "value", ttl: 59)
      rescue Cloudflare::HostError => error
        [200, { "content-type" => "text/plain" }, ["host-error=#{error.message}"]]
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
        Cloudflare::KV.new("MISSING_KV").get("key")
      rescue Cloudflare::HostError => error
        [200, { "content-type" => "text/plain; charset=utf-8" }, ["host-error=#{error.message}"]]
      end
    when "/kv/rejected"
      begin
        Cloudflare::KV.new("SECOND_KV").get("reject")
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
    when "/binding/type-error"
      begin
        Cloudflare::KV.from_env(env, "QUEUE_FOO")
      rescue ArgumentError => error
        [200, { "content-type" => "text/plain; charset=utf-8" }, ["argument-error=#{error.message}"]]
      end
    when "/binding/missing"
      begin
        env["cloudflare.env"].MISSING_BINDING
      rescue NoMethodError => error
        [200, { "content-type" => "text/plain; charset=utf-8" }, ["missing=#{error.class}"]]
      end
    else
      [404, { "content-type" => "text/plain; charset=utf-8" }, ["Not found"]]
    end
  end
end

Rackup::Handler::CloudflareWorker.run(BindingsApp)
