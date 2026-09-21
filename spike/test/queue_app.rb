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
      end
    end
    [:info, { "queue" => current_batch.queue, "count" => current_batch.messages.size }, "Queue batch processed"]
  end
end

Cloudflare::Queues.run(QueueTestConsumer) do
  use QueueTestMiddleware
end
