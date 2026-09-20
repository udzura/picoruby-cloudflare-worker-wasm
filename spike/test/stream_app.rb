class StreamApp
  def self.call(env)
    case env["PATH_INFO"]
    when "/stream"
      descriptor = env["cloudflare.env"].AI.generate("@cf/test/model", { stream: true })
      env["cloudflare.hijack"] = descriptor
      [200, { "content-type" => "text/event-stream", "content-length" => "999" }, []]
    when "/unused"
      descriptor = env["cloudflare.env"].AI.run("@cf/test/model", { stream: true })
      [200, { "content-type" => "text/plain" }, ["#{descriptor.class}:#{descriptor.id}"]]
    when "/overwrite"
      env["cloudflare.env"].AI.run("@cf/test/model", { stream: true })
      descriptor = env["cloudflare.env"].AI.run("@cf/test/model", { stream: true })
      env["cloudflare.hijack"] = descriptor
      [200, { "content-type" => "text/event-stream" }, []]
    when "/invalid"
      descriptor = env["cloudflare.env"].AI.run("@cf/test/model", { stream: true })
      env["cloudflare.hijack"] = descriptor
      [200, { "invalid\nheader" => "value" }, []]
    else
      [404, { "content-type" => "text/plain" }, ["not found"]]
    end
  end
end
Rackup::Handler::CloudflareWorker.run(StreamApp)
