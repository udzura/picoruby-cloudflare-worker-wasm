import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const miniflarePath = process.argv[2] || createRequire(require.resolve("wrangler/package.json")).resolve("miniflare");
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(miniflarePath));
const script = `
import { createFetchBindings } from './runtime.js';
import { decodeHostResult } from './host-bridge.js';
export default { async fetch() {
  const results = [];
  for (const status of [200, 403, 302, 307]) {
    let calls = 0;
    let mode;
    const bridge = createFetchBindings(async request => {
      calls++;
      mode = request.redirect;
      return new Response('body', { status, headers: { location: 'https://secret.example/' } });
    }).picorbWorkerFetchBridge;
    const result = decodeHostResult(await bridge('https://example.test/', JSON.stringify({headers:{Cookie:'CF_Authorization=dummy'}})));
    results.push({status, calls, mode, kind:result.kind, payload:new TextDecoder().decode(result.payload)});
  }
  return Response.json(results);
} };`;
const options = {
  compatibilityDate: "2026-08-22",
  modulesRoot: "/probe",
  modules: [
    { type: "ESModule", path: "/probe/index.js", contents: script },
    ...["runtime.js", "host-bridge.js"].map(name => ({
      type: "ESModule", path: `/probe/${name}`,
      contents: fs.readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"),
    })),
  ],
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
try {
  const results = await (await mf.dispatchFetch("https://example.test/")).json();
  for (const result of results) {
    assert.equal(result.calls, 1);
    assert.equal(result.mode, "manual");
    assert.equal(result.kind, result.status >= 300 && result.status < 400 ? 2 : 0);
    if (result.kind !== 0) assert.ok(!result.payload.includes("secret.example"));
  }
  console.log("workerd fetch: Request construction, HTTP errors and redirect rejection passed");
} finally {
  await mf.dispose();
}
