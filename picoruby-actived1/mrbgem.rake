MRuby::Gem::Specification.new("picoruby-actived1") do |spec|
  spec.license = "MIT"
  spec.author = "picoruby-cloudflare-worker-wasm contributors"
  spec.summary = "PicoRuby ORM for Cloudflare D1"
  spec.test_rbfiles = [] # test/unit exercises the CRuby generator and emitted schema on the host.
  spec.add_dependency "mruby-regexp"
  spec.add_dependency "picoruby-worker-wasm"
end
