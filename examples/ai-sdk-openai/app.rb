class Application
  def self.call(env)
    ai = env["ai-sdk.openai"]
    headers = { "content-type" => "text/plain; charset=utf-8" }
    case env["PATH_INFO"]
    when "/generate"
      result = ai.generate(ENV["OPENAI_TEXT_MODEL"], { "prompt" => "Say hello from Ruby.", "max_retries" => 0 })
      [200, headers, [result.text]]
    when "/stream"
      env["cloudflare.hijack"] = ai.stream(ENV["OPENAI_TEXT_MODEL"], { "prompt" => "Tell a short story.", "max_retries" => 0 })
      [200, headers, []]
    when "/embed"
      result = ai.embed(ENV["OPENAI_EMBEDDING_MODEL"], { "values" => ["Ruby", "WebAssembly"] })
      [200, { "content-type" => "application/json" }, [JSON.generate(result.raw)]]
    else
      [404, headers, ["Not found"]]
    end
  end
end

Rackup::Handler::CloudflareWorker.build {
  use AISDK::OpenAI::Middleware
  run Application
}
