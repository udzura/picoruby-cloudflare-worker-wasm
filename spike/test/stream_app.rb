class StreamApp < Sinatra::Base
  get "/stream" do
    content_type "text/event-stream"
    headers "content-length" => "999"
    env["cloudflare.env"].AI.generate("@cf/test/model", { stream: true })
  end

  get "/unused" do
    env["cloudflare.env"].AI.run("@cf/test/model", { stream: true })
    "unused"
  end

  get "/invalid" do
    body = env["cloudflare.env"].AI.run("@cf/test/model", { stream: true })
    [200, { "invalid\nheader" => "value" }, body]
  end
end
Rackup::Handler::CloudflareWorker.run(StreamApp)
