chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Error setting panel behavior:", error));
});

// Relay transcript lines from content.js directly to backend without CORS/loopback limits
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRANSCRIPT_LINE") {
    fetch("http://localhost:8080/api/transcript-line", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((res) => res.json())
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }
});