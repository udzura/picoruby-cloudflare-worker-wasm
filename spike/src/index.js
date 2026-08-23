import createPicoRuby from "../dist/picoruby-worker.js";
import picoRubyWasm from "../dist/picoruby-worker.wasm";
import appBytecode from "../dist/app.bin";
import { createRuntime, dispatch } from "./runtime.js";

const runtimePromise = createRuntime(createPicoRuby, picoRubyWasm, appBytecode);

export default {
  async fetch(request) {
    try {
      const runtime = await runtimePromise;
      const body = dispatch(runtime, request);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    } catch (error) {
      console.error(error);
      return new Response("PicoRuby Worker runtime error", { status: 500 });
    }
  },
};
