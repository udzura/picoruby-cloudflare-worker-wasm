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
  if (gem_dir = ENV["PICORUBY_WORKER_WASM_GEM_DIR"])
    conf.gem gemdir: File.expand_path(gem_dir)
  else
    gem_ref = ENV.fetch("PICORUBY_WORKER_WASM_REF", "0.0.1")
    gem_revision = ENV.fetch("PICORUBY_WORKER_WASM_REV", "03ed78cf243bd05039e657cafe809681be5679da")
    conf.gem github: "udzura/picoruby-cloudflare-worker-wasm",
             branch: gem_ref,
             checksum_hash: gem_revision
  end
end
