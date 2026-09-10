// Replays the sample Hiring-Manager / ML-Engineer conversation from the assignment
// line-by-line, on a timer, through the SAME onTranscriptLine callback that real
// Zoom RTMS data would use. This lets you demo the full pipeline without needing
// RTMS credits/approval enabled on a Zoom account.

export const SAMPLE_TRANSCRIPT = [
  { speaker: "Hiring Manager", text: "We need to build an AI-based resume analyzer that can automatically shortlist candidates for our software engineering roles." },
  { speaker: "ML Engineer", text: "Okay. How should the system decide which candidates to shortlist?" },
  { speaker: "Hiring Manager", text: "It should rank them based on relevance to the job description." },
  { speaker: "ML Engineer", text: "How are we defining relevance?" },
  { speaker: "Hiring Manager", text: "Mainly skills and experience. And overall profile strength." },
  { speaker: "ML Engineer", text: "What does overall profile strength include?" },
  { speaker: "Hiring Manager", text: "Things like good companies, solid projects, impactful work." },
  { speaker: "ML Engineer", text: "Should we prioritize years of experience?" },
  { speaker: "Hiring Manager", text: "Yes, but not strictly. Sometimes a strong fresher is better than someone with 5 average years." },
  { speaker: "ML Engineer", text: "Do we have historical hiring data to train the system?" },
  { speaker: "Hiring Manager", text: "We have past resumes and hiring decisions, but they're not very structured." },
  { speaker: "ML Engineer", text: "How accurate should the system be?" },
  { speaker: "Hiring Manager", text: "It should be good enough so that HR trusts it." },
  { speaker: "ML Engineer", text: "Do we need explainability? For example, why a candidate was ranked higher?" },
  { speaker: "Hiring Manager", text: "Yes, that would be useful." },
  { speaker: "ML Engineer", text: "Are there any constraints regarding bias or fairness?" },
  { speaker: "Hiring Manager", text: "Yes, we must avoid bias, especially related to gender or college background." },
  { speaker: "ML Engineer", text: "Should the system process resumes in real-time or batch mode?" },
  { speaker: "Hiring Manager", text: "It shouldn't be slow." },
  { speaker: "ML Engineer", text: "What is the expected response time per resume?" },
  { speaker: "Hiring Manager", text: "Ideally quick." },
  { speaker: "ML Engineer", text: "What is the timeline for delivery?" },
  { speaker: "Hiring Manager", text: "We need an MVP soon." },
];

/**
 * @param {(line: {speaker: string, text: string}) => void} onLine
 * @param {number} intervalMs delay between lines, to feel "live"
 * @returns {() => void} stop function
 */
export function startSimulatedTranscript(onLine, intervalMs = 2500) {
  let i = 0;
  const timer = setInterval(() => {
    if (i >= SAMPLE_TRANSCRIPT.length) {
      clearInterval(timer);
      return;
    }
    onLine(SAMPLE_TRANSCRIPT[i]);
    i++;
  }, intervalMs);

  return () => clearInterval(timer);
}
