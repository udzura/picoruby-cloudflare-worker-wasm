class AIProxyStreamApp
  MODEL = "@cf/zai-org/glm-4.7-flash"

  def self.call(env)
    return [404, { "content-type" => "text/plain" }, ["Not found"]] unless env["PATH_INFO"] == "/api/chat"
    return [405, { "allow" => "POST" }, []] unless env["REQUEST_METHOD"] == "POST"

    prompt = env["rack.input"].read
    return [400, { "content-type" => "text/plain" }, ["A prompt is required"]] if prompt.empty?
    return [413, { "content-type" => "text/plain" }, ["Prompt is too long"]] if prompt.bytesize > 16_384

    stream = Cloudflare::CustomReadableStream.new do |writer|
      source = env["cloudflare.env"].AI.run(
        MODEL,
        { "messages" => [{ "role" => "user", "content" => prompt }], "stream" => true, "max_completion_tokens" => 128 }
      )
      pending = ""
      while (chunk = source.read_partial(16_384))
        pending << chunk
        while (newline = pending.index("\n"))
          p "[!!] get new line: #{pending.byteslice(0, newline + 1)}"
          pending = pending.byteslice(newline + 1, pending.bytesize - newline - 1)
        end
        writer.write(chunk)
      end
      writer.close
    end
    stream.on_error { |error| "event: error\ndata: #{error.class}: #{error.message}\n\n" }
    env["cloudflare.hijack"] = stream.finish
    [200, { "content-type" => "text/event-stream", "cache-control" => "no-cache", "x-accel-buffering" => "no" }, []]
  end
end

Rackup::Handler::CloudflareWorker.run(AIProxyStreamApp)
