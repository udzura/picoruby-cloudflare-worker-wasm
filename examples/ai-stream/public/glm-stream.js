function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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
