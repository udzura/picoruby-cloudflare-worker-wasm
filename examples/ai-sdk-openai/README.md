# Optional OpenAI AI SDK plugin

This example uses local sibling checkouts of `picoruby-cloudflare-template`,
`mruby-rack`, and
[picoruby-ai-sdk-openai](https://github.com/udzura/picoruby-ai-sdk-openai).
The template exporter must support `cloudflare-plugin.json` discovery; that
support is a companion change in `picoruby-cloudflare-template`.
The mrbgem path is specified in
`build_config.rb`; its manifest drives JavaScript export automatically.

```sh
bundle install --local
npm install
export PICORUBY_ROOT=/Users/udzura/ghq/github.com/picoruby/picoruby
bundle exec rake build
npm install --prefix generated/worker
```

Set `OPENAI_TEXT_MODEL` and `OPENAI_EMBEDDING_MODEL` in `wrangler.jsonc`, and
put `OPENAI_API_KEY=...` in a local `.dev.vars`. Run Wrangler from this directory
using your installed CLI (`wrangler dev`). `/generate` returns buffered text,
`/stream` returns plain UTF-8 text, and `/embed` returns two vectors as JSON.
The JS SDK executes on the host; Ruby accesses it through
`env["ai-sdk.openai"]`. No tools or agent loop are registered.

`node test.mjs` runs an offline test against the actual exported Wasm and SDK.
It requires a completed build and `npm install` in the sibling mrbgem repository.
The test does not use a real OpenAI account.

For an offline test of the exact bundled Worker in workerd, run
`npm run check && npm run test:workerd`. This mocks outbound OpenAI HTTP and
never deploys the Worker.
