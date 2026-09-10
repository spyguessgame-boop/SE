import express from "express";
import cors from "cors";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

import {
  detectAmbiguitiesAndAskQuestions,
  extractRequirements,
  evaluateRequirementQuality,
} from "./gemini.js";
import { exportAsTxt, exportAsPdf, exportAsDocx } from "./exportReport.js";

const PORT = process.env.PORT || 8080;

const app = express();
app.use(cors());
app.use(express.json());

// In-memory session state
const state = {
  transcriptLines: [],
  openAmbiguities: [],
  answeredClarifications: [],
  requirementsWithout: null,
  requirementsWith: null,
  evaluation: null,
};

function fullTranscriptText() {
  return state.transcriptLines.map((l) => `${l.speaker}: ${l.text}`).join("\n");
}

function transcriptWithClarificationsText() {
  const clar = state.answeredClarifications
    .map((c) => `Clarification Q: ${c.question}\nClarification A: ${c.answer}`)
    .join("\n");
  return `${fullTranscriptText()}\n\n${clar}`;
}

// WebSocket Server
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "snapshot", payload: state }));
  ws.on("close", () => clients.delete(ws));
});

// Ambiguity Processing
let isCheckingAmbiguity = false;
let lastAnalyzedIndex = 0;
let ambiguityCooldownUntil = 0;

async function onNewTranscriptLine(line) {
  console.log(`[LIVE CAPTION RECEIVED] ${line.speaker}: ${line.text}`);
  state.transcriptLines.push(line);
  broadcast("transcript_line", line);

  scheduleAmbiguityCheck();
}

function scheduleAmbiguityCheck() {
  const now = Date.now();
  const delay = Math.max(0, ambiguityCooldownUntil - now);

  setTimeout(async () => {
    if (isCheckingAmbiguity) return;
    if (state.transcriptLines.length - lastAnalyzedIndex < 2) return;

    isCheckingAmbiguity = true;
    ambiguityCooldownUntil = Date.now() + 10000;

    await runAmbiguityCheck();
    isCheckingAmbiguity = false;
  }, delay);
}

async function runAmbiguityCheck() {
  try {
    const textToAnalyze = fullTranscriptText();
    lastAnalyzedIndex = state.transcriptLines.length;

    const result = await detectAmbiguitiesAndAskQuestions(textToAnalyze);
    const newOnes = (result.ambiguities || []).filter(
      (a) => !state.openAmbiguities.some((existing) => existing.id === a.id)
    );

    if (newOnes.length) {
      state.openAmbiguities.push(...newOnes);
      broadcast("clarification_questions", newOnes);
    }
  } catch (err) {
    console.error("Ambiguity check error:", err.message);
  }
}

// --- Live Google Meet Endpoint ---
app.post("/api/transcript-line", (req, res) => {
  const { speaker, text, timestamp } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided" });

  onNewTranscriptLine({
    speaker: speaker || "Participant",
    text: text.trim(),
    timestamp: timestamp || Date.now(),
  });
  res.json({ ok: true });
});

// Answer Clarifications
app.post("/api/answer", (req, res) => {
  const { id, answer } = req.body;
  const idx = state.openAmbiguities.findIndex((a) => a.id === id);
  if (idx === -1) return res.status(404).json({ error: "Question not found" });

  const [q] = state.openAmbiguities.splice(idx, 1);
  state.answeredClarifications.push({ question: q.clarification_question, answer });
  broadcast("clarification_answered", { id, answer });
  res.json({ ok: true });
});

// Requirements Generation
app.post("/api/generate-requirements", async (req, res) => {
  try {
    broadcast("status", { message: "Extracting base requirements..." });
    const withoutClar = await extractRequirements(fullTranscriptText(), { withClarification: false });
    state.requirementsWithout = withoutClar;

    await new Promise((r) => setTimeout(r, 2000));

    broadcast("status", { message: "Extracting clarified requirements..." });
    const withClar = await extractRequirements(transcriptWithClarificationsText(), { withClarification: true });
    state.requirementsWith = withClar;

    await new Promise((r) => setTimeout(r, 2000));

    broadcast("status", { message: "Evaluating quality..." });
    const evaluation = await evaluateRequirementQuality(withoutClar, withClar);
    state.evaluation = evaluation;

    broadcast("requirements_ready", { withoutClar, withClar, evaluation });
    res.json({ withoutClar, withClar, evaluation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/state", (req, res) => res.json(state));

app.post("/api/reset", (req, res) => {
  state.transcriptLines = [];
  state.openAmbiguities = [];
  state.answeredClarifications = [];
  state.requirementsWithout = null;
  state.requirementsWith = null;
  state.evaluation = null;
  lastAnalyzedIndex = 0;
  isCheckingAmbiguity = false;
  ambiguityCooldownUntil = 0;

  broadcast("reset", {});
  res.json({ ok: true });
});

app.get("/api/export/:format", async (req, res) => {
  const format = req.params.format;
  const dir = "./exports";
  fs.mkdirSync(dir, { recursive: true });
  const filename = `requirement-report-${Date.now()}.${format}`;
  const outPath = path.join(dir, filename);

  try {
    const payload = {
      withoutClar: state.requirementsWithout,
      withClar: state.requirementsWith,
      evaluation: state.evaluation,
    };
    if (format === "txt") exportAsTxt(payload, outPath);
    else if (format === "pdf") exportAsPdf(payload, outPath);
    else if (format === "docx") await exportAsDocx(payload, outPath);

    res.download(outPath, filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Mode: PURE LIVE (Listening to Meet Captions Only)`);
  console.log(`======================================================\n`);
});

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});