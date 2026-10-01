import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(createRequire(require.resolve("wrangler/package.json")).resolve("miniflare")));
const root = new URL("./.wrangler/dry-run/", import.meta.url);
const response = {
  id: "resp_mock", object: "response", created_at: 1, model: "test-model", status: "completed",
  output: [{ id: "msg_mock", type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: "Hello Ruby", annotations: [] }] }],
  usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
};
// Mock only outbound OpenAI HTTP; use the exact Wrangler-generated bundle.
const mock = `
const mockResponse = ${JSON.stringify(response)};
globalThis.fetch = async (url, init) => {
  const input = JSON.parse(init.body);
  if (String(url).endsWith('/embeddings')) return Response.json({ object: 'list', model: input.model,
    data: input.input.map((_, index) => ({ object: 'embedding', index, embedding: [index + 0.1, index + 0.2] })),
    usage: { prompt_tokens: 4, total_tokens: 4 } });
  if (!input.stream) return Response.json(mockResponse);
  const events = [
    { type: 'response.created', response: { ...mockResponse, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_mock', type: 'message', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', item_id: 'msg_mock', output_index: 0, content_index: 0, delta: 'Hello ' },
    { type: 'response.output_text.delta', item_id: 'msg_mock', output_index: 0, content_index: 0, delta: 'Ruby' },
    { type: 'response.completed', response: mockResponse },
  ];
  return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join(''),
    { headers: { 'content-type': 'text/event-stream' } });
};
`;
const options = {
  compatibilityDate: "2026-08-22",
  compatibilityFlags: ["nodejs_compat"],
  bindings: { OPENAI_API_KEY: "offline-test", OPENAI_TEXT_MODEL: "test-model", OPENAI_EMBEDDING_MODEL: "embedding-test" },
  modulesRoot: "/probe",
  modules: [
    { type: "ESModule", path: "/probe/worker.js", contents: mock + fs.readFileSync(new URL("worker.js", root), "utf8") },
    ...fs.readdirSync(root).filter(name => /\.(wasm|bin)$/.test(name)).map(name => ({
      type: name.endsWith(".wasm") ? "CompiledWasm" : "Data",
      path: `/probe/${name}`, contents: fs.readFileSync(new URL(name, root)),
    })),
  ],
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
try {
  const generated = await mf.dispatchFetch("https://example.test/generate");
  assert.equal(generated.status, 200);
  assert.equal(await generated.text(), "Hello Ruby");
  const embedded = await mf.dispatchFetch("https://example.test/embed");
  assert.equal(embedded.status, 200);
  assert.deepEqual((await embedded.json()).vectors, [[0.1, 0.2], [1.1, 1.2]]);
  const streamed = await mf.dispatchFetch("https://example.test/stream");
  assert.equal(streamed.status, 200);
  assert.equal(await streamed.text(), "Hello Ruby");
  console.log("OpenAI workerd: generated Worker bundle, SDK, Wasm and Rack passed offline");
} finally { await mf.dispose(); }
