// Real Zoom RTMS (Realtime Media Streams) integration - the official Zoom API for
// getting live transcript data out of a meeting as it happens.
//
// PREREQUISITES (see README.md for full setup):
//   1. Create a "General App" in the Zoom App Marketplace (developers.zoom.us)
//   2. Enable the RTMS feature + scope `meeting:read:meeting_transcripts`
//   3. Enable RTMS at the account/group level for the Zoom account that will HOST
//      the meeting (Settings > In Meeting (Advanced) > Realtime Media Streams).
//      This is an org-admin setting - if you're on a free/student Zoom account you
//      may need Zoom's dev/sandbox account tier, since RTMS consumes credits.
//   4. Point the app's "Event notification endpoint URL" at https://<your-ngrok>/zoom-webhook
//   5. Subscribe to meeting.rtms_started and meeting.rtms_stopped events
//
// This module wires Zoom's official @zoom/rtms SDK to a single callback so the
// rest of the pipeline (gemini.js) doesn't care whether lines came from a real
// meeting or the demo simulator.

import rtms from "@zoom/rtms";

/**
 * @param {(line: {speaker: string, text: string}) => void} onLine
 */
export function startZoomRtms(onLine) {
  rtms.onWebhookEvent(({ event, payload }) => {
    console.log("[zoom webhook]", event);

    if (event === "meeting.rtms_started") {
      const client = new rtms.Client();

      client.onTranscriptData((data, size, timestamp, metadata) => {
        onLine({
          speaker: metadata?.userName || "unknown",
          text: data.toString(),
          timestamp,
        });
      });

      client.join(payload);
    }

    if (event === "meeting.rtms_stopped") {
      console.log("[zoom webhook] RTMS stream stopped for", payload?.meeting_uuid);
    }
  });

  console.log("[zoom] RTMS webhook handler registered. Waiting for a meeting to start...");
}
