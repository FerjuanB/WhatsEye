# WhatsApp presence probe

## Objective and authorization

Investigate a local Baileys MVP that detects a selected group participant composing without sending a message, then sends a fixed alert to the authenticated account's own chat. The user authorizes local implementation and checks. QR pairing and two-account experiments require the user. No remote deployment or publication is authorized.

## Scope and constraints

No frontend, database, message archive, conversation logging, or message-content inspection. Persist only authentication/Signal state; identity and deduplication caches remain in memory. Pin Baileys 7.0.0-rc14 after inspecting installed compatibility. LIDs must remain usable without a phone mapping. Missing events and self-chat notifications must remain explicitly unvalidated until observed.

## Tasks

- [x] T1: Deliver SPEC.md, AGENTS.md, execution instructions, and a QR-authenticated presence probe with group/participant discovery, LID matching, opt-in self-alerts, deduplication, and offline checks.
- [ ] T2: Pair account A and execute the documented experiment with account B; record event availability, target discrimination, duplicate handling, reconnection and real mobile notification results.
- [x] T3: Show each joined group's name alongside its JID in the existing groups command so the user can select the group by name and configure the exact JID. No metadata export or message collection is requested.

## Routing and checks

T1 uses delegated direct: research and writing span multiple non-trivial files. A read-only explorer verified primary docs, npm tags, Node compatibility and APIs. One bounded writer implements; a separate verifier checks the final files. Deterministic identity/deduplication behavior uses observed RED then GREEN with Node's test runner; real socket behavior has no offline RED and remains pending.

T2 requires human intervention and cannot be replaced by synthetic tests. No system-wide validation claim is permitted before T2.

## Delivery

Strategy: single-pr (local feature only; no PR creation, push or merge authorized). Forecast: approximately 700 authored lines; coherence takes priority over the advisory 400-line heuristic. Work-unit commits use Conventional Commits without AI attribution, if Git initialization and identity are available. No existing Git repository was present. RDD is on by default; native applicability must be checked after implementation. A missing review or unavailable proof is reported honestly.

## Acceptance criteria

Presence output includes timestamps, group IDs, participant IDs and presence states only. The target can be a PN or LID; unknown mappings never imply a match. Repeated composing updates do not duplicate alerts, and missing paused events eventually release stale state. No notification is claimed from sendMessage success alone. Authentication reconnects persistently and shutdown closes the socket. Local unit tests, typecheck and build results are recorded.

## Progress and evidence

Implementation: source, tests, SPEC.md, AGENTS.md, and README.md are complete. Baileys 7.0.0-rc14 installed as ESM; installed declarations confirmed participant PN/LID fields, Signal LID lookup, presence payload, connection options, QR auth, group queries, and send APIs. npm installation added 79 packages and reported no vulnerabilities.

Observed checks: `npm.cmd test` passed 5 tests; `npm.cmd run typecheck` passed; `npm.cmd run build` passed; `node dist/cli.js --help` passed without opening a socket; `node dist/cli.js watch` rejected missing `GROUP_JID` before socket creation; direct Baileys ESM import/API smoke passed. Test-first evidence: identity, alert and in-flight tests failed against stubs, then passed after implementation. No WhatsApp session has been connected and no QR was scanned.

T1 implementation and independent verification are complete for offline behavior. T2 remains pending human pairing and the real two-account experiment; real group event delivery and mobile self-chat push are unknown. Node 24.13.0 / npm 11.6.2 were observed. No source files existed at start.

Work-unit commit: `f6fbdce` (`feat(whatsapp): add local group presence probe`). The feature branch contains approximately 799 authored changed lines excluding the generated lockfile; the selected delivery strategy remains single-pr.

Independent-verifier correction pass: five new assertion-level regressions failed before fixes, covering continuous composing beyond cooldown, uninterrupted uncertain-send failure, PN/LID target-to-event index reuse, and invalid JID components. After correction, `npm.cmd test` passed 11 tests; `npm.cmd run typecheck`, `npm.cmd run build`, and `node dist/cli.js --help` passed. Offline CLI smoke rejected malformed `GROUP_JID` before socket creation. README now builds the CLI before first launch. Independent recheck confirmed all four defects fixed and repeated the checks successfully; the parent also reran typecheck successfully. T2 remains pending.

Correction work-unit commit: `5759529` (`fix(whatsapp): close presence and identity gaps`).

T3: the existing `groups` output now includes only each group's subject (with an unavailable fallback) and exact JID. CLI help, README selection steps, and SPEC scope describe this projection; participant names and other metadata are not added. Local typecheck, all 11 tests, build, and offline help passed. Independent static verification and parent structural readback confirmed the name and ID come from the same group record and remain JSON-encoded; the parent also reran typecheck successfully. No group query or WhatsApp connection was run. The updated native assessment remains medium/due and consent review remains deferred.

T3 work-unit commit: `a9122e5` (`feat(whatsapp): show group names during discovery`).

Native review: effective RDD is on/default. Assessment over the committed range from `da74e7b` returned medium risk and review due (`slice_budget_reached`). Sandbox access initially made assessment unavailable; authorized local metadata access resolved that failure. Preflight returned a START requiring relayed consent. START was not invoked, no consent answer was invented, no transaction was frozen and no receipt exists. The current user request limits human participation to QR and real WhatsApp trials, so consent-based native review is deferred without toggling the mode. Independent offline verification is recorded separately.

Local Git is initialized with baseline `da74e7b` and branch `feature/whatsapp-presence-probe`. No push, pull request or publication occurred. Authored implementation plus correction is approximately 953 additions/deletions excluding lockfile and later tracking updates.

## Next step

Resume T2: with the account paired and previous process stopped, run the groups command, select by visible name and copy that row's exact group JID into GROUP_JID. Names may repeat or change. Keep every real-account result pending until observed; consent-based native review is separately deferred.
