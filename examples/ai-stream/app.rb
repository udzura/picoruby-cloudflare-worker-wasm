class AIStreamApp < Sinatra::Base
  set :raise_errors, true
  set :show_exceptions, false

  helpers do
    def cloudflare_hijack(descriptor)
      content_type "text/event-stream"
      headers "cache-control" => "no-cache"
      env["cloudflare.hijack"] = descriptor
      body []
    end
  end

  post "/api/chat" do
    prompt = request.body.read
    error 400, "A prompt is required" if prompt.empty?
    error 413, "Prompt is too long" if prompt.bytesize > 16_384

    model = "@cf/zai-org/glm-4.7-flash"
    # model = "@cf/meta/llama-3.1-8b-instruct-fp8-fast"

    descriptor = env["cloudflare.env"].AI.run(
      model,
      { "messages" => [{ "role" => "user", "content" => prompt }],
        "stream" => true }
    )
    cloudflare_hijack(descriptor)
  end
end

Rackup::Handler::CloudflareWorker.run(AIStreamApp)
