import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const miniflare = createRequire(require.resolve("wrangler/package.json")).resolve("miniflare");
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(miniflare));
const read = file => fs.readFileSync(new URL(file, import.meta.url));
const script = `
import createPicoRuby from './picoruby-worker.js';
import wasm from './picoruby-worker.wasm';
import app from './actived1_app.bin';
import { createCloudflareBindings, handleRequest } from './runtime.js';
export default { fetch(request, env) {
  return handleRequest(createPicoRuby, wasm, app, request, createCloudflareBindings(env, { DB: 'd1' }));
} };`;
const options = {
  compatibilityDate: "2026-08-22",
  d1Databases: { DB: "actived1-test" },
  modulesRoot: "/probe",
  modules: [
    { type: "ESModule", path: "/probe/index.js", contents: script },
    ...["runtime.js", "host-bridge.js", "picoruby-worker.js"].map(name => ({
      type: "ESModule", path: `/probe/${name}`,
      contents: read(`../${name === "picoruby-worker.js" ? "dist" : "src"}/${name}`).toString(),
    })),
    { type: "CompiledWasm", path: "/probe/picoruby-worker.wasm", contents: read("../dist/picoruby-worker.wasm") },
    { type: "Data", path: "/probe/actived1_app.bin", contents: read("../dist/actived1_app.bin") },
  ],
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
async function request(method, path, status, data) {
  const response = await mf.dispatchFetch("https://example.test" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await response.text();
  assert.equal(response.status, status, `${method} ${path}: ${body}`);
  return body ? JSON.parse(body) : null;
}
try {
  const db = await mf.getD1Database("DB");
  await db.prepare(read("../migrations/0001_create_posts.sql").toString()).run();
  assert.deepEqual(await request("GET", "/posts", 200), []);
  const title = "Ruby's D1";
  const post = await request("POST", "/posts", 201, { title });
  assert.deepEqual(post, { id: 1, title, body: null, published: 0, title_length: title.length });
  assert.deepEqual(await request("GET", "/posts/1", 200), post);
  const edited = await request("PATCH", "/posts/1", 200, { title: "Edited" });
  assert.deepEqual(edited, { ...post, title: "Edited", title_length: 6 });
  assert.deepEqual(await request("GET", "/posts", 200), [edited]);
  await request("DELETE", "/posts/1", 204);
  assert.deepEqual(await request("GET", "/posts", 200), []);
  await request("GET", "/posts/1", 404);
  console.log("ActiveD1: PicoRuby.wasm CRUD passed on local D1");
} finally {
  await mf.dispose();
}
