# The PicoRuby source tree is supplied by PICORUBY_ROOT when this configuration
# is invoked from spike/Rakefile.
MRuby::CrossBuild.new("picoruby-worker-wasm") do |conf|
  conf.toolchain :clang

  conf.cc.command = "emcc"
  conf.linker.command = "emcc"
  conf.archiver.command = "emar"

  conf.cc.defines << "PICORB_PLATFORM_WASM"
  conf.cc.defines << "PICORB_PLATFORM_CLOUDFLARE_WORKERS"
  conf.cc.defines << "MRB_32BIT"
  conf.cc.defines << "MRB_INT64"
  conf.cc.defines << "MRB_NO_BOXING"
  conf.cc.defines << "MRB_UTF8_STRING"

  # Select the single-threaded HAL carried by picoruby-worker-wasm.
  conf.ports :worker_wasm

  conf.picoruby(alloc_estalloc: false)
  conf.gem github: "udzura/picoruby-cloudflare-worker-wasm",
           branch: "master",
           checksum_hash: ENV.fetch("PICORUBY_WORKER_WASM_REV", "0df9efdc7cd32feb2a8abe9d92a7c27317bb4008")
end
