# WhatsApp presence probe

This local TypeScript probe checks whether Baileys exposes group-participant presence updates and whether a fixed alert sent to an explicitly selected recipient leads to a mobile notification. It deliberately does not read, store, or print conversation messages.

## Status as of 2026-10-11

| Area | Status |
| --- | --- |
| Baileys package/version and declared APIs | Supported by the installed `7.0.0-rc14` package and declarations |
| Identity normalization and event deduplication | Verified by offline unit tests |
| Pairing, group metadata, and event delivery for real accounts | Pending the human-run two-account experiment |
| Legacy self-chat result | User observed a self-chat message with the phone locked and WhatsApp backgrounded, but no mobile notification |
| Delivery of a separate-account alert to a phone | Pending; a successful send call is not proof of a notification |

The implementation pins `@whiskeysockets/baileys` to exactly `7.0.0-rc14`. Node.js 24.13.0 and npm 11.6.2 were observed during implementation; the package declares Node.js 20 or later. This is an unofficial library and release-candidate build. Account access may carry WhatsApp terms, stability, or account restriction risk.

## Scope

- Pair a local Baileys session by scanning a terminal QR code.
- List joined group names (using each group's subject, or a clear unavailable fallback) alongside exact JIDs. Participant IDs remain available as PN and LID forms without names.
- Subscribe to one selected group's presence updates and print a small projection: time, group JID, participant JID, and presence state.
- Optionally filter output to a selected group member. Fixed alerts remain disabled by default. Legacy self-alerts require `ALERT_TO_SELF=true`; separate-recipient alerts require `ALERT_TO_JID=<digits>@s.whatsapp.net`. Both require `TARGET_JID` to resolve to a member of the selected group. The recipient may be the monitored target; only the authenticated sender must be a different account. Sender identity is checked against its normalized PN and verified LID mappings before explicit-recipient delivery.
- Preserve the distinct, opt-in self-message test. The separate `alert-test` mode requires `ALERT_TO_JID` and `ALERT_MESSAGE_TEST=true`, sends only fixed text, and does not require a group or target. The destination cannot equal the authenticated sender; if the sender's phone identity cannot be established, delivery is refused. Self-alert and explicit-recipient settings cannot be combined.

There is no frontend, database, conversation archive, content listener, or message-content logging. The probe registers only credential, connection, and presence event handlers. Baileys still performs its own in-memory protocol processing and caches as required by the library; this project does not configure a chat store or message retry store. Only Baileys' multi-file authentication and Signal state is persisted under an ignored top-level `auth_*/` directory selected by `AUTH_DIR` (default `auth_info`). Use a new directory for a separate sender. Do not share that directory or QR codes.

## Presence and identity behavior

Baileys `presence.update` has an `id` for the chat and a `presences` map keyed by participant JID. Each value has `lastKnownPresence` and may include `lastSeen`. The probe prints only `lastKnownPresence`; it omits `lastSeen` and any other payload fields. Known states include `composing`, `recording`, `paused`, `available`, and `unavailable`.

PN (`@s.whatsapp.net`) and LID (`@lid`) are distinct identity namespaces. Device suffixes are normalized away with Baileys' `jidNormalizedUser`. A target is matched only against identities supplied by the selected group's participant records or a verified Signal LID mapping. Equal digits across a PN and LID are never treated as proof. Ambiguous or unresolved targets are not used for alerting. An alert-enabled watch exits before listening when its target cannot be verified as a group member.

Repeated `composing` updates for the same normalized member are treated as one episode and refresh its last-observed time. Paused or other presence states release the episode; a two-minute gap with no composing observation releases it if the paused update is missed. The group identity index combines verified participant PN/LID fields with any verified Signal mapping used to resolve the configured target, so the same aliases resolve later presence events. A five-minute cooldown, an in-flight guard, and bounded in-memory episode state reduce duplicates. A send error has an uncertain delivery outcome and is not retried during that uninterrupted episode. State is not persisted, so a process restart can alert again. These rules do not promise exactly-once delivery.

On open, the socket uses `markOnlineOnConnect: false`, disables full history sync, rejects history sync messages, and best-effort sends `unavailable` to help mobile notifications. It requests presence for the group and, when configured, best-effort requests the target. These settings do not guarantee that WhatsApp emits group presence for every participant or sends a push notification. Group subscriptions and separate-recipient push behavior must be measured with the real experiment.

## Risks and constraints

- Presence visibility depends on WhatsApp behavior, privacy settings, client state, group behavior, and the selected account. No events means inconclusive evidence, not proof that the participant was idle.
- The user reported that the legacy self-chat message appeared in chat but produced no mobile notification while the phone was locked and WhatsApp was backgrounded. A separate-account recipient notification remains untested; successful send acceptance does not prove a mobile push. Measure the new path with the receiving phone locked and WhatsApp backgrounded.
- `useMultiFileAuthState` is convenient for a local demo, not a production credential store. Protect the selected `auth_*/` directory and `.env`; remove credentials only through a deliberate local cleanup.
- Reconnects use at most five retries with exponential delays capped at 30 seconds. A changed connection can still cause missed events or a repeated alert after restart.
- This project does not establish reliability, policy compliance, or a production-ready integration.

## Acceptance criteria

- [x] Offline tests cover normalization, verified PN/LID aliases, unknown identities, group isolation, composing deduplication, cooldown, continuous activity, stale expiry, in-flight sends, uncertain send failures, and invalid JIDs.
- [x] Presence output is limited to timestamps, selected group/participant identifiers, state, and an optional target-match flag.
- [x] Configuration rejects malformed or incomplete alert settings before socket creation.
- [x] No messages are stored or listened to by project code; self and separate-recipient sends are opt-in and fixed-text only.
- [ ] A human pairs account A and runs the controlled group experiment with account B.
- [ ] The two-account experiment records event delivery, target discrimination, repeat behavior, reconnect behavior, and separate-recipient mobile notification observations.

## Primary references checked

- [Baileys v7.0.0-rc14 release](https://github.com/WhiskeySockets/Baileys/releases/tag/v7.0.0-rc14)
- [Baileys v7 migration guide](https://github.com/WhiskeySockets/baileys.wiki-site/blob/main/docs/migration/to-v7.0.0.md)
- [Baileys chat/presence implementation](https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/chats.ts)
- [Baileys README](https://github.com/WhiskeySockets/Baileys/blob/master/README.md)
- [Baileys issue #2553: LID/PN group metadata behavior](https://github.com/WhiskeySockets/Baileys/issues/2553)
