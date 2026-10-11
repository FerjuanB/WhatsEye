import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRESENCE_ALERT_TEXT,
  assertRecipientIsNotSender,
  createFixedTextSender,
  selectPresenceDestination,
} from '../src/alerts.js'
import { PresenceNotifier } from '../src/presence.js'
import { createGroupIdentityIndex } from '../src/identity.js'

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
