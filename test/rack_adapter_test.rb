require_relative "../mrblib/worker"

def assert(condition, message)
  raise "assertion failed: #{message}" unless condition
end

def assert_equal(expected, actual, message)
  raise "assertion failed: #{message}\nexpected: #{expected.inspect}\n  actual: #{actual.inspect}" unless expected == actual
end

def assert_raises(error_class, message)
  begin
    yield
  rescue error_class
    return
  end
  raise "assertion failed: #{message}"
end

def encode_u32(value)
  [value].pack("V")
end

def encode_string(value)
  string = value.b
  encode_u32(string.bytesize) + string
end

def request_frame(method: "GET", path: "/", query: "", headers: [], body: "")
  fields = [method, "https", "example.com", "443", "example.com", path, query, "HTTP/2"]
  frame = "PRQ1".b
  fields.each { |field| frame << encode_string(field) }
  frame << encode_u32(headers.size)
  headers.each do |name, value|
    frame << encode_string(name)
    frame << encode_string(value)
  end
  frame << encode_string(body)
  frame
end

class TestBody
  attr_reader :closed, :iterated

  def initialize(parts)
    @parts = parts
    @closed = false
    @iterated = false
  end

  def each
    @iterated = true
    @parts.each { |part| yield part }
  end

  def close
    @closed = true
  end
end

input = PicoRubyWorker::RackInput.new("first\nsecond")
assert_equal("fir", input.read(3), "rack.input reads a bounded chunk")
buffer = "old"
assert_equal(buffer, input.read(2, buffer), "rack.input returns the supplied buffer")
assert_equal("\n", input.gets, "rack.input gets reads through newline")
assert_equal("second", input.read, "rack.input reads remaining bytes")
assert_equal("", input.read, "rack.input returns an empty string after unbounded EOF")
assert_equal(nil, input.read(1), "rack.input returns nil after bounded EOF")
assert_equal(0, input.rewind, "rack.input rewinds")
assert_equal("first\n", input.gets, "rack.input gets after rewind")
input.close
assert(input.closed?, "rack.input closes")

captured_env = nil
finished = nil
response_body_source = TestBody.new([])
app = lambda do |env|
  captured_env = env
  env["rack.response_finished"] << lambda do |_finished_env, status, _headers, error|
    finished = [status, error]
  end
  request_body = env["rack.input"].read
  response_body_source = TestBody.new([request_body, "prefix:", "\0suffix".b])
  [
    201,
    {
      "content-type" => "application/octet-stream",
      "set-cookie" => ["first=1", "second=2"],
      "rack.internal" => "ignored",
    },
    response_body_source,
  ]
end
Rackup::Handler::CloudflareWorker.run(app)

frame = request_frame(
  method: "POST",
  path: "/echo%20path",
  query: "name=pico",
  headers: [
    ["host", "request.example.com"],
    ["content-type", "application/octet-stream"],
    ["x-test-header", "yes"],
  ],
  body: "\x00\xff".b,
)
status, headers, response_body = PicoRubyWorker::RackAdapter.dispatch(frame)
assert_equal(201, status, "Rack status is preserved")
assert_equal(
  ["content-type", "application/octet-stream", "set-cookie", "first=1", "set-cookie", "second=2"],
  headers,
  "Rack headers are flattened and rack.* headers are removed",
)
assert_equal("\x00\xffprefix:\0suffix".b, response_body, "binary request and response bodies are preserved")
assert_equal("POST", captured_env["REQUEST_METHOD"], "request method is mapped")
assert_equal("/echo%20path", captured_env["PATH_INFO"], "path is mapped")
assert_equal("name=pico", captured_env["QUERY_STRING"], "query is mapped")
assert_equal("application/octet-stream", captured_env["CONTENT_TYPE"], "content type uses its CGI key")
assert_equal("request.example.com", captured_env["HTTP_HOST"], "Host header replaces the URL-derived authority")
assert_equal("yes", captured_env["HTTP_X_TEST_HEADER"], "headers use HTTP_ CGI keys")
assert_equal("HTTP/2", captured_env["SERVER_PROTOCOL"], "HTTP protocol is mapped")
assert_equal([201, nil], finished, "response-finished callback runs")
assert(response_body_source.closed, "enumerable response body is closed")

head_body = TestBody.new(["must not be consumed"])
Rackup::Handler::CloudflareWorker.run(lambda { |_env| [200, { "content-type" => "text/plain" }, head_body] })
_status, _headers, head_content = PicoRubyWorker::RackAdapter.dispatch(request_frame(method: "HEAD"))
assert_equal("", head_content, "HEAD response body is empty")
assert(!head_body.iterated, "HEAD response body is not consumed")
assert(head_body.closed, "HEAD response body is closed")

invalid_body = TestBody.new(["invalid"])
Rackup::Handler::CloudflareWorker.run(lambda { |_env| [200, { "Content-Type" => "text/plain" }, invalid_body] })
assert_raises(PicoRubyWorker::RackError, "uppercase response header is rejected") do
  PicoRubyWorker::RackAdapter.dispatch(request_frame)
end
assert(invalid_body.closed, "invalid response body is closed")

Rackup::Handler::CloudflareWorker.run(lambda { |_env| [200, { "status" => "ignored" }, []] })
assert_raises(PicoRubyWorker::RackError, "status response header is rejected") do
  PicoRubyWorker::RackAdapter.dispatch(request_frame)
end

puts "Rack adapter tests passed"
