function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const usageNames = [
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "cachedTokens",
  "neurons",
];

const usageFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 4,
});

export function extractGlmStreamText(message) {
  const delta = message?.choices?.[0]?.delta ?? {};
  return {
    reasoning: stringValue(delta.reasoning_content ?? delta.reasoning),
    content: stringValue(delta.content ?? message?.response),
  };
}

export function extractStreamUsage(message) {
  const usage = message?.usage;
  if (!usage || typeof usage !== "object") return null;
  const values = {
    promptTokens: numberValue(usage.prompt_tokens),
    completionTokens: numberValue(usage.completion_tokens),
    totalTokens: numberValue(usage.total_tokens),
    cachedTokens: numberValue(usage.prompt_tokens_details?.cached_tokens),
    neurons: numberValue(usage.neurons),
  };
  return Object.values(values).some(value => value !== null) ? values : null;
}

export function updateStreamUsage(current, message) {
  const incoming = extractStreamUsage(message);
  if (!incoming) return current;
  const text = extractGlmStreamText(message);
  const summary = !text.reasoning && !text.content;
  const next = current ? { ...current } : Object.fromEntries(
    usageNames.map(name => [name, null]),
  );
  for (const name of usageNames) {
    if (incoming[name] === null) continue;
    next[name] = summary ? incoming[name] : (next[name] ?? 0) + incoming[name];
  }
  return next;
}

export function formatUsageValue(value) {
  return usageFormatter.format(value);
}
