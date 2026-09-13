import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const miniflarePath = process.argv[2] || createRequire(require.resolve("wrangler/package.json")).resolve("miniflare");
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(miniflarePath));
const script = `
import { PicoRubyDurableObject } from './durable-object.js';
import { createCloudflareDurableObjectBindings } from './runtime.js';
import { decodeHostResult } from './host-bridge.js';
export { PicoRubyDurableObject };
export default { async fetch(_request, env) {
  const bridge = createCloudflareDurableObjectBindings(env, { OBJECTS: 'durable_object' });
  const put = decodeHostResult(await bridge.picorbWorkerDurableObjectPutBridge('OBJECTS', 'alice', '{"name":"Alice"}'));
  const get = decodeHostResult(await bridge.picorbWorkerDurableObjectGetBridge('OBJECTS', 'alice'));
  const other = decodeHostResult(await bridge.picorbWorkerDurableObjectGetBridge('OBJECTS', 'bob'));
  return Response.json({ put: put.kind, get: get.kind, value: new TextDecoder().decode(get.payload), other: other.kind });
} };`;
const options = {
  compatibilityDate: "2026-08-22",
  modulesRoot: "/probe",
  modules: [
    { type: "ESModule", path: "/probe/index.js", contents: script },
    ...["runtime.js", "host-bridge.js", "durable-object.js"].map(name => ({
      type: "ESModule", path: `/probe/${name}`,
      contents: fs.readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"),
    })),
  ],
  durableObjects: { OBJECTS: { className: "PicoRubyDurableObject", useSQLite: true } },
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
try {
  const result = await (await mf.dispatchFetch("https://example.test/")).json();
  assert.deepEqual(result, { put: 0, get: 0, value: '{"name":"Alice"}', other: 1 });
  console.log("workerd Durable Object: RPC and persistent JSON storage passed");
} finally {
  await mf.dispose();
}
