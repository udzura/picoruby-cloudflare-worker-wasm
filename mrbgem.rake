require "json"

MRuby::Gem::Specification.new("picoruby-worker-wasm") do |spec|
  spec.license = "MIT"
  spec.author = "PicoRuby contributors and picoruby-cloudflare-worker-wasm contributors"
  spec.summary = "Minimal PicoRuby runtime for Cloudflare Workers"

  spec.add_conflict "picoruby-mrubyc"
  spec.add_conflict "picoruby-wasm"
  if ENV["PICORUBY_USE_PICORUBY_JSON"]
    spec.add_dependency "picoruby-json"
  elsif ENV["PICORUBY_USE_MRUBY_JSONRS"]
    spec.add_dependency "mruby-jsonrs", github: "udzura/mruby-jsonrs"
  end
  spec.add_dependency "mruby-pack"
  spec.add_dependency "mruby-time", gemdir: File.expand_path("vendor/mruby-time", __dir__)

  spec.build_settings do |gem|
    prism_include = File.join(
      File.dirname(gem.build.build_dir), "prism", "include"
    )

    gem.build.cc.include_paths << prism_include
    gem.build.gems.each do |dependency|
      dependency.cc.include_paths << prism_include
    end
  end

  bin_dir = File.join(build.build_dir, "bin")
  output_js = File.join(bin_dir, "picoruby-worker.js")
  exported_functions = %w[
    _picorb_worker_abi_version
    _picorb_worker_init
    _picorb_worker_close
    _picorb_worker_dispatch_v1
    _picorb_worker_response_ptr
    _picorb_worker_response_len
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
        -s SUPPORT_LONGJMP=wasm \
        -s WASM_LEGACY_EXCEPTIONS=0 \
        -s JSPI=1 \
        -s JSPI_EXPORTS='["picorb_worker_init","picorb_worker_dispatch_v1","picorb_worker_close"]' \
        -s NO_EXIT_RUNTIME=1 \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=16MB \
        -s MAXIMUM_MEMORY=64MB \
        -s STACK_SIZE=1MB \
        -s INCOMING_MODULE_JS_API='["instantiateWasm","print","printErr"]' \
        -s EXPORTED_RUNTIME_METHODS='["HEAPU8","ccall"]' \
        -s EXPORTED_FUNCTIONS='#{JSON.generate(exported_functions)}' \
        --no-entry \
        --compress-debug-sections \
        #{task.prerequisites.first} \
        -o #{task.name}
    CMD
  end

  build.bins << "picoruby-worker.js"
end
