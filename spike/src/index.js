import createPicoRuby from "../dist/picoruby-worker.js";
import picoRubyWasm from "../dist/picoruby-worker.wasm";
import appBytecode from "../dist/app.bin";
import { createRuntime, dispatch, RequestBodyTooLargeError } from "./runtime.js";

const runtimePromise = createRuntime(createPicoRuby, picoRubyWasm, appBytecode);

export default {
  async fetch(request) {
    try {
      const runtime = await runtimePromise;
      return await dispatch(runtime, request);
    } catch (error) {
      console.error(error);
      if (error instanceof RequestBodyTooLargeError) {
        return new Response("Request body too large", { status: 413 });
      }
      return new Response("PicoRuby Worker runtime error", { status: 500 });
    }
  },
};
