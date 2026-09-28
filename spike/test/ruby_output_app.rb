class RubyOutputApp
  def self.call(env)
    stream = Cloudflare::CustomReadableStream.new do |writer|
      writer.write("first\n")
      raise "sample failure" if env["PATH_INFO"] == "/error"
      writer.write("second\n")
    end
    env["cloudflare.hijack"] = stream.finish
    [200, { "content-type" => "text/plain" }, []]
  end
end

Rackup::Handler::CloudflareWorker.run(RubyOutputApp)
