# Project conventions

- Keep the probe local, small, and explicit. Do not add a frontend, database, message archive, or unrelated bot behavior.
- Never attach message listeners or stores for this presence-only task. Do not log raw Baileys payloads, message content, stack traces, credentials, QR data, or real account identifiers in fixtures or reports.
- Persist only Baileys authentication and Signal state in the selected ignored top-level `auth_*/` directory (`AUTH_DIR`, default `auth_info`). Keep participant identity indexes and alert deduplication state in memory.
- Resolve PN/LID identity only from group membership fields or verified Baileys mappings. Never infer equivalence from digit strings.
- Keep alert destinations explicit and opt-in. `ALERT_TO_SELF` preserves the legacy self-chat destination; `ALERT_TO_JID` selects a separate phone-number recipient for a verified group target. `alert-test` sends fixed text only when explicitly enabled. Alert messages have no automatic retry after uncertain send failures.
- Do not change, clean, or reuse an existing authentication directory when setting up a second sender; choose a new safe `AUTH_DIR` beginning with `auth_`.
- Validate command configuration before constructing a socket. Keep reconnects bounded and close the active socket on shutdown.
- Use Node's test runner through `npm test`; run `npm run typecheck` and `npm run build` for local source changes. Do not claim WhatsApp behavior is validated without real controlled accounts.
- Keep docs and source in English. Avoid recording production identifiers in committed examples.
