# The spike's released Worker pin predates the D1 bridge.
ENV["PICORUBY_WORKER_WASM_GEM_DIR"] ||= File.expand_path("../..", __dir__)
load File.expand_path("picoruby-worker-wasm.rb", __dir__)
MRuby.targets.fetch("picoruby-worker-wasm").gem gemdir: File.expand_path("../../picoruby-actived1", __dir__)
