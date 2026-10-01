import { createWorker } from "./generated/worker/runtime/index.js";
import app from "./generated/worker/app.bin";
export default createWorker({ app, bindingTypes: {} });
