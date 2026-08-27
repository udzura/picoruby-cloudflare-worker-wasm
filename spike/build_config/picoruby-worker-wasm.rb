# The PicoRuby source tree is supplied by PICORUBY_ROOT when this configuration
# is invoked from spike/Rakefile.
#
# PicoRuby's build helper normally resolves this gem from its own mrbgems
# directory. Override that resolution for this process only, so spike can use
# a patched copy without changing the checkout or adding a duplicate gem.
class MRuby::Build
  def build_mrbc_exec
    gem gemdir: File.expand_path(ENV.fetch("MRUBY_COMPILER_GEM_DIR")) unless @gems["mruby-compiler"]
    gem core: "mruby-bin-mrbc" unless @gems["mruby-bin-mrbc"]
    self.mrbcfile = "#{build_dir}/bin/mrbc"
    set_build_info
  end
end

MRuby::CrossBuild.new("picoruby-worker-wasm") do |conf|
  conf.toolchain :clang

  conf.cc.command = "emcc"
  conf.linker.command = "emcc"
  conf.archiver.command = "emar"

  # JSPI cannot suspend through the JavaScript wrappers used by Emscripten's
  # default setjmp/longjmp implementation. Keep mruby's exception frames in
  # Wasm so an asynchronous host call can suspend directly through the VM.
  conf.cc.flags << "-sSUPPORT_LONGJMP=wasm"
  conf.cc.flags << "-sWASM_LEGACY_EXCEPTIONS=0"
  # The root build also links the mruby command-line helper.  It consumes the
  # same object files, so its final link needs the matching longjmp mode.
  conf.linker.flags << "-sSUPPORT_LONGJMP=wasm"
  conf.linker.flags << "-sWASM_LEGACY_EXCEPTIONS=0"

  conf.cc.defines << "PICORB_PLATFORM_WASM"
  conf.cc.defines << "PICORB_PLATFORM_CLOUDFLARE_WORKERS"
  conf.cc.defines << "MRB_32BIT"
  conf.cc.defines << "MRB_INT64"
  conf.cc.defines << "MRB_NO_BOXING"
  conf.cc.defines << "MRB_UTF8_STRING"

  # Select the single-threaded HAL carried by picoruby-worker-wasm.
  conf.ports :worker_wasm

  # The target runtime also links mruby-compiler through
  # picoruby-worker-wasm's dependency. Register the same staged gem here.
  conf.gem gemdir: File.expand_path(ENV.fetch("MRUBY_COMPILER_GEM_DIR"))
  conf.picoruby(alloc_estalloc: false)

  mruby_gems = File.join(MRUBY_ROOT, "mrbgems", "picoruby-mruby", "lib", "mruby", "mrbgems")
  %w[
    mruby-array-ext
    mruby-catch
    mruby-class-ext
    mruby-enum-ext
    mruby-hash-ext
    mruby-kernel-ext
    mruby-metaprog
    mruby-method
    mruby-numeric-ext
    mruby-object-ext
    mruby-proc-ext
    mruby-sprintf
    mruby-string-ext
    mruby-struct
    mruby-bin-mruby
  ].each do |name|
    conf.gem gemdir: File.join(mruby_gems, name)
  end

  conf.gem gemdir: File.expand_path(ENV.fetch("MRUBY_REGEXP_DIR"))
  {
    "MRUBY_MUSTERMANN_GEM_DIR" => "udzura/mruby-mustermann",
    "MRUBY_RACK_GEM_DIR" => "udzura/mruby-rack",
    "PICORUBY_SINATRA_COVERS_GEM_DIR" => "udzura/picoruby-sinatra-covers",
  }.each do |environment, repository|
    if (gem_dir = ENV[environment])
      conf.gem gemdir: File.expand_path(gem_dir)
    else
      conf.gem github: repository, branch: "master"
    end
  end

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
