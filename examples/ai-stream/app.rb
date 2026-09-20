class AIStreamApp < Sinatra::Base
  post "/api/chat" do
    content_type "text/event-stream"
    headers "cache-control" => "no-cache"
    prompt = request.body.read
    error 400, "A prompt is required" if prompt.empty?
    error 413, "Prompt is too long" if prompt.bytesize > 16_384

    env["cloudflare.env"].AI.run(
      "@cf/meta/llama-3.1-8b-instruct",
      { "messages" => [{ "role" => "user", "content" => prompt }], "stream" => true }
    )
  end
end

Rackup::Handler::CloudflareWorker.run(AIStreamApp)
