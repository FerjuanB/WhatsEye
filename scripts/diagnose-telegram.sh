#!/usr/bin/env bash
# Diagnoses why Telegram alerts fail on a Linux host (for example, Zorin OS).
# Run from the project root: bash scripts/diagnose-telegram.sh
# Sends one fixed test message per Node attempt. Never prints the bot token or chat id.
set -u

HOST=api.telegram.org
ENV_FILE=${1:-.env}

section() { printf '\n== %s ==\n' "$1"; }

section "Node"
if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node -v)
  echo "node $NODE_VERSION"
  NODE_MAJOR=${NODE_VERSION#v}; NODE_MAJOR=${NODE_MAJOR%%.*}
  if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "WARNING: Node < 20 does not try IPv4 and IPv6 in parallel; a broken IPv6 route makes fetch fail. Install Node 20+."
  fi
else
  echo "ERROR: node is not installed."
fi

section "Clock"
date -u '+utc %Y-%m-%dT%H:%M:%SZ'
if command -v timedatectl >/dev/null 2>&1; then
  timedatectl show -p NTPSynchronized -p NTP 2>/dev/null || timedatectl | grep -iE 'synchronized|ntp'
fi

section "DNS"
getent ahostsv4 "$HOST" | awk 'NR==1 {print "ipv4 resolves to " $1}' || true
getent ahostsv6 "$HOST" | awk 'NR==1 {print "ipv6 resolves to " $1}' || true
getent hosts "$HOST" >/dev/null || echo "ERROR: $HOST does not resolve."

section "HTTPS reachability (curl)"
if command -v curl >/dev/null 2>&1; then
  for family in 4 6; do
    code=$(curl -"$family" -sS -m 10 -o /dev/null -w '%{http_code}' "https://$HOST" 2>&1) || true
    echo "ipv$family: $code"
  done
else
  echo "curl is not installed; skipping."
fi

section "Wi-Fi power saving"
if command -v iw >/dev/null 2>&1; then
  for dev in $(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}'); do
    echo "$dev: $(iw dev "$dev" get power_save 2>/dev/null)"
  done
else
  echo "iw is not installed; skipping."
fi

section "Telegram send through Node fetch"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run from the project root."
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then exit 1; fi

# The .env file is parsed by Node instead of being sourced, so its values are never executed by the shell.
NODE_TEST='
const fs = require("node:fs")
const env = {}
for (const line of fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (match) env[match[1]] = match[2].trim().replace(/^([\x27"])(.*)\1$/, "$2")
}
const token = env.TELEGRAM_BOT_TOKEN, chat = env.TELEGRAM_CHAT_ID
console.log("ALERT_TO_TELEGRAM=" + env.ALERT_TO_TELEGRAM, "token set:", !!token, "chat set:", !!chat)
if (!token || !chat) process.exit(1)
fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: chat, text: "ojoDeTraslados diagnostic: " + process.argv[2] }),
  signal: AbortSignal.timeout(10000),
})
  .then(async (r) => {
    const body = await r.json().catch(() => ({}))
    console.log("status", r.status, String(body.description ?? "").split(token).join("<redacted>").split(chat).join("<redacted>"))
  })
  .catch((e) => console.log("fail", e.name, (e.cause && e.cause.code) || ""))
'

echo "-- default DNS order"
node -e "$NODE_TEST" "$ENV_FILE" "default"
echo "-- IPv4 first"
node --dns-result-order=ipv4first -e "$NODE_TEST" "$ENV_FILE" "ipv4first"

section "How to read this"
cat <<'EOF'
- default fails but "IPv4 first" succeeds: broken IPv6. Upgrade to Node 20+.
- Both fail with ENOTFOUND/EAI_AGAIN: DNS problem on this machine.
- Both fail with ETIMEDOUT/ECONNRESET/ENETUNREACH and curl fails too: network or firewall.
- Errors mentioning certificates, or a wrong clock above: enable NTP (sudo timedatectl set-ntp true).
- status 4xx: check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.
- Everything OK but watch fails sometimes: Wi-Fi power saving may drop the link while idle.
EOF
