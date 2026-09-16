import assert from "node:assert/strict";

import { createCloudflareD1Bindings } from "../src/runtime.js";
import { decodeHostResult, HostResultKind, hostErrorMessage } from "../src/host-bridge.js";

const calls = [];
const meta = {
  duration: 1.25,
  changes: 0,
  last_row_id: 0,
  changed_db: false,
  rows_read: 1,
  rows_written: 0,
};

function createStatement(sql, params = []) {
  return {
    bind(...values) {
      return createStatement(sql, values);
    },
    async run() {
      calls.push(["run", sql, params]);
      if (sql === "FAIL") throw new Error("D1 backend rejected the query");
      if (sql === "UNSAFE_RESULT") {
        return { success: true, meta, results: [{ id: Number.MAX_SAFE_INTEGER + 1 }] };
      }
      return { success: true, meta, results: [{ id: params[0] ?? 1, name: "Alice" }] };
    },
    async first(column) {
      calls.push(["first", sql, params, column]);
      const row = { id: params[0] ?? 1, name: "Alice" };
      return column === undefined ? row : row[column];
    },
    async raw(options) {
      calls.push(["raw", sql, params, options]);
      const rows = [[params[0] ?? 1, "Alice"]];
      return options?.columnNames ? [["id", "name"], ...rows] : rows;
    },
  };
}

const database = {
  prepare(sql) {
    return createStatement(sql);
  },
  async batch(statements) {
    calls.push(["batch", statements.length]);
    return await Promise.all(statements.map(statement => statement.run()));
  },
};
const bridge = createCloudflareD1Bindings({ DB: database }, { DB: "d1" });
const decoder = new TextDecoder();

async function execute(request, bindingName = "DB") {
  const frame = await bridge.picorbWorkerD1Bridge(bindingName, JSON.stringify(request));
  const result = decodeHostResult(frame);
  return {
    frame,
    kind: result.kind,
    value: result.kind === HostResultKind.ok ? JSON.parse(decoder.decode(result.payload)) : null,
  };
}

let result = await execute({ operation: "run", sql: "SELECT", params: [7, "text", true, null, 1.5] });
assert.equal(result.kind, HostResultKind.ok);
assert.deepEqual(result.value.results, [{ id: 7, name: "Alice" }]);
assert.deepEqual(calls.at(-1), ["run", "SELECT", [7, "text", true, null, 1.5]]);

result = await execute({ operation: "first", sql: "SELECT", params: [8], column: null });
assert.deepEqual(result.value, { id: 8, name: "Alice" });
result = await execute({ operation: "first", sql: "SELECT", params: [9], column: "name" });
assert.equal(result.value, "Alice");

result = await execute({ operation: "raw", sql: "SELECT", params: [10], columnNames: true });
assert.deepEqual(result.value, [["id", "name"], [10, "Alice"]]);

result = await execute({
  operation: "batch",
  statements: [
    { sql: "INSERT", params: ["Alice"] },
    { sql: "INSERT", params: ["Bob"] },
  ],
});
assert.equal(result.kind, HostResultKind.ok);
assert.equal(result.value.length, 2);
assert.deepEqual(calls.find(call => call[0] === "batch"), ["batch", 2]);

for (const request of [
  { operation: "run", sql: "", params: [] },
  { operation: "run", sql: "SELECT", params: [{}] },
  { operation: "run", sql: "SELECT", params: [Number.MAX_SAFE_INTEGER + 1] },
]) {
  result = await execute(request);
  assert.equal(result.kind, HostResultKind.argumentError);
}

result = await execute({ operation: "unknown", sql: "SELECT", params: [] });
assert.equal(result.kind, HostResultKind.protocolError);
result = await execute({ operation: "batch", statements: [] });
assert.equal(result.kind, HostResultKind.protocolError);

result = await execute({ operation: "run", sql: "FAIL", params: [] });
assert.equal(result.kind, HostResultKind.error);
assert.match(hostErrorMessage(result.frame), /D1 backend rejected the query/);

result = await execute({ operation: "run", sql: "UNSAFE_RESULT", params: [] });
assert.equal(result.kind, HostResultKind.protocolError);

result = await execute({ operation: "run", sql: "SELECT", params: [] }, "MISSING");
assert.equal(result.kind, HostResultKind.bindingError);

console.log("D1 bridge: run, first, raw, batch, scalar params and errors passed");
