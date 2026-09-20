const form = document.querySelector("#chat");
const send = document.querySelector("#send");
const stop = document.querySelector("#stop");
const status = document.querySelector("#status");
const output = document.querySelector("#output");
let active;
stop.addEventListener("click", () => active?.abort());

form.addEventListener("submit", async event => {
  event.preventDefault();
  active = new AbortController();
  send.disabled = true;
  stop.disabled = false;
  output.textContent = "";
  status.textContent = "応答を待っています…";
  let reader;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: document.querySelector("#prompt").value,
      signal: active.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("SSE以外の応答を受信しました");
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let complete = false;
    while (!complete) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // SSE events and UTF-8 characters can span arbitrary network chunks.
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const event = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        if (data === "[DONE]") { complete = true; break; }
        const message = JSON.parse(data);
        if (message.error) throw new Error("AIがエラーを返しました");
        output.textContent += message.response ??
          message.choices?.[0]?.delta?.content ?? "";
        if (message.choices?.[0]?.delta?.reasoning_content) {
          status.textContent = "推論中…";
        } else {
          status.textContent = "受信中…";
        }
      }
      if (done) {
        if (!complete) throw new Error("完了通知の前に接続が終了しました");
        break;
      }
    }
    status.textContent = "完了しました。";
  } catch (error) {
    status.textContent = error.name === "AbortError" ? "停止しました。" : `受信エラー: ${error.message}`;
  } finally {
    if (reader) {
      await reader.cancel().catch(() => { });
      reader.releaseLock();
    }
    active = null;
    send.disabled = false;
    stop.disabled = true;
  }
});
