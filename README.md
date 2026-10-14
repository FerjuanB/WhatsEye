# WhatsApp presence probe

This local TypeScript probe watches presence updates in one WhatsApp group. With an explicit opt-in, it sends a fixed alert from the paired sender account to a configured phone number when the selected participant is composing or recording. It never reads or stores message contents. Baileys is unofficial; pairing, group presence, and mobile notification behavior must be tested with controlled accounts.

## Quick start on Windows

Use Node.js 24, the version tested for this probe (24.13.0 with npm 11.6.2). Run all commands from the repository root. Install dependencies and build before the first command:

```powershell
npm.cmd install
npm.cmd run build
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` before pairing. For a separate sender account, use a new authentication directory and keep discovery and alert flags disabled:

```dotenv
AUTH_DIR=auth_sender
GROUP_JID=
TARGET_JID=
ALERT_TO_JID=
ALERT_TO_SELF=false
SELF_MESSAGE_TEST=false
ALERT_MESSAGE_TEST=false
ALERT_CONFIRM_SECONDS=5
```

If `.env` already exists, edit it rather than copying over it. Keep a fresh terminal free of shell environment overrides for these variables: the CLI preserves variables already present in the process environment, including empty values, instead of replacing them from `.env`.

Pair the sender and scan the QR code shown in the terminal:

```powershell
npm.cmd start -- pair
```

After the account is linked, press Ctrl+C before starting another command. Credentials are saved under the selected `AUTH_DIR`; do not delete or reuse another account's session directory.

If `pair` finds a linked session in the selected `AUTH_DIR`, it stops and tells you to run `unpair` first. `unpair` sends a logout request for that companion device and clears only the selected local `AUTH_DIR`, so the next `pair` can link another phone. Baileys does not confirm that WhatsApp completed the unlink:

```powershell
npm.cmd start -- unpair
npm.cmd start -- pair
```

This sends an account-level logout request, then clears only the selected local `AUTH_DIR` after Baileys accepts the request. Baileys does not confirm that WhatsApp completed the unlink. If the authenticated connection or logout request fails, the command preserves local authentication state. When no registered session exists, `unpair` clears the selected `AUTH_DIR` locally without sending a remote request. Check `AUTH_DIR` before running the command.

## Discover the group and target

Start each command in a fresh process. List joined groups:

```powershell
npm.cmd start -- groups
```

Choose the group by its displayed name, then copy the exact JID from that row into `GROUP_JID` in `.env`. Names can repeat or change, so the JID is the selection key. The sender account must belong to the selected group.

List that group's participant IDs:

```powershell
npm.cmd start -- participants
```

Copy the selected participant's PN or LID into `TARGET_JID`. Leave `ALERT_TO_JID` blank while pairing and discovering. The alert recipient may be the same person as the monitored target; the authenticated sender must be a different account.

## Test the recipient, then watch

Set `ALERT_TO_JID` to a controlled receiving phone's PN JID, for example `15550000002@s.whatsapp.net`. Keep `ALERT_TO_SELF=false` and `SELF_MESSAGE_TEST=false`. Lock the receiving phone and leave WhatsApp in the background. In `.env`, change `ALERT_MESSAGE_TEST=false` to `ALERT_MESSAGE_TEST=true`, then run:

```powershell
npm.cmd start -- alert-test
```

This sends one fixed test message to the configured recipient. It does not require `GROUP_JID` or `TARGET_JID`. A successful send call does not prove that WhatsApp delivered a notification. After the command exits, change `ALERT_MESSAGE_TEST=true` back to `ALERT_MESSAGE_TEST=false` in `.env`, then run:

```powershell
npm.cmd start -- watch
```

Have the monitored target begin composing in the selected group without sending a message. Record whether the sender receives a presence event, whether the recipient gets the fixed alert, and whether the locked phone shows a notification. Repeat a composing episode and test reconnect behavior. No presence event is inconclusive; the library or WhatsApp may not expose that participant's presence. The separate-account notification result remains pending until observed. For detailed trial steps and a blank result table, see [docs/recipient-alerts.md](docs/recipient-alerts.md).

## Zorin Linux

Use the same configuration phases. Replace `npm.cmd` with `npm`; copy the template only when `.env` is absent:

```bash
npm install
npm run build
if [ ! -f .env ]; then cp .env.example .env; fi
```

Before pairing, edit `.env` as above: set `AUTH_DIR=auth_sender`, leave group, target, and recipient identifiers blank, and keep all flags false. Then run `npm start -- pair` and press Ctrl+C after the sender links. Discover the group and participant with `npm start -- groups` and `npm start -- participants`, updating `.env` between commands. Finally set the recipient and enable `ALERT_MESSAGE_TEST` only for `npm start -- alert-test`; turn it back to false before `npm start -- watch`. Do not set shell environment overrides for these variables unless you intend them to take precedence over `.env`.

## Configuration

The `.env.example` template lists every setting recognized by the current CLI. Blank identifiers and false flags allow pairing and group listing. Configure only the values needed for the command you are running.

| Variable | Default | Accepted value and use |
| --- | --- | --- |
| `AUTH_DIR` | `auth_info` | Single top-level ASCII name matching `auth_[A-Za-z0-9_-]+`; stores this sender's Baileys authentication and Signal state. Use `auth_sender` for a separate sender. |
| `GROUP_JID` | blank | Numeric group JID ending in `@g.us`; required for `participants` and `watch`. |
| `TARGET_JID` | blank | Participant PN (`@s.whatsapp.net`) or LID (`@lid`); optional watch filter, required for watch alerts, and must resolve to a member of `GROUP_JID`. |
| `ALERT_TO_JID` | blank | Phone-number PN JID (`digits@s.whatsapp.net`); enables fixed-recipient watch alerts or `alert-test`. In watch mode, the recipient may be the target. |
| `ALERT_TO_SELF` | `false` | Set `true` for the legacy fixed self-chat watch alert. Watch only; requires a group target and cannot be combined with `ALERT_TO_JID`. |
| `SELF_MESSAGE_TEST` | `false` | Set `true` only for `self-test`, which sends one fixed message to the authenticated account's own chat. |
| `ALERT_MESSAGE_TEST` | `false` | Set `true` only for `alert-test`, together with `ALERT_TO_JID`; sends one fixed test message. |
| `ALERT_CONFIRM_SECONDS` | `5` | Whole number from 0 to 120. A watch alert is sent only when the target is still composing after this many seconds; `0` alerts on the first composing event. |

While `watch` runs, the sender account announces itself as available so that WhatsApp forwards composing events; it appears online to its contacts until the command stops. If the account profile name has not synced yet, `watch` reports that availability could not be announced and retries when the name arrives. After a successful alert, further alerts are suppressed for five minutes, including across reconnects within the same run; a failed send does not start that window. The reconnect limit applies to consecutive failures and resets once a connection has stayed up for one minute.

`alert-test` does not require a group or monitored target. Watch alerts do: the configured target must be verified as a member of the selected group. The explicit recipient is checked against the sender's phone identity and verified LID mapping; delivery is refused when it matches the sender or when the sender phone identity is unavailable. Uncertain sends are not retried automatically. Self-alerts and explicit-recipient alerts are disabled unless their corresponding settings are enabled.

## Commands

```text
pair         Pair the local session by scanning a terminal QR code
unpair       Log out the selected account and clear its local authentication state
groups       List joined group names and exact JIDs
participants List participant IDs for GROUP_JID
watch        Inspect presence events for GROUP_JID
self-test    Send one fixed message to the authenticated account's own chat
alert-test   Send one fixed message to ALERT_TO_JID after explicit opt-in
```

Presence output contains only a timestamp, group ID, participant ID, presence state, and optional target-match result. The probe does not register message listeners or write conversation content. Baileys still handles its own in-memory protocol state. `auth_*` directories and `.env` contain sensitive configuration and session data; keep them private and do not share QR codes.

## Local checks

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

These offline checks cannot verify WhatsApp pairing, group composing events, or mobile push delivery. The user reported that a legacy self-chat message appeared while the phone was locked and WhatsApp was backgrounded but produced no notification. The separate-sender push trial is still pending; the probe does not claim that a fixed alert guarantees a notification.
