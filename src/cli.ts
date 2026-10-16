import { runProbe } from './runtime.js'
import { loadLocalEnv, readProbeConfig, type ProbeMode } from './config.js'
import { configureNetworkDefaults } from './network.js'

const HELP = `WhatsApp group presence probe (unofficial, local demo)

Usage: npm start -- <pair|unpair|groups|participants|watch|self-test|alert-test>

  pair         Pair this local session by scanning the terminal QR code
  unpair       Log out the selected account and clear its local authentication state
  groups       List joined group names and JIDs; select using the exact JID
  participants List participant JIDs for GROUP_JID
  watch        Inspect presence events for GROUP_JID
  self-test    Send one fixed message to the authenticated account's own chat
  alert-test   Send one fixed message to ALERT_TO_JID after explicit opt-in

Configuration is read from .env. ALERT_TO_SELF, ALERT_TO_JID, ALERT_TO_TELEGRAM
(with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID), SELF_MESSAGE_TEST, and
ALERT_MESSAGE_TEST default to disabled. AUTH_DIR defaults to auth_info/.
No command stores group messages or message contents.`

async function main() {
  const command = process.argv[2]
  if (command === '--help' || command === '-h' || command === undefined) {
    console.log(HELP)
    return
  }
  if (!['pair', 'unpair', 'groups', 'participants', 'watch', 'self-test', 'alert-test'].includes(command)) {
    throw new Error('Unknown command. Run npm start -- --help for usage.')
  }

  configureNetworkDefaults()
  await loadLocalEnv()
  const mode = command as ProbeMode
  const config = readProbeConfig(mode)
  await runProbe(mode, config)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unexpected probe failure.'
  console.error(`Probe stopped: ${message}`)
  process.exitCode = 1
})
