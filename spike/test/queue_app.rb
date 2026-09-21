class QueueTestMiddleware
  def initialize(app)
    @app = app
  end

  def call(env)
    raise "Queue middleware did not receive Cloudflare bindings" unless env["cloudflare.env"].is_a?(Cloudflare::Environment)

    env["cloudflare.batch"].messages.each do |message|
      message.ack if message.body == "middleware"
    end
    @app.call(env)
  end
end

class QueueTestConsumer < Cloudflare::QueueConsumer::Base
  def call(env)
    raise "Queue consumer did not receive its current batch" unless env["cloudflare.batch"].equal?(current_batch)
    raise "Queue consumer did not receive its bindings" unless env["cloudflare.env"].equal?(bindings)
    raise "Queue consumer failure" if current_batch.messages.any? { |message| message.body == "raise" }

    current_batch.messages.each do |message|
      case message.body
      when "ack"
        message.ack
      when "retry"
        message.retry(delay_seconds: 12)
      when "ack-all"
        current_batch.ack_all
      when "retry-all"
        current_batch.retry_all(delay_seconds: 30)
      when "r2-read-all"
        object = bindings.BUCKET.get("queue.txt")
        raise "Queue R2 object is missing" unless object
        raise "Queue R2 body did not match" unless object.body.read_all == "queue body"
        message.ack
      when "r2-read-partial"
        object = bindings.BUCKET.get("queue.txt")
        raise "Queue R2 object is missing" unless object
        stream = object.body
        raise "Queue R2 partial body did not match" unless stream.read_partial(3) == "que"
        raise "Queue R2 remaining body did not match" unless stream.read_all(max_bytes: 7) == "ue body"
        raise "Queue R2 stream did not reach EOF" unless stream.read_partial(1).nil?
        message.ack
      when "r2-read-too-large"
        object = bindings.BUCKET.get("queue.txt")
        raise "Queue R2 object is missing" unless object
        begin
          object.body.read_all(max_bytes: 3)
        rescue ArgumentError
          message.ack
        else
          raise "Queue R2 body exceeded max_bytes without an error"
        end
      end
    end
    [:info, { "queue" => current_batch.queue, "count" => current_batch.messages.size }, "Queue batch processed"]
  end
end

Cloudflare::Queues.run(QueueTestConsumer) do
  use QueueTestMiddleware
end
