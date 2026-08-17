---
phase: quick-260817-um3
plan: 01
subsystem: landing-page-chat
tags: [ai-chat, prompt, timezone, bugfix]
status: complete
requires: []
provides:
  - "buildSystemPrompt(now) — per-request chat AI system prompt carrying the salon-local date"
affects:
  - landing-page/lib/chat-ai.ts
tech-stack:
  added: []
  patterns:
    - "Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', ... }) for Weekday, yyyy-MM-dd"
    - "standalone .mjs self-check run by plain node, formatter inlined"
key-files:
  created:
    - landing-page/lib/chat-ai.selfcheck.mjs
  modified:
    - landing-page/lib/chat-ai.ts
decisions:
  - "Formatter built once at module scope; only .format(now) is per-request — the date string is never held in a module-level binding."
  - "SALON_TIME_ZONE duplicated (~5 lines) rather than exported from chat.ts, keeping the server-side AI path decoupled from the client-side fallback module's fetch surface."
  - "en-CA locale collapses chat.ts's formatToParts reassembly into one .format() call — no parts-walking helper needed."
metrics:
  duration: 12min
  completed: 2026-08-17
---

# Quick Task 260817-um3: Inject Salon-Local Current Date Into Chat AI Prompt

Chat AI system prompt now states the current Asia/Yangon calendar date per request, so relative dates ("tomorrow") resolve from reality instead of training-data guesses.

## What Was Built

**Task 1 — `landing-page/lib/chat-ai.ts`** (commit `1d7f807`)

The module-level `SYSTEM_PROMPT` const became `buildSystemPrompt(now: Date): string`, called inside `runBookingAssistantAi()` with `new Date()` at the start of each request. Added alongside it: `SALON_TIME_ZONE = "Asia/Yangon"` and a module-scope `SALON_DATE_FORMAT` (`Intl.DateTimeFormat("en-CA", { timeZone, weekday, year, month, day })`, which renders `Tuesday, 2026-08-18`).

One new rule bullet leads the list:

> Today is {Weekday, yyyy-MM-dd} in Asia/Yangon. Resolve today, tomorrow, this weekend, next Friday and every other relative date from that date, and treat no other date as the current date. Compute the date argument for get_available_slots from it.

All pre-existing bullets kept word-for-word and in order. `TOOLS`, the tool loop, `MAX_TOOL_ROUNDS`, and `route.ts` untouched.

**Task 2 — `landing-page/lib/chat-ai.selfcheck.mjs`** (commit `ebaad9b`)

Mirrors the `lib/chat.selfcheck.mjs` convention (plain `node`, `node:assert/strict`, inlined formatter). Three assertions against fixed instants: the exact `Tuesday, 2026-08-18` shape for `2026-08-17T18:00:00Z`, plus the pair proving the calendar day rolls at 17:30Z (`…17:00:00Z` → `2026-08-17`, `…18:00:00Z` → `2026-08-18`).

## Verification

- `cd landing-page && npx tsc --noEmit` → `TSC_OK`, 0 errors.
- `cd landing-page && node lib/chat-ai.selfcheck.mjs` → `chat-ai.selfcheck: all assertions passed`, `EXIT=0`.
- Negative spot-check: same formatter without `timeZone`, under `TZ=UTC`, formats `2026-08-17T18:00:00Z` as `Monday, 2026-08-17` — Test 2 would fail. Reverted (only run as an inline `node -e`, the file was never edited).
- Grep markers: `Asia/Yangon` ×2, `buildSystemPrompt` ×2, `en-CA` ×2 in `lib/chat-ai.ts`.
- `landing-page/lib/chat.ts` unmodified by this task.
- Manual check (requires `HF_TOKEN`) not run — see Deferred.

## Deviations from Plan

**1. [Scope boundary] `npm run lint` not run**

- **Found during:** final verification (verification step 3).
- **Issue:** `landing-page` has no ESLint config; `next lint` drops into an interactive "How would you like to configure ESLint?" setup prompt and never lints. Pre-existing, unrelated to this task.
- **Action:** none — out of scope, not auto-fixed. `npx tsc --noEmit` covers static checking for the changed file.

**2. [Note] Task 1 commit shows the whole file as added**

`landing-page/lib/chat-ai.ts` was untracked in the working tree before this task (part of an in-flight MCP branch), so commit `1d7f807` records 240 insertions rather than a small diff. The logical change is the ~20 lines described above.

## Deferred

- Manual browser check (`HF_TOKEN` + `npm run dev`, ask "do you have any slots tomorrow?") — the human-check leg of Task 1's verify block. Requires a token not present in this environment.

## Self-Check: PASSED

- FOUND: landing-page/lib/chat-ai.ts
- FOUND: landing-page/lib/chat-ai.selfcheck.mjs
- FOUND: commit 1d7f807
- FOUND: commit ebaad9b
