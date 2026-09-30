// Run after compiling this example into spike/dist/app.bin.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(new URL("../../spike/package.json", import.meta.url));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(createRequire(require.resolve("wrangler/package.json")).resolve("miniflare")));
const read = path => fs.readFileSync(new URL(path, import.meta.url));
const script = `
import worker from './worker.js';
export default { fetch(request) {
  return worker.fetch(request, { AI: { async run(model, input) {
    if (model === '@cf/baai/bge-reranker-base') {
      if (input.query === 'fail') throw new Error('Mock reranker failure');
      if (input.query !== 'Which animal purrs?' || input.top_k !== 3 ||
          JSON.stringify(input.contexts) !== JSON.stringify([{ text: 'Dog' }, { text: 'Cat' }, { text: 'Bird' }])) {
        throw new Error('Unexpected reranker input');
      }
      return { response: [{ id: 1, score: 0.9 }, { id: 2, score: 0.2 }, { id: 0, score: 0.1 }] };
    }
    if (model !== '@cf/huggingface/distilbert-sst-2-int8') throw new Error('Wrong model');
    if (input.text === 'fail') throw new Error('Mock inference failure');
    if (input.text !== 'This pizza is great!') throw new Error('Unexpected text');
    return [{ label: 'NEGATIVE', score: 0.01 }, { label: 'POSITIVE', score: 0.99 }];
  } } });
} };`;
const options = {
  compatibilityDate: "2026-08-22",
  modulesRoot: "/test",
  modules: [
    { type: "ESModule", path: "/test/examples/ai-classification/index.js", contents: script },
    { type: "ESModule", path: "/test/examples/ai-classification/worker.js", contents: read("worker.js").toString() },
    ...["runtime.js", "host-bridge.js"].map(name => ({ type: "ESModule", path: `/test/spike/src/${name}`, contents: read(`../../spike/src/${name}`).toString() })),
    { type: "ESModule", path: "/test/spike/dist/picoruby-worker.js", contents: read("../../spike/dist/picoruby-worker.js").toString() },
    { type: "CompiledWasm", path: "/test/spike/dist/picoruby-worker.wasm", contents: read("../../spike/dist/picoruby-worker.wasm") },
    { type: "Data", path: "/test/spike/dist/app.bin", contents: read("../../spike/dist/app.bin") },
  ],
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
const post = (body, path = "/api/classify") => mf.dispatchFetch(`http://localhost${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body,
});
try {
  const result = await post(JSON.stringify({ text: "This pizza is great!" }));
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-type"), /application\/json/);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), [{ label: "NEGATIVE", score: 0.01 }, { label: "POSITIVE", score: 0.99 }]);
  for (const body of ["{", "null", "[]", "{}", '{"text":42}', '{"text":"  "}']) {
    const response = await post(body);
    assert.equal(response.status, 400, body);
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal((await post(JSON.stringify({ text: "x".repeat(16_384) }))).status, 413);
  const failure = await post('{"text":"fail"}');
  assert.equal(failure.status, 502);
  assert.deepEqual(await failure.json(), { error: "AI request failed" });
  assert.equal((await mf.dispatchFetch("http://localhost/api/unknown")).status, 404);
  const selection = await post(JSON.stringify({ query: "Which animal purrs?", choices: ["Dog", "Cat", "Bird"] }), "/api/select");
  assert.equal(selection.status, 200);
  assert.deepEqual(await selection.json(), {
    response: [{ id: 1, score: 0.9 }, { id: 2, score: 0.2 }, { id: 0, score: 0.1 }],
  });
  for (const payload of [null, [], {}, { query: " ", choices: ["a", "b"] },
    { query: 42, choices: ["a", "b"] }, { query: "q", choices: "a" },
    { query: "q", choices: ["a"] }, { query: "q", choices: ["a", " "] },
    { query: "q", choices: ["a", 42] }, { query: "q", choices: Array(21).fill("a") }]) {
    const response = await post(JSON.stringify(payload), "/api/select");
    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal((await post("{", "/api/select")).status, 400);
  assert.equal((await post(JSON.stringify({ query: "x".repeat(16_384), choices: ["a", "b"] }), "/api/select")).status, 413);
  const rerankerFailure = await post('{"query":"fail","choices":["a","b"]}', "/api/select");
  assert.equal(rerankerFailure.status, 502);
  assert.deepEqual(await rerankerFailure.json(), { error: "AI request failed" });
  console.log("Classification and selection: Wasm/model forwarding, JSON result, validation and inference failure passed");
} finally {
  await mf.dispose();
}
