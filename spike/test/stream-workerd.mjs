import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(createRequire(require.resolve("wrangler/package.json")).resolve("miniflare")));
let upstreamResponse;
const upstream = http.createServer((_request, response) => {
  upstreamResponse = response;
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write("data: first\n\n");
});
await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
const script = `
import createPicoRuby from './picoruby-worker.js';
import wasm from './picoruby-worker.wasm';
import app from './stream_app.bin';
import { createCloudflareBindings, handleRequest } from './runtime.js';
export default { async fetch(request) {
  const bindings = createCloudflareBindings({ AI: { async run() {
    return (await fetch(${JSON.stringify(upstreamUrl)})).body;
  } } }, { AI: 'ai' });
  return handleRequest(createPicoRuby, wasm, app, request, bindings);
} };`;
const options = {
  compatibilityDate: "2026-08-22",
  modulesRoot: "/probe",
  modules: [
    { type: "ESModule", path: "/probe/index.js", contents: script },
    ...["runtime.js", "host-bridge.js"].map(name => ({ type: "ESModule", path: `/probe/${name}`, contents: fs.readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8") })),
    { type: "ESModule", path: "/probe/picoruby-worker.js", contents: fs.readFileSync(new URL("../dist/picoruby-worker.js", import.meta.url), "utf8") },
    { type: "CompiledWasm", path: "/probe/picoruby-worker.wasm", contents: fs.readFileSync(new URL("../dist/picoruby-worker.wasm", import.meta.url)) },
    { type: "Data", path: "/probe/stream_app.bin", contents: fs.readFileSync(new URL("../dist/stream_app.bin", import.meta.url)) },
  ],
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
let timer;
try {
  await Promise.race([
    (async () => {
      const response = await mf.dispatchFetch("https://example.test/stream");
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
      // The upstream only sends its final chunk after the client sees the first.
      upstreamResponse.end("data: second\n\n");
      assert.equal(new TextDecoder().decode((await reader.read()).value), "data: second\n\n");
      assert.equal((await reader.read()).done, true);
    })(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("stream was buffered or stalled")), 15000); }),
  ]);
  console.log("workerd Wasm/Rack: first SSE chunk delivered before upstream completion");
} finally {
  clearTimeout(timer);
  await mf.dispose();
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
}
