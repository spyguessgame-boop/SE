let seenTexts = new Set();

// List of common Google Meet UI strings to ignore
const UI_BLACKLIST = [
  "more_vert", "visual_effects", "mic_off", "mic", "videocam", "videocam_off",
  "Turn off", "Turn on", "Ready to join", "Switch account", "Meeting details",
  "Take notes", "Press the down arrow", "Share screen", "Send a reaction",
  "Raise hand", "Leave call", "Host controls", "Reframe", "Backgrounds",
  "Font size", "Font colour", "English", "Your meeting is safe", "Returning to home",
  "Camera is", "Microphone Array", "Headphones", "Speaker", "You've left"
];

function sendLineToBackground(speaker, text) {
  const clean = text.replace(/\s+/g, " ").trim();
  
  // Strict quality checks: length, duplicate filter, and UI blacklist check
  if (!clean || clean.length < 6 || seenTexts.has(clean)) return;
  if (UI_BLACKLIST.some((uiWord) => clean.toLowerCase().includes(uiWord.toLowerCase()))) return;

  seenTexts.add(clean);

  chrome.runtime.sendMessage(
    {
      type: "TRANSCRIPT_LINE",
      payload: {
        speaker: speaker || "Participant",
        text: clean,
        timestamp: Date.now(),
      },
    },
    () => {
      console.log(`%c[Speech Captured] ${speaker}: ${clean}`, "color: #00ff00; font-weight: bold;");
    }
  );
}

// 1. Target only dedicated Google Meet caption containers
function observeCaptions() {
  const observer = new MutationObserver(() => {
    // In-call caption wrapper elements
    const captionNodes = document.querySelectorAll(
      'div[jsname="ys01Ge"], div[class*="yg7t4e"], div[class*="bh44bd"], div[class*="VbkSUe"]'
    );

    captionNodes.forEach((node) => {
      const text = node.innerText?.trim();
      if (!text || text.length < 6) return;

      const parent = node.closest('div[jscontroller]') || node.parentElement;
      const speakerEl = parent?.querySelector('div[class*="zsT0bd"], span[class*="poTOCe"], div[class*="jT5e9"]');
      const speaker = speakerEl ? speakerEl.innerText.trim() : "Participant";

      if (text.length > 20 || /[.?!]$/.test(text)) {
        sendLineToBackground(speaker, text);
      }
    });
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// 2. High-accuracy Web Speech Recognition (Listens to microphone speech directly)
function startSpeechFallback() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        const transcript = event.results[i][0].transcript.trim();
        sendLineToBackground("Speaker", transcript);
      }
    }
  };

  recognition.onerror = () => {};
  recognition.onend = () => {
    try { recognition.start(); } catch (e) {}
  };

  try {
    recognition.start();
    console.log("[Requirement Analyzer] Speech capture running.");
  } catch (e) {}
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  observeCaptions();
  startSpeechFallback();
} else {
  document.addEventListener("DOMContentLoaded", () => {
    observeCaptions();
    startSpeechFallback();
  });
}