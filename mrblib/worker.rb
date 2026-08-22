module PicoRubyWorker
  DISPATCH = -> {
    PicoRubyWorker.fetch($picorb_worker_method, $picorb_worker_url)
  }
end
