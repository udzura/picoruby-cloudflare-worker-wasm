require "picoruby/cloudflare/build"

MRuby::CrossBuild.new("worker") do |conf|
  conf.cloudflare_worker! do |cf|
    cf.picoruby_cloudflare_worker_wasm_mgem_dir = File.expand_path("../..", __dir__)
    cf.mruby_rack_mgem_dir = File.expand_path("../../../mruby-rack", __dir__)
  end
  conf.gem gemdir: File.expand_path("../../../picoruby-ai-sdk-openai", __dir__)
  conf.worker_export(
    app: "app.rb", output_dir: "generated/worker",
    wrangler_config: "wrangler.jsonc", project_root: __dir__,
  )
end
