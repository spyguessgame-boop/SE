import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;
// Using gemini-2.5-flash by default as it has significantly higher availability & quota on free tier
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const FALLBACK_MODEL = "gemini-3.6-flash";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Low-level call to Gemini with exponential backoff & model failover.
 * Handles 429 (Rate Limit) and 503 (Overloaded) automatically.
 */
async function callGemini(systemPrompt, userPrompt, { temperature = 0.3 } = {}, maxRetries = 3) {
  if (!API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Copy .env.example to .env and fill it in.");
  }

  let currentModel = PRIMARY_MODEL;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent`;

    const body = {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
      },
    };

    try {
      const res = await fetch(`${baseUrl}?key=${API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        let retryDelayMs = null;

        // Try extracting Google's suggested retry delay if provided
        try {
          const parsedErr = JSON.parse(errText);
          const retryInfo = parsedErr?.error?.details?.find(
            (d) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
          );
          if (retryInfo?.retryDelay) {
            const seconds = parseFloat(retryInfo.retryDelay.replace("s", ""));
            if (!isNaN(seconds)) retryDelayMs = (seconds + 1) * 1000;
          }
        } catch (_) {}

        // Handle 429 (Rate Limit) or 503 (High demand / Server overloaded)
        if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
          const waitTime = retryDelayMs || Math.pow(2, attempt) * 2000;
          console.warn(
            `[Gemini ${res.status}] Attempt ${attempt} failed on ${currentModel}. Retrying in ${Math.round(waitTime / 1000)}s...`
          );

          // If 503 persists on attempt 2, pivot to the backup model
          if (res.status === 503 && attempt === 2) {
            currentModel = FALLBACK_MODEL;
            console.warn(`Switching to fallback model: ${FALLBACK_MODEL}`);
          }

          await sleep(waitTime);
          continue;
        }

        throw new Error(`Gemini API error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";

      // Strip markdown code fences in case model wraps output
      const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();

      return JSON.parse(cleaned);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      // If error was a JSON parse error or fetch network glitch, retry with standard backoff
      if (!err.message?.includes("Gemini API error")) {
        console.warn(`[Network/Parse error] Attempt ${attempt}: ${err.message}. Retrying in 2s...`);
        await sleep(2000);
      } else {
        throw err;
      }
    }
  }
}

/**
 * Stage 1: Identify ambiguous / vague statements and produce clarification questions.
 */
export async function detectAmbiguitiesAndAskQuestions(transcriptSoFar) {
  const system = `You are a requirements analyst assistant embedded in a live meeting.
You read a running transcript of a stakeholder conversation about a software system.
Your job: find statements that are vague, incomplete, ambiguous, or under-specified with
respect to building software requirements (functional or non-functional), and produce
a short, specific clarification question for each one that a requirements analyst would
ask right now to pin it down.

Only flag things that actually matter for requirements (scope, behavior, quality
attributes, constraints, data, users, performance, security, etc.) - do not flag small talk.
Do not repeat a question about something that has already been clearly answered in the transcript.

Return JSON with this exact shape:
{
  "ambiguities": [
    {
      "id": "short-slug",
      "source_statement": "the vague statement, quoted or closely paraphrased",
      "speaker": "who said it if identifiable, else 'unknown'",
      "issue_type": "one of: vague_term | missing_detail | conflicting | unquantified | undefined_scope",
      "clarification_question": "the question to ask"
    }
  ]
}
If there is nothing worth flagging, return {"ambiguities": []}.`;

  const user = `TRANSCRIPT SO FAR:\n"""\n${transcriptSoFar}\n"""\n\nIdentify ambiguities and generate clarification questions.`;

  return callGemini(system, user, { temperature: 0.2 });
}

/**
 * Stage 2: Extract Functional and Non-Functional Requirements.
 */
export async function extractRequirements(fullTranscript, { withClarification }) {
  const system = `You are a requirements engineer. Read the meeting transcript and produce a clean set
of Functional Requirements (FR) and Non-Functional Requirements (NFR) for the system being discussed.

Rules:
- Each FR should describe a single, testable capability the system must provide.
- Each NFR must be categorized into one of: Security, Performance, Reliability, Fairness,
  Usability, Scalability, Maintainability, Compliance, Other.
- Write requirements the way a spec document would: clear, atomic, using "The system shall...".
- If the transcript is missing information needed to make a requirement concrete/testable,
  still write the requirement but mark it as vague (do not invent facts that were never discussed).
- ${
    withClarification
      ? "This transcript INCLUDES clarification Q&A - use those answers to make requirements as precise and testable as possible."
      : "This transcript does NOT include any clarification - write requirements strictly from what stakeholders said, even if that leaves them vague or incomplete."
  }

Return JSON with this exact shape:
{
  "functional_requirements": [
    { "id": "FR-1", "text": "The system shall...", "is_vague": false, "rationale": "brief note on where this came from" }
  ],
  "non_functional_requirements": [
    { "id": "NFR-1", "text": "The system shall...", "category": "Security", "is_vague": false, "rationale": "brief note" }
  ]
}`;

  const user = `TRANSCRIPT:\n"""\n${fullTranscript}\n"""\n\nExtract the requirements.`;

  return callGemini(system, user, { temperature: 0.3 });
}

/**
 * Stage 3: Evaluate and compare requirement quality metrics.
 */
export async function evaluateRequirementQuality(withoutClarSet, withClarSet) {
  const system = `You are a requirements quality auditor. You will be given two sets of requirements
(FR + NFR) for the same system: one generated WITHOUT stakeholder clarification, and one generated
WITH clarification via follow-up questions and answers.

Score each set (0-10, higher is better) on these standard requirement-quality dimensions:
- completeness: are important aspects of the system covered, with no obvious gaps?
- unambiguity: is each requirement interpretable in only one way (no vague terms like "fast", "good", "quick")?
- testability: could a QA engineer write a pass/fail test directly from each requirement?
- consistency: do requirements avoid contradicting each other?
- traceability: is it clear which stakeholder need each requirement maps back to?

Also give an overall_score (0-10) per set, and a short list of concrete improvements
observed going from "without" to "with" clarification.

Return JSON with this exact shape:
{
  "without_clarification": { "completeness": 0, "unambiguity": 0, "testability": 0, "consistency": 0, "traceability": 0, "overall_score": 0, "notes": "short note" },
  "with_clarification": { "completeness": 0, "unambiguity": 0, "testability": 0, "consistency": 0, "traceability": 0, "overall_score": 0, "notes": "short note" },
  "improvements": ["short bullet", "short bullet"]
}`;

  const user = `WITHOUT CLARIFICATION SET:\n${JSON.stringify(withoutClarSet, null, 2)}\n\nWITH CLARIFICATION SET:\n${JSON.stringify(withClarSet, null, 2)}\n\nEvaluate and compare.`;

  return callGemini(system, user, { temperature: 0.2 });
}