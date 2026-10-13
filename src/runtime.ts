import makeWASocket, {
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState,
  type GroupMetadata,
  type GroupParticipant,
  type WASocket,
} from '@whiskeysockets/baileys'
import { rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import {
  assertRecipientIsNotSender,
  createFixedTextSender,
  PRESENCE_ALERT_TEXT,
  RECIPIENT_TEST_TEXT,
  selectPresenceDestination,
} from './alerts.js'
import { createGroupIdentityIndex, matchesGroup } from './identity.js'
import { PresenceNotifier, type AlertCooldown, type PresenceState } from './presence.js'
import type { ProbeConfig, ProbeMode } from './config.js'

const MAX_RECONNECTS = 5
const STABLE_CONNECTION_MS = 60_000
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

export function nextReconnectCount(current: number, uptimeMs: number): number {
  return uptimeMs >= STABLE_CONNECTION_MS ? 1 : current + 1
}

export function getPairingGuidance(registered: boolean): string | undefined {
  return registered
    ? 'A linked WhatsApp session is already saved in AUTH_DIR. Run unpair first before pairing another phone.'
    : undefined
}

export function resolveAuthDirectory(projectRoot: string, authDir: string): string {
  if (!/^auth_[A-Za-z0-9_-]+$/.test(authDir)) {
    throw new Error('AUTH_DIR must be a safe top-level directory name starting with auth_.')
  }
  const rootPath = resolve(projectRoot)
  const authPath = resolve(rootPath, authDir)
  if (dirname(authPath) !== rootPath || basename(authPath) !== authDir) {
    throw new Error('AUTH_DIR must resolve to one top-level directory inside the project root.')
  }
  return authPath
}

type UnpairDependencies = {
  registered: boolean
  waitForReady: () => Promise<void>
  logout: () => Promise<void>
  removeAuthDirectory: () => Promise<void>
}

export async function performUnpair(dependencies: UnpairDependencies): Promise<'unpaired' | 'no-session'> {
  if (!dependencies.registered) {
    try {
      await dependencies.removeAuthDirectory()
    } catch {
      throw new Error('No registered session was found, but the selected local authentication directory could not be cleared.')
    }
    return 'no-session'
  }
  try {
    await dependencies.waitForReady()
  } catch {
    throw new Error('Authenticated WhatsApp connection was not ready; local authentication state was preserved.')
  }
  try {
    await dependencies.logout()
  } catch {
    throw new Error('WhatsApp logout request failed; local authentication state was preserved.')
  }
  try {
    await dependencies.removeAuthDirectory()
  } catch {
    throw new Error('WhatsApp logout request was sent, but local authentication state could not be removed; do not pair until it is cleared.')
  }
  return 'unpaired'
}

type ConnectionUpdate = { connection?: 'connecting' | 'open' | 'close' }
type ConnectionEventSource = {
  on: (event: 'connection.update', listener: (update: ConnectionUpdate) => void) => void
  off: (event: 'connection.update', listener: (update: ConnectionUpdate) => void) => void
}

export function waitForAuthenticatedOpen(events: ConnectionEventSource, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timeout: NodeJS.Timeout
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      events.off('connection.update', onUpdate)
      if (error) reject(error)
      else resolve()
    }
    const onUpdate = (update: ConnectionUpdate) => {
      if (update.connection === 'open') finish()
      else if (update.connection === 'close') finish(new Error('Connection closed before authenticated readiness.'))
    }
    timeout = setTimeout(() => finish(new Error('Timed out waiting for authenticated WhatsApp connection.')), timeoutMs)
    events.on('connection.update', onUpdate)
  })
}

async function runUnpair(config: ProbeConfig) {
  const { state } = await useMultiFileAuthState(config.authDir)
  const authPath = resolveAuthDirectory(process.cwd(), config.authDir)
  if (!state.creds.registered) {
    await performUnpair({
      registered: false,
      waitForReady: async () => undefined,
      logout: async () => undefined,
      removeAuthDirectory: () => rm(authPath, { recursive: true, force: true }),
    })
    console.log('No registered WhatsApp session was found; the selected AUTH_DIR was cleared locally. No remote logout request was sent.')
    return
  }

  const socket = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
  })
  try {
    await performUnpair({
      registered: state.creds.registered,
      waitForReady: () => waitForAuthenticatedOpen(socket.ev),
      logout: () => socket.logout(),
      removeAuthDirectory: () => rm(authPath, { recursive: true, force: true }),
    })
    console.log('WhatsApp logout request sent and the selected AUTH_DIR was cleared. Baileys does not confirm server-side unlink; you can now run pair to link another phone.')
  } finally {
    await socket.end(undefined).catch(() => undefined)
  }
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
    return
  }
  if (mode === 'alert-test') {
    const recipient = config.alertToJid!
    await assertRecipientIsNotSender(
      recipient,
      [socket.user ?? {}, socket.authState.creds.me ?? {}],
      socket.signalRepository.lidMapping,
    )
    const sendFixedText = createFixedTextSender(recipient, async (jid, text) => socket.sendMessage(jid, { text }))
    await sendFixedText(RECIPIENT_TEST_TEXT)
    output({ type: 'recipient-alert-test', acceptedBySocket: true })
  }
}

async function runWatch(
  socket: WASocket,
  config: ProbeConfig,
  cooldown: AlertCooldown,
  isCurrent: () => boolean,
) {
  const groupJid = config.groupJid!
  const metadata = await getGroupMetadata(socket, groupJid)
  const verifiedMapping = config.targetJid ? await lookupTargetMapping(socket, config.targetJid) : undefined
  const identityIndex = createGroupIdentityIndex(metadata.participants, verifiedMapping ? [verifiedMapping] : [])
  const canonicalTarget = config.targetJid ? identityIndex.resolve(config.targetJid) : null
  if ((config.alertToSelf || config.alertToJid) && !canonicalTarget) {
    throw new Error('TARGET_JID did not resolve to a participant in GROUP_JID; no alert was sent.')
  }
  const meId = socket.user?.id
  if (config.alertToSelf && !meId) throw new Error('The authenticated account identity is unavailable.')
  const destination = selectPresenceDestination(config, meId)
  if (config.alertToJid) {
    await assertRecipientIsNotSender(
      config.alertToJid,
      [socket.user ?? {}, socket.authState.creds.me ?? {}],
      socket.signalRepository.lidMapping,
    )
  }

  const notifier = canonicalTarget && destination
    ? new PresenceNotifier(canonicalTarget, {
      staleMs: 120_000,
      cooldownMs: 300_000,
      confirmMs: config.alertConfirmMs,
      cooldown,
    })
    : undefined
  const sendFixedText = destination
    ? createFixedTextSender(destination, async (jid, text) => socket.sendMessage(jid, { text }))
    : undefined
  let events = 0
  let filtered = 0
  let unresolved = 0
  let sendAttempts = 0
  let sendSuccesses = 0
  let sendFailures = 0

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
            await sendFixedText!(PRESENCE_ALERT_TEXT)
            sendSuccesses += 1
          } catch {
            sendFailures += 1
            console.error('Alert send failed; outcome may be unknown and will not be retried automatically.')
            throw new Error('Alert send failed.')
          }
        }).catch(() => undefined)
      }
    }
  })

  // WhatsApp forwards chat states only to available clients, and Baileys skips the request without a profile name.
  let missingNameReported = false
  const announceAvailable = async () => {
    if (!socket.authState.creds.me?.name) {
      if (!missingNameReported) {
        console.error('The account profile name is not synced yet, so availability cannot be announced; composing events may not arrive until it is.')
      }
      missingNameReported = true
      return
    }
    try {
      await socket.sendPresenceUpdate('available')
    } catch {
      console.error('Could not set the local account to available; composing events may not arrive.')
    }
  }
  socket.ev.on('creds.update', (update) => {
    if (isCurrent() && missingNameReported && update.me?.name) void announceAvailable()
  })

  await announceAvailable()
  try { await socket.presenceSubscribe(groupJid) } catch { console.error('Group presence subscription request failed.') }
  if (config.targetJid) {
    try { await socket.presenceSubscribe(config.targetJid) } catch { console.error('Best-effort target presence subscription request failed.') }
  }

  console.log('Watching only the configured group. Press Ctrl+C to stop.')
  return () => {
    notifier?.dispose()
    output({ type: 'watch-summary', events, filtered, unresolved, sendAttempts, sendSuccesses, sendFailures })
  }
}

export async function runProbe(mode: ProbeMode, config: ProbeConfig) {
  if (mode === 'unpair') {
    await runUnpair(config)
    return
  }
  let stopped = false
  let currentSocket: WASocket | undefined
  const stop = () => {
    stopped = true
    if (currentSocket) void currentSocket.end(undefined)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir)
    const pairingGuidance = mode === 'pair' ? getPairingGuidance(state.creds.registered) : undefined
    if (pairingGuidance) {
      console.log(pairingGuidance)
      return
    }
    const cooldown: AlertCooldown = { lastAlertAt: Number.NEGATIVE_INFINITY }
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
      let openedAt: number | undefined
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
          openedAt = Date.now()
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
        if (mode === 'groups' || mode === 'participants' || mode === 'self-test' || mode === 'alert-test') {
          await runOneShot(socket, mode, config)
          await socket.end(undefined)
          return
        }
        if (mode === 'watch') {
          const printSummary = await runWatch(socket, config, cooldown, () => currentSocket === socket)
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
      // A socket that never opened has no uptime and must not reset the reconnect budget.
      const uptimeMs = openedAt === undefined ? 0 : Date.now() - openedAt
      reconnects = nextReconnectCount(reconnects, uptimeMs)
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
