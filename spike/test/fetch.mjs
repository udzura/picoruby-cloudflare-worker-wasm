import assert from "node:assert/strict";
import { createFetchBindings } from "../src/runtime.js";
import { decodeHostResult, HostResultKind } from "../src/host-bridge.js";

const url = "https://example.test/api";
const options = { method: "POST", headers: { "content-type": "text/plain", "x-example": "test" }, body: "payload" };
const decoder = new TextDecoder();
let calls = 0;
const bridge = createFetchBindings(async request => {
  calls++;
  assert.equal(request.url, url);
  assert.equal(request.headers.get("x-example"), "test");
  assert.equal(request.method, "POST");
  assert.equal(await request.text(), "payload");
  assert.equal(request.redirect, "error");
  assert.ok(request.signal instanceof AbortSignal);
  return new Response("plain body", { status: 403, headers: { "x-example": "yes" } });
}).picorbWorkerFetchBridge;
const result = decodeHostResult(await bridge(url, JSON.stringify(options)));
assert.equal(result.kind, HostResultKind.ok);
const response = JSON.parse(decoder.decode(result.payload));
assert.equal(response.status, 403, "HTTP status is interpreted by Ruby");
assert.equal(response.body, "plain body", "body is not parsed as identity in JavaScript");
assert.equal(response.headers["x-example"], "yes");
for (const target of ["file:///etc/passwd", "not a URL", "https://user:password@example.test", url + "\0"]) {
  assert.equal(decodeHostResult(await bridge(target, JSON.stringify(options))).kind, HostResultKind.argumentError);
}
for (const value of [{ ...options, method: "GET" }, { ...options, body: 1 }, { redirect: "follow" }, [], null]) {
  assert.equal(decodeHostResult(await bridge(url, JSON.stringify(value))).kind, HostResultKind.argumentError);
}
assert.equal(decodeHostResult(await bridge(url, "{")).kind, HostResultKind.protocolError);
assert.equal(calls, 1);
const http = createFetchBindings(async request => {
  assert.equal(request.url, "http://example.test/");
  return new Response("");
});
assert.equal(decodeHostResult(await http.picorbWorkerFetchBridge("http://example.test/")).kind, HostResultKind.ok);
const failing = createFetchBindings(async () => { throw new Error("secret token"); });
const failure = decodeHostResult(await failing.picorbWorkerFetchBridge(url, JSON.stringify(options)));
assert.equal(failure.kind, HostResultKind.error);
assert.equal(decoder.decode(failure.payload), "Cloudflare fetch failed");
const large = createFetchBindings(async () => new Response("x".repeat(1024 * 1024 + 1)));
assert.equal(decodeHostResult(await large.picorbWorkerFetchBridge(url, JSON.stringify(options))).kind, HostResultKind.error);
console.log("Fetch bridge: response, scope, options, size limit and errors passed");
