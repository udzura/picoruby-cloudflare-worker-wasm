const form = document.querySelector("#classify-form");
const button = form.querySelector("button");
const status = document.querySelector("#status");
const results = document.querySelector("#results");

form.addEventListener("submit", async event => {
  event.preventDefault();
  button.disabled = true;
  results.hidden = true;
  status.textContent = "Classifying…";
  try {
    const response = await fetch("/api/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: form.elements.text.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Classification failed");
    if (!Array.isArray(data) || data.length === 0 || data.some(item =>
      typeof item.label !== "string" || typeof item.score !== "number" ||
      !Number.isFinite(item.score) || item.score < 0 || item.score > 1)) {
      throw new Error("Unexpected classification response");
    }
    const ranked = [...data].sort((a, b) => b.score - a.score);
    document.querySelector("#sentiment").textContent = ranked[0].label;
    const scores = document.querySelector("#scores");
    scores.replaceChildren();
    for (const item of ranked) {
      const row = document.createElement("div");
      row.className = "score";
      const caption = document.createElement("p");
      const label = document.createElement("span");
      label.textContent = item.label;
      const value = document.createElement("span");
      value.textContent = `${(item.score * 100).toFixed(1)}%`;
      caption.append(label, value);
      const bar = document.createElement("progress");
      bar.max = 1;
      bar.value = item.score;
      bar.setAttribute("aria-label", `${item.label} confidence`);
      row.append(caption, bar);
      scores.append(row);
    }
    results.hidden = false;
    status.textContent = "Classification complete.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

const selectForm = document.querySelector("#select-form");
const selectButton = selectForm.querySelector("button");
const selectionStatus = document.querySelector("#selection-status");
const selectionResults = document.querySelector("#selection-results");

selectForm.addEventListener("submit", async event => {
  event.preventDefault();
  selectButton.disabled = true;
  selectionResults.hidden = true;
  selectionStatus.textContent = "Ranking choices…";
  // Keep this request's choices so editing the form cannot change the ID mapping.
  const choices = selectForm.elements.choices.value.split(/\r?\n/)
    .map(choice => choice.trim()).filter(Boolean);
  try {
    if (choices.length < 2 || choices.length > 20) {
      throw new Error("Enter 2 to 20 choices, one per line.");
    }
    const response = await fetch("/api/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: selectForm.elements.query.value, choices }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Choice selection failed");
    const ranking = data.response;
    if (!Array.isArray(ranking) || ranking.length !== choices.length ||
      new Set(ranking.map(item => item?.id)).size !== choices.length ||
      ranking.some(item => !Number.isInteger(item?.id) || item.id < 0 ||
        item.id >= choices.length || !Number.isFinite(item.score))) {
      throw new Error("Unexpected ranking response");
    }
    const ranked = [...ranking].sort((a, b) => b.score - a.score);
    document.querySelector("#selected-choice").textContent = choices[ranked[0].id];
    const list = document.querySelector("#ranked-choices");
    list.replaceChildren();
    for (const item of ranked) {
      const row = document.createElement("li");
      row.textContent = `${choices[item.id]} — relevance: ${item.score.toFixed(4)}`;
      list.append(row);
    }
    selectionResults.hidden = false;
    selectionStatus.textContent = "Choice ranking complete.";
  } catch (error) {
    selectionStatus.textContent = error.message;
  } finally {
    selectButton.disabled = false;
  }
});
