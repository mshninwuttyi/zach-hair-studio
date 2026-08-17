/**
 * Self-check for the salon-local date string embedded in the chat AI system prompt.
 * Run: node lib/chat-ai.selfcheck.mjs   (exits non-zero on failure)
 *
 * The formatter is inlined here rather than imported, because plain node cannot
 * load the .ts. Keep in sync with lib/chat-ai.ts.
 */
import assert from "node:assert/strict";

const SALON_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Yangon",
  weekday: "long",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Test 1: exact format shape — weekday, comma, yyyy-MM-dd ordering. The prompt rule
// and the get_available_slots date argument both depend on this.
assert.equal(
  SALON_DATE_FORMAT.format(new Date("2026-08-17T18:00:00Z")),
  "Tuesday, 2026-08-18"
);

// Test 2: the Yangon offset (UTC+06:30) is actually applied — the calendar day
// rolls at 17:30Z, not at UTC midnight. Fails if the timeZone option is dropped.
assert.match(
  SALON_DATE_FORMAT.format(new Date("2026-08-17T17:00:00Z")),
  /2026-08-17$/
);
assert.match(
  SALON_DATE_FORMAT.format(new Date("2026-08-17T18:00:00Z")),
  /2026-08-18$/
);

console.log("chat-ai.selfcheck: all assertions passed");
