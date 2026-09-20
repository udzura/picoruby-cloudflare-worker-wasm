const form = document.querySelector("#rag");
const question = document.querySelector("#question");
const topK = document.querySelector("#top-k");
const send = document.querySelector("#send");
const stop = document.querySelector("#stop");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const answer = document.querySelector("#answer");
const usage = document.querySelector("#usage");
const sources = document.querySelector("#sources");
const events = document.querySelector("#events");
const usageNames = ["promptTokens", "completionTokens", "totalTokens", "cachedTokens", "neurons"];
const formatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 4 });
let active;
let answerText = "";
let streamEvents = [];
let usageTotals;
let pendingUsageMessage;

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function extractText(message) {
  const delta = message?.choices?.[0]?.delta ?? {};
  return {
    reasoning: typeof (delta.reasoning_content ?? delta.reasoning) === "string"
      ? (delta.reasoning_content ?? delta.reasoning) : "",
    content: typeof (delta.content ?? message?.response) === "string"
      ? (delta.content ?? message?.response) : "",
  };
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractUsage(message) {
  const value = message?.usage;
  if (!value || typeof value !== "object") return null;
  const extracted = {
    promptTokens: numberValue(value.prompt_tokens),
    completionTokens: numberValue(value.completion_tokens),
    totalTokens: numberValue(value.total_tokens),
    cachedTokens: numberValue(value.prompt_tokens_details?.cached_tokens),
    neurons: numberValue(value.neurons),
  };
  return Object.values(extracted).some(item => item !== null) ? extracted : null;
}

function updateUsage(message, replace = false) {
  const incoming = extractUsage(message);
  if (!incoming) return;
  const next = usageTotals ? { ...usageTotals } : Object.fromEntries(usageNames.map(name => [name, null]));
  for (const name of usageNames) {
    if (incoming[name] !== null) next[name] = replace ? incoming[name] : (next[name] ?? 0) + incoming[name];
  }
  usageTotals = next;
  const parts = [];
  if (next.promptTokens !== null) parts.push(`Input ${formatter.format(next.promptTokens)}`);
  if (next.completionTokens !== null) parts.push(`Output ${formatter.format(next.completionTokens)}`);
  if (next.totalTokens !== null) parts.push(`Total ${formatter.format(next.totalTokens)}`);
  if (next.cachedTokens !== null) parts.push(`Cached ${formatter.format(next.cachedTokens)}`);
  if (next.neurons !== null) parts.push(`Total neurons ${formatter.format(next.neurons)}`);
  usage.textContent = parts.length ? `Usage: ${parts.join(" / ")}` : "";
}

function isUsageOnly(message) {
  const text = extractText(message);
  return extractUsage(message) !== null && !text.reasoning && !text.content;
}

function renderAnswer() {
  answer.replaceChildren();
  let index = 0;
  for (const match of answerText.matchAll(/\[(\d+)\]/g)) {
    answer.append(document.createTextNode(answerText.slice(index, match.index)));
    const citation = document.createElement("button");
    citation.type = "button";
    citation.className = "citation";
    citation.textContent = match[0];
    citation.addEventListener("click", () => {
      const source = document.querySelector(`#source-${match[1]}`);
      source?.scrollIntoView({ behavior: "smooth", block: "center" });
      source?.classList.add("flash");
      setTimeout(() => source?.classList.remove("flash"), 1200);
    });
    answer.append(citation);
    index = match.index + match[0].length;
  }
  answer.append(document.createTextNode(answerText.slice(index)));
}

function renderSources(values) {
  sources.replaceChildren();
  values.forEach((source, index) => {
    const item = document.createElement("li");
    item.id = `source-${index + 1}`;
    const title = document.createElement("strong");
    title.textContent = source.title || source.id || "(untitled)";
    const meta = document.createElement("div");
    meta.className = "source-meta";
    meta.textContent = `id: ${source.id ?? "-"} / score: ${Number(source.score).toFixed(4)}`;
    const text = document.createElement("p");
    text.className = "source-text";
    text.textContent = source.text || "";
    item.append(title, meta, text);
    sources.append(item);
  });
}

async function fetchJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: active.signal,
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}

async function readStream(response) {
  if (!response.body) throw new Error("The response has no stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let complete = false;
  try {
    while (!complete) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const event = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          if (pendingUsageMessage) updateUsage(pendingUsageMessage, true);
          pendingUsageMessage = null;
          complete = true;
          break;
        }
        const message = JSON.parse(data);
        if (message.error) throw new Error("The AI returned an error");
        streamEvents.push(message);
        if (pendingUsageMessage) updateUsage(pendingUsageMessage);
        pendingUsageMessage = isUsageOnly(message) ? message : null;
        if (!pendingUsageMessage) updateUsage(message);
        const text = extractText(message);
        if (text.reasoning) setStatus("Reasoning…");
        if (text.content) {
          answerText += text.content;
          renderAnswer();
          setStatus("Generating answer…");
        }
      }
      if (done) {
        if (!complete) throw new Error("The connection closed before the completion event");
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

stop.addEventListener("click", () => active?.abort());
form.addEventListener("submit", async event => {
  event.preventDefault();
  const prompt = question.value.trim();
  const limit = Number(topK.value) || 5;
  if (!prompt) return setStatus("Enter a question.", true);

  active = new AbortController();
  const timeout = setTimeout(() => active?.abort(), 30_000);
  send.disabled = true;
  stop.disabled = false;
  answerText = "";
  streamEvents = [];
  usageTotals = null;
  pendingUsageMessage = null;
  renderAnswer();
  usage.textContent = "";
  events.textContent = "";
  result.hidden = true;
  setStatus("Searching source documents…");
  try {
    const search = await fetchJson("/api/search", { query: prompt, top_k: limit });
    const sourceList = Array.isArray(search.sources) ? search.sources : [];
    renderSources(sourceList);
    result.hidden = false;
    setStatus("Generating answer…");
    const response = await fetch("/api/rag", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: prompt, top_k: limit }),
      signal: active.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("The response is not SSE");
    }
    await readStream(response);
    events.textContent = JSON.stringify({ question: prompt, sources: sourceList, events: streamEvents }, null, 2);
    setStatus("Complete.");
  } catch (error) {
    setStatus(error.name === "AbortError" ? "Stopped." : `Request failed: ${error.message}`, true);
  } finally {
    clearTimeout(timeout);
    active = null;
    send.disabled = false;
    stop.disabled = true;
  }
});
