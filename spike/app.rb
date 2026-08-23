class App
  def self.call(env)
    case env["PATH_INFO"]
    when "/ruby_version"
      body = "PicoRuby #{PicoRubyWorker::VERSION} | #{RUBY_ENGINE} #{RUBY_ENGINE_VERSION} (Ruby #{RUBY_VERSION})"
      [200, { "content-type" => "text/plain; charset=utf-8" }, [body]]
    when "/factorial"
      factorial = 1
      number = 2
      while number <= 6
        factorial *= number
        number += 1
      end
      [200, { "content-type" => "text/plain; charset=utf-8" }, ["factorial(6) = #{factorial}"]]
    when "/hello"
      url = "#{env["rack.url_scheme"]}://#{env["HTTP_HOST"]}#{env["REQUEST_PATH"]}"
      query = env["QUERY_STRING"]
      url = "#{url}?#{query}" unless query.empty?
      [200, { "content-type" => "text/plain; charset=utf-8" }, ["#{env["REQUEST_METHOD"]} #{url}"]]
    when "/echo"
      body = env["rack.input"].read
      headers = {
        "content-type" => env["CONTENT_TYPE"] || "application/octet-stream",
        "x-request-method" => env["REQUEST_METHOD"],
        "x-query-string" => env["QUERY_STRING"],
        "set-cookie" => ["first=1; Path=/", "second=2; Path=/"],
      }
      [201, headers, [body]]
    when "/debug/request"
      body = env["rack.input"].read
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
      lines << "rack.input.bytesize=#{body.bytesize}"
      lines << "rack.input=#{body.inspect}"
      [200, { "content-type" => "text/plain; charset=utf-8" }, [lines.join("\n") + "\n"]]
    else
      [404, { "content-type" => "text/plain; charset=utf-8" }, ["Not found"]]
    end
  end
end

Rackup::Handler::CloudflareWorker.run(App)
