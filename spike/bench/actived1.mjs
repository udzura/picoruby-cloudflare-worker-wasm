// Run after test:actived1 has compiled the sample app.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { decodeHostResult, HostResultKind } from "../src/host-bridge.js";
import createPicoRuby from "../dist/picoruby-worker.js";
import { closeRuntime, createCloudflareBindings, createCloudflareD1Bindings, createRuntime, dispatch } from "../src/runtime.js";

const require = createRequire(import.meta.url);
const miniflare = createRequire(require.resolve("wrangler/package.json")).resolve("miniflare");
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(miniflare));
const options = { modules: true, script: "export default {}", d1Databases: { DB: "bench" }, compatibilityDate: "2026-08-22" };
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
const read = name => readFileSync(new URL(name, import.meta.url));
const binary = read("../dist/picoruby-worker.wasm");
const wasm = new WebAssembly.Module(binary);
const app = read("../dist/actived1_app.bin");
const samples = new Map();

async function measure(label, fn) {
  const start = performance.now();
  const before = process.threadCpuUsage();
  const value = await fn();
  const cpu = process.threadCpuUsage(before);
  const sample = { wall: performance.now() - start, cpu: (cpu.user + cpu.system) / 1000 };
  if (!samples.has(label)) samples.set(label, []);
  samples.get(label).push(sample);
  return value;
}

try {
  const db = await mf.getD1Database("DB");
  await db.prepare(read("../migrations/0001_create_posts.sql").toString()).run();
  await db.batch(Array.from({ length: 20 }, (_, i) => db.prepare("INSERT INTO posts (title) VALUES (?)").bind("Post " + i)));
  const bindings = createCloudflareBindings({ DB: db }, { DB: "d1" });
  let heapBytes;
  for (let i = 0; i < 11; i++) {
    const vm = await measure("new VM + schema + Sinatra", () => createRuntime(createPicoRuby, wasm, app, bindings));
    heapBytes = vm.HEAPU8.byteLength;
    async function request(label, method, path, title) {
      const req = new Request("https://bench.test" + path, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(title && { title }),
      });
      return measure(label, async () => {
        const res = await dispatch(vm, req);
        const text = await res.text();
        if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
        return text ? JSON.parse(text) : null;
      });
    }
    try {
      const post = await request("create", "POST", "/posts", "hello");
      const path = "/posts/" + post.id;
      await request("find", "GET", path);
      await request("update incl. find", "PATCH", path, "edited");
      await request("delete incl. find", "DELETE", path);
      const rows = await request("list 20", "GET", "/posts");
      if (rows.length !== 20) throw new Error("unexpected list size");
    } finally {
      await closeRuntime(vm);
    }
    // Replay a local D1 result to time JS request decoding and response
    // validation/encoding independently of SQLite, RPC and Ruby hydration.
    const result = await db.prepare("SELECT * FROM posts LIMIT 20").run();
    const statement = { run: () => result, bind() { return this; }, first() {}, raw() {} };
    const bridge = createCloudflareD1Bindings({ DB: { prepare: () => statement, batch() {} } }, { DB: "d1" });
    const query = JSON.stringify({ operation: "run", sql: "SELECT * FROM posts LIMIT 20", params: [] });
    const frame = await measure("JS D1 bridge, cached 20 rows", () => bridge.picorbWorkerD1Bridge("DB", query));
    const reply = decodeHostResult(frame);
    if (reply.kind !== HostResultKind.ok || JSON.parse(new TextDecoder().decode(reply.payload)).results.length !== 20) {
      throw new Error("missing D1 rows");
    }
  }
  console.log(`Wasm ${binary.length} B; schema + app bytecode ${app.length} B; allocated linear memory ${heapBytes} B`);
  console.log("Medians in ms, 10 samples after one warm-up. CPU is for the Node main thread.");
  const report = {};
  for (const [label, all] of samples) {
    const median = field => {
      const values = all.slice(1).map(sample => sample[field]).sort((a, b) => a - b);
      return ((values[4] + values[5]) / 2).toFixed(3);
    };
    report[label] = { cpu: median("cpu"), elapsed: median("wall") };
  }
  console.table(report);
} finally {
  await mf.dispose();
}
