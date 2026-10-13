# Watch presence detection fixes

## Objective

Make `watch` actually receive the target's composing events and stop alerting on a single keystroke.

## Problem

On the deployed machine the watcher did not detect typing, and when it did alert, the alert fired on the very first composing event.

## Why

- The watcher marks the account `unavailable`; WhatsApp is expected to forward chat states only to available clients (server behavior, not verifiable offline).
- The `presence.update` listener is attached after three awaited requests.
- The reconnect counter is cumulative, so a long-running watch exits after five disconnects.
- The alert has no confirmation window, and the cooldown is consumed before the send outcome is known and reset on every reconnect.

## Scope

`src/presence.ts`, `src/runtime.ts`, `src/config.ts`, their tests, `README.md`, `.env.example`.

## Constraints

- No message listeners or stores; presence only (AGENTS.md).
- No automatic retry of an uncertain send within the same composing episode.
- Reconnects stay bounded.
- Live WhatsApp behavior is not validated by these changes.

## Tasks

- [x] T1 (commit a9be48c) — Notifier: confirmation window, cooldown consumed only on success, cooldown shared across reconnects. Route: inline (one source file plus its test).
- [x] T2 (commit 33656f0) — Watch runtime: announce `available`, warn when the account name is missing, attach the listener before subscribing, reset reconnects after a stable connection, `ALERT_CONFIRM_SECONDS` setting, docs. Route: inline (parent already holds the full context from the review; no further mapping needed).

## Acceptance criteria

- A composing event followed by a non-composing event inside the confirmation window sends nothing.
- A failed send does not start the cooldown; continuous composing still does not retry.
- A new socket after a reconnect honors the previous alert's cooldown.
- A connection that stayed up for at least one minute resets the reconnect counter.
- `npm test`, `npm run typecheck`, `npm run build` pass.

## Delivery

Forecast: about 250 authored changed lines; strategy `ask-on-risk`, single PR.

## Progress

- T1 and T2 done. RED observed first (missing `nextReconnectCount` export failed the suite), then GREEN.
- Checks observed: `npm test` 37 passed, 0 failed; `npm run typecheck` clean; `npm run build` clean.
- Running count: 207 changed lines across 8 files.
- A failed send no longer starts the cooldown; an alert in a later composing episode is a new trigger, not a retry of the uncertain one.
- Review `review-71a504b454ac00cb` (reliability lens): approved and acknowledged after one bounded correction, commit b55b6e5 (a socket that never opened counts as zero uptime).
- Follow-up from the review's advisory findings: the `resolveAuthDirectory` test no longer hard-codes a Windows path, so `npm test` is portable to Linux.
- Advisory findings left open: `unpair` does not persist `creds.update`; `unpair` removes `AUTH_DIR` before closing the socket; watch startup ordering has no fake-socket test.
- Pending: live validation with real controlled accounts (availability requirement, confirmation window default of 5 seconds).
