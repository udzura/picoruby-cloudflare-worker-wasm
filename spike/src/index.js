import createPicoRuby from "../dist/picoruby-worker.js";
import picoRubyWasm from "../dist/picoruby-worker.wasm";
import appBytecode from "../dist/app.bin";
import { cloudflareBindingTypes } from "./generated/cloudflare-bindings.js";
import {
  createCloudflareBindings,
  handleRequest,
  RequestBodyTooLargeError,
} from "./runtime.js";

export { PicoRubyDurableObject } from "./durable-object.js";

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(
        createPicoRuby,
        picoRubyWasm,
        appBytecode,
        request,
        createCloudflareBindings(env, cloudflareBindingTypes),
      );
    } catch (error) {
      console.error(error);
      if (error instanceof RequestBodyTooLargeError) {
        return new Response("Request body too large", { status: 413 });
      }
      return new Response("PicoRuby Worker runtime error", { status: 500 });
    }
  },
};
