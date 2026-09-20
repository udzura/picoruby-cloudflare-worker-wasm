import assert from "node:assert/strict";
import {
  extractGlmStreamText,
  extractStreamUsage,
} from "../../examples/ai-stream/public/glm-stream.js";

const reasoning = extractGlmStreamText({
  choices: [{ delta: { reasoning: "い物", reasoning_content: "い物" } }],
});
assert.deepEqual(reasoning, { reasoning: "い物", content: "" });

const content = extractGlmStreamText({
  choices: [{ delta: { content: "開発しました", reasoning_content: null } }],
});
assert.deepEqual(content, { reasoning: "", content: "開発しました" });

const reasoningFallback = extractGlmStreamText({
  choices: [{ delta: { reasoning: "考えています" } }],
});
assert.deepEqual(reasoningFallback, { reasoning: "考えています", content: "" });

const legacyContent = extractGlmStreamText({ response: "legacy" });
assert.deepEqual(legacyContent, { reasoning: "", content: "legacy" });

const usage = extractStreamUsage({
  response: "",
  usage: {
    prompt_tokens: 44,
    completion_tokens: 143,
    total_tokens: 187,
    prompt_tokens_details: { cached_tokens: 0 },
    neurons: 5.167315971106291,
  },
});
assert.deepEqual(usage, {
  promptTokens: 44,
  completionTokens: 143,
  totalTokens: 187,
  cachedTokens: 0,
  neurons: 5.167315971106291,
});
assert.equal(extractStreamUsage({ response: "" }), null);

console.log("AI stream client: reasoning, output and usage remain separate");
