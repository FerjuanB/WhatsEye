# Project conventions

- Keep the probe local, small, and explicit. Do not add a frontend, database, message archive, or unrelated bot behavior.
- Never attach message listeners or stores for this presence-only task. Do not log raw Baileys payloads, message content, stack traces, credentials, QR data, or real account identifiers in fixtures or reports.
- Persist only Baileys authentication and Signal state in the ignored `auth_info/` directory. Keep participant identity indexes and alert deduplication state in memory.
- Resolve PN/LID identity only from group membership fields or verified Baileys mappings. Never infer equivalence from digit strings.
- Keep all notification destinations bound to the authenticated account. Alert messages are fixed text, disabled by default, and have no automatic retry after uncertain send failures.
- Validate command configuration before constructing a socket. Keep reconnects bounded and close the active socket on shutdown.
- Use Node's test runner through `npm test`; run `npm run typecheck` and `npm run build` for local source changes. Do not claim WhatsApp behavior is validated without real controlled accounts.
- Keep docs and source in English. Avoid recording production identifiers in committed examples.
