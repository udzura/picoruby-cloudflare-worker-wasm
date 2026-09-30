class AIClassificationApp < Sinatra::Base
  set :raise_errors, true
  set :show_exceptions, false

  before do
    content_type "application/json"
    headers "cache-control" => "no-store"
  end

  post "/api/classify" do
    payload = json_body
    unless payload["text"].is_a?(String) && !payload["text"].strip.empty?
      halt 400, JSON.generate("error" => "text must be a non-empty String")
    end

    result = env["cloudflare.env"].AI.run(
      "@cf/huggingface/distilbert-sst-2-int8",
      { "text" => payload["text"] }
    )
    JSON.generate(result)
  end

  post "/api/select" do
    payload = json_body
    query = payload["query"]
    choices = payload["choices"]
    unless query.is_a?(String) && !query.strip.empty?
      halt 400, JSON.generate("error" => "query must be a non-empty String")
    end
    unless choices.is_a?(Array) && choices.length >= 2 && choices.length <= 20 &&
        choices.all? { |choice| choice.is_a?(String) && !choice.strip.empty? }
      halt 400, JSON.generate("error" => "choices must contain 2 to 20 non-empty Strings")
    end

    result = env["cloudflare.env"].AI.run(
      "@cf/baai/bge-reranker-base",
      { "query" => query, "contexts" => choices.map { |choice| { "text" => choice } },
        "top_k" => choices.length }
    )
    JSON.generate(result)
  end

  not_found do
    JSON.generate("error" => "Not found")
  end

  private

  def json_body
    raw = request.body.read
    halt 413, JSON.generate("error" => "Request is too long") if raw.bytesize > 16_384
    begin
      payload = JSON.parse(raw)
    rescue JSON::JSONError
      halt 400, JSON.generate("error" => "Request body must be valid JSON")
    end
    halt 400, JSON.generate("error" => "Request body must be a JSON object") unless payload.is_a?(Hash)
    payload
  end
end

Rackup::Handler::CloudflareWorker.run(AIClassificationApp)
