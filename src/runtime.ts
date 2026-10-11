import makeWASocket, {
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState,
  type GroupMetadata,
  type GroupParticipant,
  type WASocket,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import { createGroupIdentityIndex, matchesGroup } from './identity.js'
import { PresenceNotifier, type PresenceState } from './presence.js'
import type { ProbeConfig, ProbeMode } from './config.js'

const AUTH_DIR = 'auth_info'
const MAX_RECONNECTS = 5
const ALERT_TEXT = 'A participant may be composing in the selected group.'
const SELF_TEST_TEXT = 'WhatsApp presence probe self-message test.'

type CloseSignal = { statusCode?: number }

function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const output = Reflect.get(error, 'output')
  if (typeof output !== 'object' || output === null) return undefined
  const code = Reflect.get(output, 'statusCode')
  return typeof code === 'number' ? code : undefined
}

function output(record: Record<string, unknown>) {
  console.log(JSON.stringify(record))
}

function participantIds(participants: GroupParticipant[]) {
  return participants.map((participant) => ({
    id: jidNormalizedUser(participant.id),
    ...(participant.lid ? { lid: jidNormalizedUser(participant.lid) } : {}),
    ...(participant.phoneNumber ? { phoneNumber: jidNormalizedUser(participant.phoneNumber) } : {}),
  }))
}

async function getGroupMetadata(socket: WASocket, groupJid: string): Promise<GroupMetadata> {
  return socket.groupMetadata(groupJid)
}

async function lookupTargetMapping(socket: WASocket, targetJid: string): Promise<[string, string] | undefined> {
  try {
    if (targetJid.endsWith('@s.whatsapp.net')) {
      const lid = await socket.signalRepository.lidMapping.getLIDForPN(targetJid)
      if (lid) return [targetJid, lid]
    } else if (targetJid.endsWith('@lid')) {
      const pn = await socket.signalRepository.lidMapping.getPNForLID(targetJid)
      if (pn) return [pn, targetJid]
    }
  } catch {
    // A failed optional mapping lookup leaves the target unresolved.
  }
  return undefined
}

async function runOneShot(socket: WASocket, mode: ProbeMode, config: ProbeConfig) {
  if (mode === 'groups') {
    const groups = await socket.groupFetchAllParticipating()
    const entries = Object.entries(groups).sort(([left], [right]) => left.localeCompare(right))
    for (const [groupJid, metadata] of entries) {
      output({
        type: 'group',
        name: metadata.subject?.trim() || '(name unavailable)',
        group: jidNormalizedUser(groupJid),
      })
    }
    return
  }
  if (mode === 'participants') {
    const metadata = await getGroupMetadata(socket, config.groupJid!)
    for (const participant of participantIds(metadata.participants)) {
      output({ type: 'participant', group: config.groupJid, ...participant })
    }
    return
  }
  if (mode === 'self-test') {
    const selfId = socket.user?.id
    if (!selfId) throw new Error('The authenticated account identity is unavailable.')
    const destination = jidNormalizedUser(selfId)
    await socket.sendMessage(destination, { text: SELF_TEST_TEXT })
    output({ type: 'self-message', destination, acceptedBySocket: true })
  }
}

async function runWatch(socket: WASocket, config: ProbeConfig, isCurrent: () => boolean) {
  const groupJid = config.groupJid!
  const metadata = await getGroupMetadata(socket, groupJid)
  const verifiedMapping = config.targetJid ? await lookupTargetMapping(socket, config.targetJid) : undefined
  const identityIndex = createGroupIdentityIndex(metadata.participants, verifiedMapping ? [verifiedMapping] : [])
  const canonicalTarget = config.targetJid ? identityIndex.resolve(config.targetJid) : null
  if (config.alertToSelf && !canonicalTarget) {
    throw new Error('TARGET_JID did not resolve to a participant in GROUP_JID; no alert was sent.')
  }
  const meId = socket.user?.id
  if (config.alertToSelf && !meId) throw new Error('The authenticated account identity is unavailable.')

  const notifier = canonicalTarget && config.alertToSelf
    ? new PresenceNotifier(canonicalTarget, { staleMs: 120_000, cooldownMs: 300_000 })
    : undefined
  let events = 0
  let filtered = 0
  let unresolved = 0
  let sendAttempts = 0
  let sendSuccesses = 0
  let sendFailures = 0

  try { await socket.presenceSubscribe(groupJid) } catch { console.error('Group presence subscription request failed.') }
  if (config.targetJid) {
    try { await socket.presenceSubscribe(config.targetJid) } catch { console.error('Best-effort target presence subscription request failed.') }
  }
  try { await socket.sendPresenceUpdate('unavailable') } catch { console.error('Could not set the local account to unavailable.') }

  socket.ev.on('presence.update', (update) => {
    if (!isCurrent() || !matchesGroup(update.id, groupJid)) return
    for (const [rawId, presence] of Object.entries(update.presences)) {
      events += 1
      const participantId = jidNormalizedUser(rawId)
      const resolvedId = identityIndex.resolve(participantId)
      const targetMatch = config.targetJid
        ? (canonicalTarget ? resolvedId === canonicalTarget : participantId === config.targetJid)
        : undefined
      if (config.targetJid && !targetMatch) {
        filtered += 1
        continue
      }
      if (!resolvedId) unresolved += 1
      const state = presence.lastKnownPresence as PresenceState
      output({
        type: 'presence',
        at: new Date().toISOString(),
        group: groupJid,
        participant: participantId,
        state,
        ...(targetMatch === undefined ? {} : { targetMatch }),
      })

      if (notifier && resolvedId) {
        void notifier.handle(resolvedId, state, Date.now(), async () => {
          sendAttempts += 1
          try {
            await socket.sendMessage(jidNormalizedUser(meId!), { text: ALERT_TEXT })
            sendSuccesses += 1
          } catch {
            sendFailures += 1
            console.error('Self-alert send failed; outcome may be unknown and will not be retried automatically.')
            throw new Error('Self-alert send failed.')
          }
        }).catch(() => undefined)
      }
    }
  })

  console.log('Watching only the configured group. Press Ctrl+C to stop.')
  return () => output({ type: 'watch-summary', events, filtered, unresolved, sendAttempts, sendSuccesses, sendFailures })
}

export async function runProbe(mode: ProbeMode, config: ProbeConfig) {
  let stopped = false
  let currentSocket: WASocket | undefined
  const stop = () => {
    stopped = true
    if (currentSocket) void currentSocket.end(undefined)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    let reconnects = 0
    while (!stopped) {
      const socket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
      })
      currentSocket = socket
      socket.ev.on('creds.update', () => {
        void saveCreds().catch(() => console.error('Could not persist authentication state; stop and check local disk access.'))
      })

      let opened = false
      let resolveClosed!: (signal: CloseSignal) => void
      let resolveOpening!: (result: { opened: boolean; signal?: CloseSignal }) => void
      const closed = new Promise<CloseSignal>((resolve) => { resolveClosed = resolve })
      const opening = new Promise<{ opened: boolean; signal?: CloseSignal }>((resolve) => { resolveOpening = resolve })
      socket.ev.on('connection.update', (update) => {
        if (update.qr) {
          console.log('Scan this QR code with the account you control. The QR is shown only in this terminal.')
          qrcode.generate(update.qr, { small: true })
        }
        if (update.connection === 'open') {
          opened = true
          console.log('WhatsApp session connected.')
          resolveOpening({ opened: true })
        }
        if (update.connection === 'close') {
          const code = statusCode(update.lastDisconnect?.error)
          const signal = { statusCode: code }
          if (!opened) resolveOpening({ opened: false, signal })
          resolveClosed(signal)
        }
      })

      try {
        const openResult = await opening
        if (!openResult.opened) {
          if (openResult.signal?.statusCode === DisconnectReason.loggedOut) {
            throw new Error('WhatsApp logged out; pair again with the pair command.')
          }
          reconnects += 1
          if (reconnects > MAX_RECONNECTS) throw new Error('Reconnect limit reached; run the command again when the connection is stable.')
          const delay = Math.min(1000 * 2 ** (reconnects - 1), 30_000)
          console.log(`Connection did not open; retry ${reconnects}/${MAX_RECONNECTS} in ${delay / 1000}s.`)
          await socket.end(undefined)
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        if (stopped) break
        if (mode === 'groups' || mode === 'participants' || mode === 'self-test') {
          await runOneShot(socket, mode, config)
          await socket.end(undefined)
          return
        }
        if (mode === 'watch') {
          const printSummary = await runWatch(socket, config, () => currentSocket === socket)
          const closedSignal = await closed
          printSummary()
          if (closedSignal.statusCode === DisconnectReason.loggedOut) throw new Error('WhatsApp logged out; pair again with the pair command.')
        } else {
          const closedSignal = await closed
          if (closedSignal.statusCode === DisconnectReason.loggedOut) throw new Error('WhatsApp logged out; pair again with the pair command.')
        }
      } catch (error) {
        await socket.end(undefined).catch(() => undefined)
        throw error
      }

      if (stopped) break
      reconnects += 1
      if (reconnects > MAX_RECONNECTS) throw new Error('Reconnect limit reached; run the command again when the connection is stable.')
      const delay = Math.min(1000 * 2 ** (reconnects - 1), 30_000)
      console.log(`Connection closed; retry ${reconnects}/${MAX_RECONNECTS} in ${delay / 1000}s.`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    currentSocket = undefined
  }
}
