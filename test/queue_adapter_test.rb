require "rack"
require "json"
require_relative "../mrblib/worker"

def assert_equal(expected, actual, message)
  raise "assertion failed: #{message}\nexpected: #{expected.inspect}\n  actual: #{actual.inspect}" unless expected == actual
end

def assert(condition, message)
  raise "assertion failed: #{message}" unless condition
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
  value = value.b
  encode_u32(value.bytesize) + value
end

def queue_frame(messages)
  frame = "PCQ1".b + encode_string("events") + encode_u32(messages.size)
  messages.each do |id, timestamp, body, attempts|
    frame << encode_string(id) << encode_string(timestamp.to_s) << encode_string(body) << encode_u32(attempts)
  end
  frame
end

class QueueMiddleware
  def initialize(app)
    @app = app
  end

  def call(env)
    env["cloudflare.batch"].messages[0].ack
    @app.call(env)
  end
end

class TestQueueConsumer < Cloudflare::QueueConsumer::Base
  @instances = []

  class << self
    attr_reader :instances
  end

  def call(env)
    self.class.instances << object_id
    raise "missing Cloudflare bindings" unless env["cloudflare.env"].is_a?(Cloudflare::Environment)
    raise "missing Queue batch" unless env["cloudflare.batch"].equal?(current_batch)

    assert_equal("events", current_batch.queue, "Queue name is decoded")
    assert_equal("first", current_batch.messages[0].body, "Queue message body is decoded")
    return if current_batch.messages.size == 1

    assert_equal(2, current_batch.messages[1].attempts, "Queue message attempts are decoded")
    current_batch.messages[1].retry(delay_seconds: 15)
    current_batch.retry_all(delay_seconds: 30)
    [:info, { "queue" => current_batch.queue, "count" => current_batch.messages.size }, "Queue batch processed"]
  end
end

Cloudflare::Queues.run(TestQueueConsumer) do
  use QueueMiddleware
end

actions = PicoRubyWorker::QueueAdapter.dispatch(queue_frame([
  ["first-id", 1_700_000_000_000, "first", 1],
  ["second-id", 1_700_000_000_001, "second", 2],
]))
assert_equal([2, 30], actions[0], "Batch retry action is recorded")
assert_equal([[1, 0], [2, 15]], actions[1], "Message actions take precedence over the batch action")
assert_equal(["info", '{"queue":"events","count":2}', "Queue batch processed"], actions[2], "Consumer return value becomes a log record")

PicoRubyWorker::QueueAdapter.dispatch(queue_frame([["third-id", 1_700_000_000_002, "first", 1]]))
assert_equal(2, TestQueueConsumer.instances.size, "Base creates one consumer instance per Queue dispatch")
assert(TestQueueConsumer.instances[0] != TestQueueConsumer.instances[1], "Queue consumer instances do not share dispatch state")

callable_env = nil
Cloudflare::Queues.run(lambda do |env|
  callable_env = env
  env["cloudflare.batch"].ack_all
end)
callable_actions = PicoRubyWorker::QueueAdapter.dispatch(queue_frame([["callable-id", 1_700_000_000_003, "body", 1]]))
assert_equal([1, 0], callable_actions[0], "Arbitrary callables receive the Queue env")
assert(callable_env["cloudflare.env"].is_a?(Cloudflare::Environment), "Queue env contains Cloudflare bindings")
assert_equal(nil, callable_actions[2], "Nonconforming consumer return values do not emit logs")

assert_equal(nil, Cloudflare::Queues.__log_record([:notice, {}, "ignored"]), "Unsupported log levels are ignored")
assert_equal(nil, Cloudflare::Queues.__log_record([:info, [], "ignored"]), "Non-Hash log metadata is ignored")

assert_raises(ArgumentError, "Retry delay must be positive") do
  Cloudflare::Queues::Message.new("id", 0, "body", 1).retry(delay_seconds: 0)
end

assert_raises(PicoRubyWorker::RackError, "Invalid Queue frame is rejected") do
  PicoRubyWorker::QueueAdapter.dispatch("PCQ1".b)
end

puts "Queue adapter tests passed"
