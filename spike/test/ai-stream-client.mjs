import assert from "node:assert/strict";
import {
  extractGlmStreamText,
  extractStreamUsage,
  formatUsageValue,
  isUsageOnlyStreamMessage,
  replaceStreamUsage,
  updateStreamUsage,
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

let runningUsage = updateStreamUsage(null, {
  choices: [{ delta: { reasoning_content: "考えています" } }],
  usage: {
    prompt_tokens: 0,
    completion_tokens: 2,
    total_tokens: 2,
    prompt_tokens_details: { cached_tokens: 0 },
    neurons: 0.072812345,
  },
});
runningUsage = updateStreamUsage(runningUsage, {
  choices: [{ delta: { content: "回答中" } }],
  usage: {
    prompt_tokens: 0,
    completion_tokens: 2,
    total_tokens: 2,
    prompt_tokens_details: { cached_tokens: 0 },
    neurons: 0.081234567,
  },
});
const { neurons: runningNeurons, ...runningTokens } = runningUsage;
assert.deepEqual(runningTokens, {
  promptTokens: 0,
  completionTokens: 4,
  totalTokens: 4,
  cachedTokens: 0,
});
assert.ok(Math.abs(runningNeurons - 0.154046912) < 1e-12);
assert.equal(formatUsageValue(runningNeurons), "0.154");

const emptyUsageEvent = {
  choices: [{ delta: {} }],
  usage: {
    prompt_tokens: 0,
    completion_tokens: 1,
    total_tokens: 1,
    prompt_tokens_details: { cached_tokens: 0 },
    neurons: 0.01,
  },
};
assert.equal(isUsageOnlyStreamMessage(emptyUsageEvent), true);
runningUsage = updateStreamUsage(runningUsage, emptyUsageEvent);
assert.equal(runningUsage.completionTokens, 5);
assert.equal(runningUsage.totalTokens, 5);
assert.ok(Math.abs(runningUsage.neurons - 0.164046912) < 1e-12);

const summaryEvent = {
  response: "",
  usage: {
    prompt_tokens: 44,
    completion_tokens: 143,
    total_tokens: 187,
    prompt_tokens_details: { cached_tokens: 0 },
    neurons: 5.167315971106291,
  },
};
assert.equal(isUsageOnlyStreamMessage(summaryEvent), true);
runningUsage = replaceStreamUsage(runningUsage, summaryEvent);
assert.deepEqual(runningUsage, usage);
assert.equal(formatUsageValue(runningUsage.neurons), "5.1673");
assert.equal(formatUsageValue(runningUsage.totalTokens), "187");

console.log("AI stream client: only the final usage event replaces provisional totals");
