app = lambda { |env| [200, { 'content-type' => 'text/plain' }, ["Hello World\n"]] }

Rackup::Handler::CloudflareWorker.run(app)
