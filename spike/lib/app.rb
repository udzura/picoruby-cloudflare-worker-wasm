class App < Sinatra::Base
  before do
    headers "content-type" => "text/plain; charset=utf-8"
  end

  error do
    "handled by Sinatra error handler: #{env['sinatra.error'].class}"
  end

  get "/ruby_version" do
    "PicoRuby #{PicoRubyWorker::VERSION} | #{RUBY_ENGINE} #{RUBY_ENGINE_VERSION} (Ruby #{RUBY_VERSION})"
  end

  get "/factorial" do
    factorial = 1
    number = 2
    while number <= 6
      factorial *= number
      number += 1
    end
    "factorial(6) = #{factorial}"
  end

  get "/sinatra/:name" do
    "Hello, #{params[:name]} from Sinatra #{Sinatra::VERSION} on PicoRuby"
  end

  get "/hello" do
    url = "#{env["rack.url_scheme"]}://#{env["HTTP_HOST"]}#{env["REQUEST_PATH"]}"
    query = env["QUERY_STRING"]
    url = "#{url}?#{query}" unless query.empty?
    "#{env["REQUEST_METHOD"]} #{url}"
  end

  post "/echo" do
    request_body = env["rack.input"].read
    status 201
    headers(
      "content-type" => env["CONTENT_TYPE"] || "application/octet-stream",
      "x-request-method" => env["REQUEST_METHOD"],
      "x-query-string" => env["QUERY_STRING"],
      "set-cookie" => ["first=1; Path=/", "second=2; Path=/"],
    )
    request_body
  end

  post "/debug/request" do
    request_body = env["rack.input"].read
    keys = [
      "REQUEST_METHOD",
      "SCRIPT_NAME",
      "PATH_INFO",
      "REQUEST_PATH",
      "QUERY_STRING",
      "SERVER_NAME",
      "SERVER_PORT",
      "SERVER_PROTOCOL",
      "HTTP_HOST",
      "CONTENT_TYPE",
      "CONTENT_LENGTH",
      "rack.url_scheme",
    ]
    lines = []
    index = 0
    while index < keys.size
      key = keys[index]
      lines << "#{key}=#{env[key].inspect}"
      index += 1
    end

    env_keys = env.keys
    index = 0
    while index < env_keys.size
      key = env_keys[index]
      if key != "HTTP_HOST" && key.bytesize >= 5 && key.byteslice(0, 5) == "HTTP_"
        lines << "#{key}=#{env[key].inspect}"
      end
      index += 1
    end
    lines << "rack.input.bytesize=#{request_body.bytesize}"
    lines << "rack.input=#{request_body.inspect}"
    lines.join("\n") + "\n"
  end

  get "/debug/raise" do
    raise "Dummy Sinatra application error"
  end

  get "/debug/jspi" do
    first = PicoRubyWorker::JSPIProbe.add(20, 22)
    second = PicoRubyWorker::JSPIProbe.add(first, 8)
    "jspi_add=#{first},#{second}"
  end
end

Rackup::Handler::CloudflareWorker.run(App)
