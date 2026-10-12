# WhatsApp presence probe

This local probe watches presence updates for one WhatsApp group using the unofficial Baileys library. It does not inspect message contents. Real event and mobile notification behavior remains unverified until you run the two-account experiment below.

## Quick path on Windows

Use Node.js 20 or later. The implementation was built with Node.js 24.13.0 and npm 11.6.2.

```powershell
npm.cmd install
npm.cmd run build
Copy-Item .env.example .env
npm.cmd start -- pair
```

Scan the QR code in the terminal with the WhatsApp account you control (account A). The QR is not written to a file. Keep this terminal private while pairing. Press Ctrl+C after the session connects; the local session is saved under `auth_info/` and ignored by Git.

Discover joined groups. Each JSON line shows the group's name and exact JID; names can repeat or change, so use the JID as the selection key:

```powershell
npm.cmd start -- groups
```

Choose a group by its displayed name, copy that row's exact `group` value into `GROUP_JID` in `.env`, then list its participants:

```powershell
npm.cmd start -- participants
```

Choose the participant JID for account B and set it as `TARGET_JID` only if you want to filter output or test an alert. Participant output contains IDs only, not contact names. Keep `.env` and `auth_info/` private.

## Controlled two-account experiment

Use a group containing account A (the paired account) and account B (the account whose composing presence you will trigger). Avoid unrelated people and groups. Do not send any message content for the initial presence test.

1. Start with `ALERT_TO_SELF=false` and `SELF_MESSAGE_TEST=false` in `.env`.
2. Set `GROUP_JID` to the controlled group's ID. Leave `TARGET_JID` empty to observe all participants, or set it to B's PN or LID to filter.
3. Start `npm.cmd start -- watch` on A. B opens the group, types without sending, pauses, and repeats. Record whether A receives events for B and whether unrelated participants appear. Repeat a composing episode several times to observe deduplication.
4. Repeat with B's PN/LID form changed in `TARGET_JID` only when the group listing gives a verified mapping. If it is unresolved, record that outcome; do not guess based on similar digits.
5. While watching, disconnect and reconnect A's network once. Record any event gap, retry, or duplicate. Restart the process and repeat one composing episode to observe that in-memory deduplication resets.
6. Only after the presence-only run, optionally set `ALERT_TO_SELF=true` with B's verified group participant ID and repeat. Observe the fixed alert in A's own chat. Then lock/background A's phone and repeat controlled trials while A is unavailable, and while it is active, recording app notification settings and outcomes.
7. Test self-chat push separately with `SELF_MESSAGE_TEST=true` and `npm.cmd start -- self-test`. This sends one fixed test message to A's own chat; it does not test group-presence delivery.

Baileys reports `acceptedBySocket` after a self-message send call. That proves only that the local send call completed. Record actual notification behavior on the phone separately. If self-chat does not produce a push, the original mobile notification objective has failed for this path; an alternate notification channel would need a separate product decision.

### Result record

Leave this table blank until account A and account B have been tested. Do not treat no event as proof that B was not composing.

| Experiment | Observation | Evidence / notes |
| --- | --- | --- |
| Group presence event for B | Pending | |
| Filter separates B from other members | Pending | |
| Repeated composing updates and paused state | Pending | |
| Missing paused event / stale timeout | Pending | |
| Network reconnect behavior | Pending | |
| Alert appears in A's own chat | Pending | |
| Mobile push while A is active | Pending | |
| Mobile push while A is backgrounded/locked | Pending | |

## Commands and configuration

```powershell
npm.cmd start -- --help
npm.cmd start -- groups
npm.cmd start -- participants
tal cnpm.cmd start -- self-test
```

| Variable | Use |
| --- | --- |
| `GROUP_JID` | Required for `participants` and `watch`; select a group you control |
| `TARGET_JID` | Optional watch filter; required when alerts are enabled |
| `ALERT_TO_SELF` | Defaults to `false`; when true, send one fixed alert per detected target composing episode to account A's own sichat |
| `SELF_MESSAGE_TEST` | Defaults to `false`; must be `true` to run the separate fixed self-message test |

`watch` with no target prints presence projections for all members reported by the group. Set `TARGET_JID` to inspect only the exact resolved member. Notifications are disabled by default and require a selected group member. Both notification flows send only to the authenticated account identified by the active socket.

## What the probe records

Presence output includes the local timestamp, selected group ID, participant ID, presence state, and (when a target is configured) whether the participant matched. It does not print `lastSeen`, names, message bodies, or full Baileys event objects. The code does not register message listeners or persist conversation data. Baileys' own in-memory protocol handling is still part of the library.

PN (`@s.whatsapp.net`) and LID (`@lid`) are different identifiers. The probe normalizes device suffixes and joins them only through participant fields or verified Signal mappings. It never assumes equal phone-like digits mean the same person. An unresolved target cannot receive an alert.

The probe subscribes to the selected group and makes a best-effort target subscription. WhatsApp may not emit group participant presence in every privacy, account, or group state. No event is inconclusive. The probe uses `markOnlineOnConnect: false`, disables full-history sync, and requests `unavailable` after connection to help mobile notification behavior, but this does not guarantee an event or push notification.

Repeated composing updates are deduplicated in memory, and each composing observation refreshes the episode's activity time. Paused or other presence states clear the active episode; a two-minute observation gap covers a missed paused event. A five-minute cooldown, in-flight guard, and no blind retry after uncertain send errors limit duplicate alerts. Restarting the process resets these caches, so exactly-once alerts are not promised. Reconnects are bounded to five attempts with exponential delays up to 30 seconds.

## Local checks

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

These checks cover local identity and deduplication logic only. They cannot verify QR pairing, group event delivery, reconnects against WhatsApp, or mobile push behavior.

## Account and session risk

Baileys is an unofficial WhatsApp Web library and this project pins a release candidate. Account availability, terms compliance, and protocol compatibility are not guaranteed. Use a controlled account and group, do not share `auth_info/` or `.env`, and stop if WhatsApp reports a session or account problem.
