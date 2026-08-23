module PicoRubyWorker
  def self.fetch(method, url)
    scheme_end = url.index("://")
    path_start = scheme_end ? url.index("/", scheme_end + 3) : 0
    path = path_start ? url[path_start, url.length - path_start] : "/"
    query_start = path.index("?")
    path = path[0, query_start] if query_start

    case path
    when "/ruby_version"
      "PicoRuby #{VERSION} | #{RUBY_ENGINE} #{RUBY_ENGINE_VERSION} (Ruby #{RUBY_VERSION})"
    when "/factorial"
      factorial = 1
      number = 2
      while number <= 6
        factorial *= number
        number += 1
      end
      "factorial(6) = #{factorial}"
    when "/hello"
      "#{method} #{url}"
    else
      "Try /ruby_version, /factorial, or /hello"
    end
  end
end
