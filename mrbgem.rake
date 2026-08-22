require "json"

MRuby::Gem::Specification.new("picoruby-worker-wasm") do |spec|
  spec.license = "MIT"
  spec.author = "PicoRuby contributors and picoruby-cloudflare-worker-wasm contributors"
  spec.summary = "Minimal PicoRuby runtime for Cloudflare Workers"

  spec.add_conflict "picoruby-mrubyc"
  spec.add_conflict "picoruby-wasm"

  bin_dir = File.join(build.build_dir, "bin")
  output_js = File.join(bin_dir, "picoruby-worker.js")
  exported_functions = %w[
    _picorb_worker_init
    _picorb_worker_dispatch
    _picorb_worker_result_ptr
    _picorb_worker_result_len
    _picorb_worker_error_ptr
    _picorb_worker_error_len
    _malloc
    _free
  ]

  directory bin_dir

  file output_js => [File.join(build.build_dir, "lib", "libmruby.a"), bin_dir] do |task|
    sh <<~CMD
      emcc -Oz \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_ES6=1 \
        -s ENVIRONMENT=worker \
        -s FILESYSTEM=0 \
        -s DYNAMIC_EXECUTION=0 \
        -s ERROR_ON_UNDEFINED_SYMBOLS=1 \
        -s NO_EXIT_RUNTIME=1 \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=16MB \
        -s MAXIMUM_MEMORY=64MB \
        -s STACK_SIZE=1MB \
        -s INCOMING_MODULE_JS_API='["instantiateWasm","print","printErr"]' \
        -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
        -s EXPORTED_FUNCTIONS='#{JSON.generate(exported_functions)}' \
        --no-entry \
        --compress-debug-sections \
        #{task.prerequisites.first} \
        -o #{task.name}
    CMD
  end

  build.bins << "picoruby-worker.js"
end
