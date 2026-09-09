require "json"

# Rack is optional for the runtime; this stub isolates middleware behavior.
module Rack
  class Request
    def initialize(env)
      @env = env
    end
    def cookies
      { "CF_Authorization" => @env["test.token"] }
    end
  end
end
module Cloudflare
  class HostError < StandardError; end
  class ProtocolError < StandardError; end
end
require_relative "../mrblib/worker"

def assert(condition)
  raise "assertion failed" unless condition
end

module Cloudflare
  class << self
    attr_accessor :test_status, :test_body, :test_requests
    def fetch(url, **options)
      self.test_requests << [url, options]
      raise HostError, "offline" if test_status == :offline
      FetchResponse.new("status" => test_status, "headers" => {}, "body" => test_body)
    end
  end
end
Cloudflare.test_status = 200
Cloudflare.test_body = '{"email":"alice@example.test","user_uuid":"alice","groups":["staff"]}'
Cloudflare.test_requests = []
assert(Rack::Cloudflare::Access.equal?(Cloudflare::Access))
calls = []
app = ->(env) { calls << env["cloudflare.identity"]; [200, {}, [env["cloudflare.identity"].email]] }
middleware = Rack::Cloudflare::Access.new(app, team: "my-team")
env = { "test.token" => "test.jwt.token", "cloudflare.identity" => "untrusted" }
assert(middleware.call(env) == [200, {}, ["alice@example.test"]])
assert(calls.first.user_uuid == "alice")
assert(calls.first.raw_data["groups"] == ["staff"])
assert(Cloudflare.test_requests.first[0] == "https://my-team.cloudflareaccess.com/cdn-cgi/access/get-identity")
assert(Cloudflare.test_requests.first[1][:headers]["Cookie"] == "CF_Authorization=test.jwt.token")
env.delete("test.token")
assert(middleware.call(env)[0] == 401)
assert(!env.key?("cloudflare.identity"))
env["test.token"] = "test.jwt.token"
Cloudflare.test_status = 403
assert(middleware.call(env)[0] == 401)
Cloudflare.test_status = :offline
assert(middleware.call(env)[0] == 502)
Cloudflare.test_status = 200
Cloudflare.test_body = "not JSON"
assert(middleware.call(env)[0] == 502)
assert(calls.size == 1)
assert(Cloudflare::Access.new(app, team: "").call(env)[0] == 503)
assert(Cloudflare::Access.new(app, team: "https://invalid.test").call(env)[0] == 503)
Cloudflare.test_body = '{"email":"bob@example.test"}'
assert(middleware.call(env)[2] == ["bob@example.test"])
assert(calls.first.email == "alice@example.test")
begin
  Cloudflare::Access.new(->(_) { raise "application error" }, team: "my-team").call(env)
  raise "application error swallowed"
rescue RuntimeError => error
  assert(error.message == "application error")
end
puts "Access middleware: identity, failures, request isolation and downstream errors passed"
