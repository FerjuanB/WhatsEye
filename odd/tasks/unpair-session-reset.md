# Unpair and start a fresh WhatsApp session

## Objective

Add an explicit `unpair` command that logs out the currently selected Baileys session and clears only its configured local authentication directory, so the next `pair` can link another phone. Make `pair` explain that an existing linked session must be removed with `unpair` before pairing a different phone.

## Problem and rationale

`pair` currently loads persisted credentials from `AUTH_DIR`, so it reconnects the previously linked account instead of presenting a new QR. There is no CLI command that performs an explicit logout and removes that session's local auth state.

## Scope and constraints

- Add the `unpair` CLI mode and document the workflow.
- Keep the cleanup scoped to the single validated `AUTH_DIR`; never touch another `auth_*` directory, `.env`, source files, or unrelated data.
- When `pair` finds registered credentials in the selected auth directory, print actionable guidance to run `unpair` and do not silently reuse that session for another pairing attempt.
- Never log credentials, account identifiers, QR contents, or raw Baileys payloads.
- Do not run `unpair`, scan a QR, or contact a real WhatsApp account during local verification.
- Preserve the existing `auth_info` session and all auth folders while implementing and testing.

## Tasks

- [x] T1 — Implement and test the `unpair` lifecycle, existing-session `pair` guard, and user documentation.

## Acceptance criteria

- `npm start -- unpair` waits for authenticated WhatsApp connection readiness before sending logout, then removes only the selected `AUTH_DIR` if Baileys' logout request resolves; failures are reported without claiming server-confirmed unlink.
- `npm start -- pair` detects a registered session and clearly directs the user to `unpair` before starting a different pairing.
- With no saved registered session, `pair` keeps its existing QR pairing behavior.
- CLI help and README explain that `unpair` is account-level logout and local cleanup, and that `AUTH_DIR` determines which session is affected.
- Automated tests cover the command routing/configuration and pairing guard without touching real auth state.

## Authorized scope

`src/cli.ts`, `src/config.ts`, `src/runtime.ts`, `test/config.test.ts`, `test/runtime.test.ts`, `README.md`, `odd/tasks/unpair-session-reset.md`.

## Route and delivery

- Route: delegated direct, one writer. The behavior spans CLI, auth lifecycle, tests, and documentation, so it is not a safe one-file mechanical edit.
- Trigger: multiple non-trivial files and reading that prepares implementation.
- Forecast: approximately 120 authored changed lines; one work-unit commit with tests and docs.
- Delivery strategy: single-pr.

## Verification

- Test-first: observe the relevant new test fail, implement, then verify green.
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm start -- --help`
- `git diff --check`
- Do not claim live WhatsApp logout or QR behavior validated; those require a controlled real account.

## Progress and evidence

- T1 implemented and corrected after independent inspection found that `waitForSocketOpen()` only waits for the WebSocket transport, not authenticated WhatsApp readiness.
- Presence procedure review passed offline: group filtering, participant PN/LID resolution, exact `composing` recognition, and deduplication are implemented. Live event delivery remains unverified.
- `unpair` waits for `connection.update` state `open`, bounded by a 30-second timeout; connection close and timeout remove the listener and preserve local auth. Logout request failure also preserves local auth.
- With no registered session, `unpair` clears only the validated selected `AUTH_DIR` locally and sends no remote request.
- The installed Baileys 7.0.0-rc14 `logout()` resolves after sending its request and ending the socket; it does not confirm a server acknowledgement. User-facing output states that the request was sent and server-side unlink is unconfirmed.
- Commit unavailable: `.git` is read-only in this environment, so no branch or commit was created.
- No live WhatsApp, `.env`, or existing auth directory was used.
- Next step: parent review and one structural spot check.

### Verification results

- `npm test` — passed; 31 tests, 0 failures. The regression-first run failed at the missing authenticated-readiness helper as expected.
- `npm run typecheck` — passed (`tsc --noEmit`).
- `npm run build` — passed (`tsc`).
- `npm start -- --help` — passed; help output includes `unpair`.
- `git diff --check` — passed with no whitespace errors.
- No pairing, logout command, QR scan, auth directory access, or real WhatsApp socket was used during verification.
