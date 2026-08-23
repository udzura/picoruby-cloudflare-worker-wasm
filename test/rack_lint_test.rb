require "rack/lint"
require_relative "../mrblib/worker"

def assert_equal(expected, actual, message)
  return if expected == actual

  raise "assertion failed: #{message}\nexpected: #{expected.inspect}\n  actual: #{actual.inspect}"
end

def encode_u32(value)
  [value].pack("V")
end

def encode_string(value)
  string = value.b
  encode_u32(string.bytesize) + string
end

def request_frame
  fields = ["POST", "https", "example.com", "443", "example.com", "/lint", "name=pico", "HTTP/2"]
  frame = "PRQ1".b
  fields.each { |field| frame << encode_string(field) }
  frame << encode_u32(2)
  frame << encode_string("content-type") << encode_string("application/octet-stream")
  frame << encode_string("content-length") << encode_string("4")
  frame << encode_string("lint".b)
  frame
end

finished = nil
app = lambda do |env|
  env["rack.response_finished"] << lambda do |_finished_env, status, _headers, error|
    finished = [status, error]
  end
  body = env["rack.input"].read
  [200, { "content-type" => "application/octet-stream", "content-length" => body.bytesize.to_s }, [body]]
end

Rackup::Handler::CloudflareWorker.run(Rack::Lint.new(app))
status, headers, body = PicoRubyWorker::RackAdapter.dispatch(request_frame)

assert_equal(200, status, "Rack::Lint accepts the response status")
assert_equal(
  ["content-type", "application/octet-stream", "content-length", "4"],
  headers,
  "Rack::Lint accepts the response headers",
)
assert_equal("lint", body, "Rack::Lint accepts the request and response bodies")
assert_equal([200, nil], finished, "Rack::Lint accepts response-finished arguments")

puts "Rack::Lint integration test passed"
