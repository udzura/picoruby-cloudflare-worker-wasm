class InputStreamApp
  def self.call(env)
    input = env["rack.input"]
    body = case env["PATH_INFO"]
    when "/gets"
      lines = []
      while (line = input.gets)
        lines << line
      end
      lines.join("|")
    when "/each"
      lines = []
      input.each { |line| lines << line }
      lines.join("|")
    when "/gets_all"
      input.gets(nil)
    when "/rewind"
      prefix = input.read(2)
      input.rewind
      "#{prefix}|#{input.read}"
    else
      input.read
    end
    alias_matches = input.equal?(env["cloudflare.input"])
    [200, { "content-type" => "application/octet-stream", "x-input-alias" => alias_matches.to_s }, [body]]
  end
end

Rackup::Handler::CloudflareWorker.run(InputStreamApp)
