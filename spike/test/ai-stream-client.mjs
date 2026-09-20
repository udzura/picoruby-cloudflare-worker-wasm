import assert from "node:assert/strict";
import { extractGlmStreamText } from "../../examples/ai-stream/public/glm-stream.js";

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

console.log("AI stream client: GLM reasoning and output chunks remain separate");
