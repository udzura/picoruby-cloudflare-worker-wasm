import createPicoRuby from "../../spike/dist/picoruby-worker.js";
import wasm from "../../spike/dist/picoruby-worker.wasm";
import app from "../../spike/dist/app.bin";
import { createCloudflareBindings, handleRequest, RequestBodyTooLargeError } from "../../spike/src/runtime.js";

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(createPicoRuby, wasm, app, request,
        createCloudflareBindings(env, { AI: "ai" }));
    } catch (error) {
      console.error("PicoRuby AI stream request failed", error);
      return new Response("AI request failed", {
        status: error instanceof RequestBodyTooLargeError ? 413 : 500,
      });
    }
  },
};
