const BACKEND_HTTP = "http://localhost:8080";
const BACKEND_WS = "ws://localhost:8080";

const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const questionsEl = document.getElementById("questions");
const resultsSection = document.getElementById("resultsSection");

let ws;

function connect() {
  ws = new WebSocket(BACKEND_WS);

  ws.onopen = () => (statusEl.textContent = "Connected to backend.");
  ws.onclose = () => {
    statusEl.textContent = "Disconnected. Retrying in 2s...";
    setTimeout(connect, 2000);
  };
  ws.onerror = () => (statusEl.textContent = "Connection error - is the backend running on :8080?");

  ws.onmessage = (event) => {
    const { type, payload } = JSON.parse(event.data);
    switch (type) {
      case "snapshot":
        renderSnapshot(payload);
        break;
      case "transcript_line":
        appendTranscriptLine(payload);
        break;
      case "clarification_questions":
        payload.forEach(appendQuestion);
        break;
      case "clarification_answered":
        removeQuestion(payload.id);
        break;
      case "requirements_ready":
        renderResults(payload);
        break;
      case "reset":
        transcriptEl.innerHTML = "";
        questionsEl.innerHTML = "";
        resultsSection.style.display = "none";
        break;
      case "error":
        statusEl.textContent = `Error in ${payload.stage}: ${payload.message}`;
        break;
    }
  };
}

function renderSnapshot(state) {
  transcriptEl.innerHTML = "";
  state.transcriptLines.forEach(appendTranscriptLine);
  questionsEl.innerHTML = "";
  state.openAmbiguities.forEach(appendQuestion);
  if (state.requirementsWithout && state.requirementsWith && state.evaluation) {
    renderResults({
      withoutClar: state.requirementsWithout,
      withClar: state.requirementsWith,
      evaluation: state.evaluation,
    });
  }
}

function appendTranscriptLine(line) {
  const div = document.createElement("div");
  div.className = "transcript-line";
  div.innerHTML = `<b>${escapeHtml(line.speaker)}:</b> ${escapeHtml(line.text)}`;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function appendQuestion(q) {
  if (document.getElementById(`q-${q.id}`)) return;
  const div = document.createElement("div");
  div.className = "question-card";
  div.id = `q-${q.id}`;
  div.innerHTML = `
    <div><b>${escapeHtml(q.issue_type)}</b>: ${escapeHtml(q.clarification_question)}</div>
    <div style="color:#9aa0a6; font-size:11px;">Re: "${escapeHtml(q.source_statement)}"</div>
    <textarea rows="2" placeholder="Stakeholder's answer..."></textarea>
    <button class="answer-btn">Submit Answer</button>
  `;
  div.querySelector(".answer-btn").addEventListener("click", async () => {
    const answer = div.querySelector("textarea").value.trim();
    if (!answer) return;
    await fetch(`${BACKEND_HTTP}/api/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: q.id, answer }),
    });
  });
  questionsEl.appendChild(div);
}

function removeQuestion(id) {
  const el = document.getElementById(`q-${id}`);
  if (el) el.remove();
}

function renderResults({ withoutClar, withClar, evaluation }) {
  resultsSection.style.display = "block";
  document.getElementById("tab-without").innerHTML = renderReqSet(withoutClar);
  document.getElementById("tab-with").innerHTML = renderReqSet(withClar);
  document.getElementById("tab-eval").innerHTML = renderEvaluation(evaluation);
}

function renderReqSet(set) {
  const frs = (set.functional_requirements || [])
    .map((fr) => `<div class="req-item"><b>${fr.id}</b> ${escapeHtml(fr.text)}${fr.is_vague ? '<span class="vague-tag">VAGUE</span>' : ""}</div>`)
    .join("");
  const nfrs = (set.non_functional_requirements || [])
    .map((n) => `<div class="req-item"><b>${n.id}</b> [${escapeHtml(n.category)}] ${escapeHtml(n.text)}${n.is_vague ? '<span class="vague-tag">VAGUE</span>' : ""}</div>`)
    .join("");
  return `<h3>Functional</h3>${frs || "<i>None</i>"}<h3>Non-Functional</h3>${nfrs || "<i>None</i>"}`;
}

function renderEvaluation(evalData) {
  const row = (label, obj) => `
    <tr><td>${label}</td><td>${obj.completeness}</td><td>${obj.unambiguity}</td>
    <td>${obj.testability}</td><td>${obj.consistency}</td><td>${obj.traceability}</td>
    <td><b>${obj.overall_score}</b></td></tr>`;
  return `
    <table style="width:100%; text-align:center; border-collapse: collapse;">
      <tr><th>Set</th><th>Complete</th><th>Unambig.</th><th>Testable</th><th>Consistent</th><th>Traceable</th><th>Overall</th></tr>
      ${row("Without", evalData.without_clarification)}
      ${row("With", evalData.with_clarification)}
    </table>
    <h3>Improvements</h3>
    <ul>${(evalData.improvements || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- Buttons ----------
document.getElementById("startDemoBtn").addEventListener("click", () => {
  fetch(`${BACKEND_HTTP}/api/start-demo`, { method: "POST" });
});

document.getElementById("resetBtn").addEventListener("click", () => {
  fetch(`${BACKEND_HTTP}/api/reset`, { method: "POST" });
});

document.getElementById("generateBtn").addEventListener("click", async () => {
  statusEl.textContent = "Generating requirements (calling Gemini)...";
  const res = await fetch(`${BACKEND_HTTP}/api/generate-requirements`, { method: "POST" });
  statusEl.textContent = res.ok ? "Connected to backend." : "Generation failed - check backend logs.";
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

document.querySelectorAll(".export-row button[data-format]").forEach((btn) => {
  btn.addEventListener("click", () => {
    window.open(`${BACKEND_HTTP}/api/export/${btn.dataset.format}`, "_blank");
  });
});

connect();
