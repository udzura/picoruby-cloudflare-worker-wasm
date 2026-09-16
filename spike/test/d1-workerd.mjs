import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const miniflarePath = process.argv[2] || createRequire(require.resolve("wrangler/package.json")).resolve("miniflare");
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(miniflarePath));
const script = `
import { createCloudflareD1Bindings } from './runtime.js';
import { decodeHostResult } from './host-bridge.js';
const decoder = new TextDecoder();
async function execute(bridge, request) {
  const result = decodeHostResult(await bridge.picorbWorkerD1Bridge('DB', JSON.stringify(request)));
  if (result.kind !== 0) throw new Error(decoder.decode(result.payload));
  return JSON.parse(decoder.decode(result.payload));
}
export default { async fetch(_request, env) {
  const bridge = createCloudflareD1Bindings(env, { DB: 'd1' });
  await execute(bridge, { operation: 'run', sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, active INTEGER)', params: [] });
  const batch = await execute(bridge, { operation: 'batch', statements: [
    { sql: 'INSERT INTO users (name, active) VALUES (?1, ?2)', params: ['Alice', true] },
    { sql: 'INSERT INTO users (name, active) VALUES (?1, ?2)', params: ['Bob', false] },
  ] });
  const run = await execute(bridge, { operation: 'run', sql: 'SELECT id, name, active FROM users ORDER BY id', params: [] });
  const first = await execute(bridge, { operation: 'first', sql: 'SELECT id, name FROM users WHERE name = ?1', params: ['Bob'], column: null });
  const scalar = await execute(bridge, { operation: 'first', sql: 'SELECT name FROM users WHERE id = ?1', params: [1], column: 'name' });
  const raw = await execute(bridge, { operation: 'raw', sql: 'SELECT id, name FROM users ORDER BY id', params: [], columnNames: true });
  return Response.json({ batch, run, first, scalar, raw });
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
  d1Databases: { DB: "d1-test" },
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
try {
  const result = await (await mf.dispatchFetch("https://example.test/")).json();
  assert.equal(result.batch.length, 2);
  assert.equal(result.batch[0].meta.changes, 1);
  assert.deepEqual(result.run.results, [
    { id: 1, name: "Alice", active: 1 },
    { id: 2, name: "Bob", active: 0 },
  ]);
  assert.deepEqual(result.first, { id: 2, name: "Bob" });
  assert.equal(result.scalar, "Alice");
  assert.deepEqual(result.raw, [["id", "name"], [1, "Alice"], [2, "Bob"]]);
  console.log("workerd D1: prepared statements, scalar binds, batch and result modes passed");
} finally {
  await mf.dispose();
}
