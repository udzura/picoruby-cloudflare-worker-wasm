import assert from "node:assert/strict";
import fs from "node:fs";

import createPicoRuby from "../dist/picoruby-worker.js";
import { closeRuntime, createRuntime, dispatch } from "../src/runtime.js";

const wasmModule = new WebAssembly.Module(
  fs.readFileSync(new URL("../dist/picoruby-worker.wasm", import.meta.url)),
);
const appBytecode = fs.readFileSync(new URL("../dist/input_stream_app.bin", import.meta.url));
const runtime = await createRuntime(createPicoRuby, wasmModule, appBytecode);

for (const [path, source, expected] of [
  ["/", new Uint8Array([0, 1, 2, 255]), new Uint8Array([0, 1, 2, 255])],
  ["/gets", "first\nsecond\nthird", "first\n|second\n|third"],
  ["/each", "first\nsecond\nthird", "first\n|second\n|third"],
  ["/gets_all", "first\nsecond\nthird", "first\nsecond\nthird"],
  ["/rewind", "abcdef", "ab|abcdef"],
]) {
  const response = await dispatch(
    runtime,
    new Request(`https://example.com${path}`, { method: "POST", body: source }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-input-alias"), "true");
  if (expected instanceof Uint8Array) {
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected);
  } else {
    assert.equal(await response.text(), expected);
  }
}

await closeRuntime(runtime);
