import { DurableObject } from "cloudflare:workers";

const STORAGE_KEY = "pojo";

function validateJsonObject(json) {
  if (typeof json !== "string") throw new TypeError("Durable Object value must be a JSON string");
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new TypeError("Durable Object value contains invalid JSON");
  }
  if (!value || typeof value !== "object") {
    throw new TypeError("Durable Object value must encode a JSON object or array");
  }
}

export class PicoRubyDurableObject extends DurableObject {
  async get() {
    return await this.ctx.storage.get(STORAGE_KEY) ?? null;
  }

  async put(json) {
    validateJsonObject(json);
    await this.ctx.storage.put(STORAGE_KEY, json);
  }
}
