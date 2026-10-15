# Telegram alerts

## Objective
Add an opt-in Telegram destination for the watch presence alert, so the alert reaches the user's phone as a push from a different app even when the WhatsApp account that runs the bot is the user's own.

## Problem
Alerts sent from the watching account to itself arrive without a push notification, and the linked client must stay `available` to receive composing events. A separate app avoids both limits. Evidence is inferred from dates and Baileys README (lines 278-279, 801); not validated on a real iPhone.

## Scope
- New env vars: `ALERT_TO_TELEGRAM=true` (opt-in), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- Telegram is an additional destination to `ALERT_TO_SELF` / `ALERT_TO_JID`; it may be used alone or combined.
- Watch command only. Fixed alert text only (`PRESENCE_ALERT_TEXT`). No automatic retry after an uncertain failure.
- No new dependency (Node `fetch`). Never log the token, request URL, response body or error details.

## Constraints
- Follow AGENTS.md: no listeners/stores for messages, validate config before constructing a socket, English docs and source, no production identifiers in examples.

## Tasks
- [x] T1 Config: parse and validate the Telegram variables (RED tests first in `test/config.test.ts`).
  - Evidence: RED observed (4 new config tests failed before implementation); `npm test` 54/54 pass after.
- [x] T2 Sender: `src/telegram.ts` fixed-text sender with injectable fetch, timeout, no secret leakage (RED tests first).
  - Evidence: RED observed (`test/telegram.test.ts` failed on the missing module); fake-fetch and fan-out tests pass.
- [x] T3 Runtime: fan the alert out to every configured destination; count attempts/successes/failures per alert; notifier works with Telegram-only.
  - Evidence: `sendToDestinations` unit-tested; `runWatch` wiring checked by `npm run typecheck` and `npm run build` only (socket-bound, no unit test). Cooldown starts when at least one destination succeeds.
- [ ] T4 Docs: README, `.env.example` (create if missing), `cli.ts` help text.
  - Evidence: README section/table rows and `cli.ts` help done. `.env.example` NOT updated: the file exists but read/edit/append were denied by permission settings; pending parent action (append `ALERT_TO_TELEGRAM=false`, `TELEGRAM_BOT_TOKEN=`, `TELEGRAM_CHAT_ID=`).

## Acceptance criteria
- `npm test`, `npm run typecheck`, `npm run build` pass.
- Misconfiguration fails before any socket is created, with messages that never echo the token.
- Telegram-only watch mode (no `ALERT_TO_SELF`/`ALERT_TO_JID`) still requires `TARGET_JID` and sends alerts.

## Route declaration
T1-T4: delegated direct, one writer (4 non-trivial files; reading prepares the write).

## Delivery
Strategy: `ask-on-risk`. Forecast well under 400 authored changed lines; single slice.

## Progress
Branch `feat/telegram-alerts` created from `fix/watch-presence-detection`. Writer not yet launched.

## Next step
Launch the writer and verify.
