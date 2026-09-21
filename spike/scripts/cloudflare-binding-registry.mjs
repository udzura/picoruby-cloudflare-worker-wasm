import { parse, printParseErrorCode } from "jsonc-parser";

const RESOURCE_BINDINGS = [
  { section: "kv_namespaces", subsection: null, nameField: "binding", type: "kv", singleton: false },
  { section: "queues", subsection: "producers", nameField: "binding", type: "queue", singleton: false },
  { section: "durable_objects", subsection: "bindings", nameField: "name", type: "durable_object", singleton: false },
  { section: "d1_databases", subsection: null, nameField: "binding", type: "d1", singleton: false },
  { section: "r2_buckets", subsection: null, nameField: "binding", type: "r2", singleton: false },
  { section: "ai", subsection: null, nameField: "binding", type: "ai", singleton: true },
  { section: "vectorize", subsection: null, nameField: "binding", type: "vectorize", singleton: false },
];

export function parseCloudflareBindingTypes(source, environment = null) {
  const errors = [];
  const config = parse(source, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const error = errors[0];
    throw new Error(`${printParseErrorCode(error.error)} at offset ${error.offset}`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("Wrangler configuration must be a JSON object");
  }

  let selected = config;
  if (environment !== null) {
    selected = config.env?.[environment];
    if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
      throw new Error(`Wrangler environment ${environment} is not configured`);
    }
  }

  const entries = [];
  const names = new Set();
  for (const { section, subsection, nameField, type, singleton } of RESOURCE_BINDINGS) {
    let bindings = subsection === null ? selected[section] : selected[section]?.[subsection];
    if (bindings === undefined) continue;
    if (singleton) {
      if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
        throw new TypeError(`${section} must be an object`);
      }
      bindings = [bindings];
    } else if (!Array.isArray(bindings)) {
      throw new TypeError(`${section}${subsection ? `.${subsection}` : ""} must be an array`);
    }
    for (const binding of bindings) {
      const name = binding?.[nameField];
      if (typeof name !== "string" || name.length === 0) {
        throw new TypeError(`${section} contains an invalid binding name`);
      }
      if (names.has(name)) throw new Error(`Duplicate Cloudflare binding name: ${name}`);
      names.add(name);
      entries.push([name, type]);
    }
  }
  return entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

export function renderCloudflareBindingTypes(entries, sourceName, environment = null) {
  const renderedEntries = entries.map(([name, type]) => `  [${JSON.stringify(name)}, ${JSON.stringify(type)}],`).join("\n");
  const selectedEnvironment = environment === null ? "default" : environment;
  return `// Generated from ${sourceName} for the ${selectedEnvironment} environment.\n` +
    "// Run `npm run generate:bindings` after changing Wrangler resource bindings.\n" +
    "export const cloudflareBindingTypes = Object.freeze(Object.fromEntries([\n" +
    `${renderedEntries}${renderedEntries ? "\n" : ""}` +
    "]));\n";
}
