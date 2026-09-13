import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCloudflareBindingTypes,
  renderCloudflareBindingTypes,
} from "./cloudflare-binding-registry.mjs";

const spikeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let configPath = path.join(spikeRoot, "wrangler.jsonc");
let outputPath = path.join(spikeRoot, "src/generated/cloudflare-bindings.js");
let environment = null;
let check = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--check") {
    check = true;
  } else if (argument === "--config" || argument === "--output" || argument === "--env") {
    const value = process.argv[index += 1];
    if (!value) throw new Error(`${argument} requires a value`);
    if (argument === "--config") configPath = path.resolve(value);
    if (argument === "--output") outputPath = path.resolve(value);
    if (argument === "--env") environment = value;
  } else {
    throw new Error(`Unknown argument: ${argument}`);
  }
}

const source = fs.readFileSync(configPath, "utf8");
const entries = parseCloudflareBindingTypes(source, environment);
const generated = renderCloudflareBindingTypes(entries, path.basename(configPath), environment);

if (check) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;
  if (current !== generated) {
    throw new Error(`${path.relative(spikeRoot, outputPath)} is stale; run npm run generate:bindings`);
  }
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, generated);
}
