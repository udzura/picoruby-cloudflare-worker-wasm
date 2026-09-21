class InputStreamApp
  def self.call(env)
    body = env["rack.input"].read
    alias_matches = env["rack.input"].equal?(env["cloudflare.input"])
    [200, { "content-type" => "application/octet-stream", "x-input-alias" => alias_matches.to_s }, [body]]
  end
end

Rackup::Handler::CloudflareWorker.run(InputStreamApp)
