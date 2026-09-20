// Local workerd demo: substitute only the AI binding, retain the real Wasm/Sinatra path.
import fs from "node:fs";
import http from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(new URL("../../spike/package.json", import.meta.url));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(createRequire(require.resolve("wrangler/package.json")).resolve("miniflare")));
const read = path => fs.readFileSync(new URL(path, import.meta.url));
const script = `
import worker from './worker.js';
export default { fetch(request) {
  return worker.fetch(request, { AI: { async run() {
    const chunks = [
      { choices: [{ delta: { reasoning: '物語の主題を考えます。', reasoning_content: '物語の主題を考えます。' } }] },
      { choices: [{ delta: { reasoning: 'Rubyと雲を結びつけます。', reasoning_content: 'Rubyと雲を結びつけます。' } }] },
      { choices: [{ delta: { content: 'Rubyの', reasoning_content: null } }] },
      { choices: [{ delta: { content: '小さな雲が、', reasoning_content: null } }] },
      { choices: [{ delta: { content: '空を旅していました。', reasoning_content: null } }] },
    ];
    return new ReadableStream({ async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, 600));
      const chunk = chunks.shift();
      controller.enqueue(new TextEncoder().encode(chunk === undefined
        ? 'data: [DONE]\\n\\n' : 'data: ' + JSON.stringify(chunk) + '\\n\\n'));
      if (chunk === undefined) controller.close();
    } }, { highWaterMark: 0 });
  } } });
} };`;
const options = {
  compatibilityDate: "2026-08-22",
  modulesRoot: "/demo",
  modules: [
    { type: "ESModule", path: "/demo/examples/ai-stream/index.js", contents: script },
    { type: "ESModule", path: "/demo/examples/ai-stream/worker.js", contents: read("worker.js").toString() },
    ...["runtime.js", "host-bridge.js"].map(name => ({ type: "ESModule", path: `/demo/spike/src/${name}`, contents: read(`../../spike/src/${name}`).toString() })),
    { type: "ESModule", path: "/demo/spike/dist/picoruby-worker.js", contents: read("../../spike/dist/picoruby-worker.js").toString() },
    { type: "CompiledWasm", path: "/demo/spike/dist/picoruby-worker.wasm", contents: read("../../spike/dist/picoruby-worker.wasm") },
    { type: "Data", path: "/demo/spike/dist/app.bin", contents: read("../../spike/dist/app.bin") },
  ],
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
const server = http.createServer(async (request, response) => {
  const abort = new AbortController();
  response.on("close", () => abort.abort());
  let reader;
  try {
    if (["/", "/client.js", "/glm-stream.js"].includes(request.url)) {
      response.setHeader("content-type", request.url === "/" ? "text/html;charset=utf-8" : "text/javascript;charset=utf-8");
      const asset = request.url === "/" ? "public/index.html" : `public${request.url}`;
      response.end(read(asset));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await mf.dispatchFetch(`http://localhost${request.url}`, {
      method: request.method, headers: request.headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.concat(chunks),
      signal: abort.signal,
    });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.flushHeaders();
    if (result.body) {
      reader = result.body.getReader();
      while (!response.destroyed) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!response.write(value)) await once(response, "drain", { signal: abort.signal });
      }
    }
    response.end();
  } catch (error) {
    if (!abort.signal.aborted) console.error(error);
    response.destroy();
  } finally {
    await reader?.cancel().catch(() => {});
  }
});
server.listen(8787, "127.0.0.1", () => console.log("Local mock AI demo: http://127.0.0.1:8787 (no AI API calls)"));
async function close() {
  server.closeAllConnections();
  server.close();
  await mf.dispose();
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
