import assert from "node:assert/strict";
import { createCloudflareBindings } from "../src/runtime.js";
import { encodeHostCall, decodeHostResult, HostResultKind } from "../src/host-bridge.js";
const bytes = value => new TextEncoder().encode(value);
const plugin = {
  id: "test.plugin",
  create(_env, host) {
    return {
      "test.plugin.echo": { arity: 1, call: ([arg]) => host.json({ value: host.text(arg) }) },
      "test.plugin.fail": { arity: 0, call: () => { throw new Error("expected failure"); } },
    };
  },
};
const bindings = createCloudflareBindings({}, {}, { plugins: [plugin] });
const call = async (operation, args = [], binding = "") => decodeHostResult(await bindings.picorbWorkerHostCallBridge(encodeHostCall(operation, binding, args)));
const echoed = await call("test.plugin.echo", [bytes("hello")]);
assert.equal(echoed.kind, HostResultKind.ok);
assert.equal(JSON.parse(new TextDecoder().decode(echoed.payload)).value, "hello");
assert.equal((await call("test.plugin.echo")).kind, HostResultKind.protocolError);
assert.equal((await call("test.plugin.echo", [bytes("hi")], "AI")).kind, HostResultKind.argumentError);
assert.equal((await call("test.plugin.fail")).kind, HostResultKind.error);
assert.throws(() => createCloudflareBindings({}, {}, { plugins: [plugin, plugin] }), /duplicate/);
assert.throws(() => createCloudflareBindings({}, {}, { plugins: [{ id: "test.plugin", create: () => ({ fetch: { arity: 2, call() {} } }) }] }), /Invalid/);
const unused = createCloudflareBindings({}, {});
assert.equal(decodeHostResult(await unused.picorbWorkerHostCallBridge(encodeHostCall("test.plugin.echo", "", [bytes("hi")]))).kind, HostResultKind.protocolError);
console.log("Worker plugins: dispatch, isolation of names, arguments and errors passed");
