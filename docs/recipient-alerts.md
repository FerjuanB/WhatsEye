# Separate sender alerts

Use a separately paired, controlled WhatsApp account as the probe sender. The explicit recipient may be the same person as the monitored `TARGET_JID`; the sender must be a different account. A watch alert is sent to `ALERT_TO_JID` when the selected target is observed composing in `GROUP_JID`.

The probe sends no alert by default and cannot guarantee a mobile notification. The separate-account presence and locked-phone notification trial remains pending.

## Pair and discover

Install and build from the repository root. On Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run build
```

Use `npm` instead of `npm.cmd` on Linux or macOS. In `.env`, set the new sender directory and keep recipient/test options disabled for pairing and discovery:

```dotenv
AUTH_DIR=auth_sender
GROUP_JID=
TARGET_JID=
ALERT_TO_JID=
ALERT_TO_SELF=false
SELF_MESSAGE_TEST=false
ALERT_MESSAGE_TEST=false
```

Use a fresh terminal without shell environment overrides for these settings. If you have explicitly set overrides, remove them before relying on `.env`. The CLI does not replace variables already present in the process environment.

Run `npm.cmd start -- pair` on Windows or `npm start -- pair` on Linux/macOS. Scan the terminal QR using the separate sender account. Once it is linked, stop this process with Ctrl+C before starting another command. The QR is displayed only in the terminal.

Start a new command process and run the groups command:

```powershell
npm.cmd start -- groups
```

Use `npm start -- groups` on Linux/macOS. Copy the exact JID for the chosen group into `.env`. Group names can change or repeat; use the JID as the selection key. Then run `npm.cmd start -- participants` on Windows or `npm start -- participants` on Linux/macOS. Copy the desired monitored participant ID into `TARGET_JID`. The sender account must belong to this group.

## Test and watch

Edit `.env` to set `ALERT_TO_JID` to the controlled receiving phone's PN JID, such as `15550000002@s.whatsapp.net`. This may be the same person as `TARGET_JID`. The recipient must differ from the authenticated sender. Keep `ALERT_TO_SELF=false` and `SELF_MESSAGE_TEST=false`.

Lock the receiving phone and leave WhatsApp in the background. Change `ALERT_MESSAGE_TEST=false` to `ALERT_MESSAGE_TEST=true` in `.env`, then start a fresh process:

```powershell
npm.cmd start -- alert-test
```

Use `npm start -- alert-test` on Linux/macOS. Record whether a notification appears. A send accepted by the socket does not prove that a push arrived. After the test process exits, change `ALERT_MESSAGE_TEST=true` back to `ALERT_MESSAGE_TEST=false` in `.env` before starting watch:

```powershell
npm.cmd start -- watch
```

Use `npm start -- watch` on Linux/macOS. With the sender connected to the selected group, have the monitored target begin composing without sending a message. Repeat while the receiving phone is locked and WhatsApp is backgrounded. Record presence events, whether the fixed alert arrived, repeated composing behavior, reconnect behavior, and notification delivery. No presence events are inconclusive; WhatsApp may not expose presence for that group or participant. If an alert arrives in chat without a phone notification, the notification objective remains unmet. Another channel would require a future product decision.

`alert-test` requires both `ALERT_TO_JID` and `ALERT_MESSAGE_TEST=true`, and sends only a fixed test message. Watch alerts require an explicit destination and a target verified as a member of the selected group. `ALERT_TO_SELF=true` remains the separate legacy self-chat option, and cannot be combined with `ALERT_TO_JID`. The probe refuses a recipient that matches the sender's known phone identity or verified own LID mapping; it also refuses explicit delivery if the sender phone identity cannot be established. Uncertain sends are not retried automatically.

## Pending observations

| Trial | Presence events | Alert arrived in chat | Locked-phone notification | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
