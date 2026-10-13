import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  PRESENCE_ALERT_TEXT,
  assertRecipientIsNotSender,
  createFixedTextSender,
  selectPresenceDestination,
} from '../src/alerts.js'
import { PresenceNotifier } from '../src/presence.js'
import { createGroupIdentityIndex } from '../src/identity.js'
import {
  getPairingGuidance,
  nextReconnectCount,
  performUnpair,
  resolveAuthDirectory,
  waitForAuthenticatedOpen,
} from '../src/runtime.js'

test('fake composing update alerts the target recipient while sender remains distinct', async () => {
  const targetJid = '15550000002@s.whatsapp.net'
  const recipientJid = '15550000002@s.whatsapp.net'
  const selfJid = '15550000003@s.whatsapp.net'
  const destination = selectPresenceDestination({ alertToSelf: false, alertToJid: recipientJid }, selfJid)
  const sent: Array<[string, string]> = []
  const send = createFixedTextSender(destination!, async (jid, text) => { sent.push([jid, text]) })
  const notifier = new PresenceNotifier(targetJid, { staleMs: 120_000, cooldownMs: 300_000 })

  await notifier.handle(targetJid, 'composing', 1_000, () => send(PRESENCE_ALERT_TEXT))
  assert.deepEqual(sent, [[recipientJid, PRESENCE_ALERT_TEXT]])
  assert.equal(sent[0]![0], targetJid)
  assert.notEqual(sent[0]![0], selfJid)
})

test('verified group aliases allow a PN recipient whose configured target is its LID', async () => {
  const pn = '15550000002@s.whatsapp.net'
  const lid = '11111111111111@lid'
  const sender = '15550000003@s.whatsapp.net'
  const sent: Array<[string, string]> = []
  const identities = createGroupIdentityIndex([{ id: lid, lid, phoneNumber: pn }])
  const canonicalTarget = identities.resolve(lid)
  assert.equal(identities.resolve(pn), canonicalTarget)
  const notifier = new PresenceNotifier(canonicalTarget!, { staleMs: 120_000, cooldownMs: 300_000 })
  const send = createFixedTextSender(pn, async (jid, text) => { sent.push([jid, text]) })

  await notifier.handle(canonicalTarget!, 'composing', 1_000, () => send(PRESENCE_ALERT_TEXT))
  assert.deepEqual(sent, [[pn, PRESENCE_ALERT_TEXT]])
  assert.notEqual(sent[0]![0], sender)
})

test('legacy self routing remains available and alerting stays disabled by default', () => {
  const selfJid = '15550000003@s.whatsapp.net'
  assert.equal(selectPresenceDestination({ alertToSelf: true }, selfJid), selfJid)
  assert.equal(selectPresenceDestination({ alertToSelf: false }, selfJid), undefined)
})

test('explicit recipient equal to sender is rejected using normalized PN', async () => {
  const ownPn = '15550000003@s.whatsapp.net'
  await assert.rejects(assertRecipientIsNotSender(ownPn, [{ phoneNumber: ownPn }], {
    getPNForLID: async () => null,
    getLIDForPN: async () => null,
  }), /sender account/)
})

test('known own LID alias is rejected and missing own PN fails closed', async () => {
  const ownLid = '11111111111111@lid'
  const senderPn = '15550000003@s.whatsapp.net'
  const aliasPn = '15550000004@s.whatsapp.net'
  const mappings = {
    getPNForLID: async () => senderPn,
    getLIDForPN: async (jid: string) => jid === aliasPn ? ownLid : null,
  }
  await assert.rejects(
    assertRecipientIsNotSender(aliasPn, [{ phoneNumber: senderPn, lid: ownLid }], mappings),
    /sender account/,
  )
  await assert.rejects(
    assertRecipientIsNotSender(aliasPn, [{ id: ownLid, lid: ownLid }], {
      getPNForLID: async () => null,
      getLIDForPN: async () => ownLid,
    }),
    /phone identity is unavailable/,
  )
})

test('different phone recipient remains routable', async () => {
  const senderPn = '15550000003@s.whatsapp.net'
  const recipientPn = '15550000004@s.whatsapp.net'
  await assert.doesNotReject(assertRecipientIsNotSender(recipientPn, [{ id: senderPn }], {
    getPNForLID: async () => null,
    getLIDForPN: async () => null,
  }))
})

test('pairing guidance is shown only for a registered saved session', () => {
  assert.match(getPairingGuidance(true)!, /run unpair first/i)
  assert.equal(getPairingGuidance(false), undefined)
})

test('unpair waits for authenticated readiness before logout and local cleanup', async () => {
  const steps: string[] = []
  const listeners = new Set<(update: { connection?: 'connecting' | 'open' | 'close' }) => void>()
  const events = {
    on: (_event: 'connection.update', listener: (update: { connection?: 'connecting' | 'open' | 'close' }) => void) => { listeners.add(listener) },
    off: (_event: 'connection.update', listener: (update: { connection?: 'connecting' | 'open' | 'close' }) => void) => { listeners.delete(listener) },
  }
  const result = await performUnpair({
    registered: true,
    waitForReady: async () => {
      steps.push('ready')
      const readiness = waitForAuthenticatedOpen(events, 100)
      for (const listener of listeners) listener({ connection: 'open' })
      await readiness
      assert.equal(listeners.size, 0)
    },
    logout: async () => { steps.push('logout') },
    removeAuthDirectory: async () => { steps.push('remove') },
  })
  assert.deepEqual(steps, ['ready', 'logout', 'remove'])
  assert.equal(result, 'unpaired')
})

test('unpair readiness failure preserves local auth and does not request logout', async () => {
  const steps: string[] = []
  await assert.rejects(performUnpair({
    registered: true,
    waitForReady: async () => { steps.push('ready'); throw new Error('not authenticated') },
    logout: async () => { steps.push('logout') },
    removeAuthDirectory: async () => { steps.push('remove') },
  }), /authenticated WhatsApp connection was not ready; local authentication state was preserved/i)
  assert.deepEqual(steps, ['ready'])
})

test('authenticated readiness timeout removes its connection listener', async () => {
  const listeners = new Set<(update: { connection?: 'connecting' | 'open' | 'close' }) => void>()
  const events = {
    on: (_event: 'connection.update', listener: (update: { connection?: 'connecting' | 'open' | 'close' }) => void) => { listeners.add(listener) },
    off: (_event: 'connection.update', listener: (update: { connection?: 'connecting' | 'open' | 'close' }) => void) => { listeners.delete(listener) },
  }
  await assert.rejects(waitForAuthenticatedOpen(events, 1), /timed out/i)
  assert.equal(listeners.size, 0)
})

test('unpair preserves local auth state when remote logout fails', async () => {
  let removed = false
  await assert.rejects(performUnpair({
    registered: true,
    waitForReady: async () => undefined,
    logout: async () => { throw new Error('sensitive remote detail') },
    removeAuthDirectory: async () => { removed = true },
  }), /logout request failed; local authentication state was preserved/i)
  assert.equal(removed, false)
})

test('unpair without a registered session clears only the selected local auth directory', async () => {
  const steps: string[] = []
  const result = await performUnpair({
    registered: false,
    waitForReady: async () => { steps.push('ready') },
    logout: async () => { steps.push('logout') },
    removeAuthDirectory: async () => { steps.push('remove-selected-auth') },
  })
  assert.equal(result, 'no-session')
  assert.deepEqual(steps, ['remove-selected-auth'])
})

test('selected auth directory resolution cannot escape the project root', () => {
  const projectRoot = resolve('project')
  assert.equal(resolveAuthDirectory(projectRoot, 'auth_info'), join(projectRoot, 'auth_info'))
  for (const unsafe of ['..\\auth_other', '../auth_other', 'auth_other\\nested', 'auth_other/nested']) {
    assert.throws(() => resolveAuthDirectory(projectRoot, unsafe), /safe top-level/)
  }
})

test('reconnect budget resets only after a stable connection', () => {
  assert.equal(nextReconnectCount(4, 59_999), 5)
  assert.equal(nextReconnectCount(4, 60_000), 1)
  assert.equal(nextReconnectCount(0, 0), 1)
})
