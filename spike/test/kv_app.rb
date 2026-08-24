class KvApp
  def self.call(env)
    case env["PATH_INFO"]
    when "/kv/set"
      Cloudflare::KV.set("spike-key", "PicoRuby KV\x00value")
      [200, { "content-type" => "text/plain; charset=utf-8" }, ["kv_set"]]
    when "/kv/get"
      value = Cloudflare::KV.get("spike-key")
      [200, { "content-type" => "application/octet-stream" }, [value || "missing"]]
    else
      [404, { "content-type" => "text/plain; charset=utf-8" }, ["Not found"]]
    end
  end
end

Rackup::Handler::CloudflareWorker.run(KvApp)
