function stringValue(value) {
  return typeof value === "string" ? value : "";
}

export function extractGlmStreamText(message) {
  const delta = message?.choices?.[0]?.delta ?? {};
  return {
    reasoning: stringValue(delta.reasoning_content ?? delta.reasoning),
    content: stringValue(delta.content ?? message?.response),
  };
}
