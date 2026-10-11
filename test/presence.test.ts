import assert from 'node:assert/strict'
import test from 'node:test'
import { createGroupIdentityIndex, createIdentityIndex, matchesGroup } from '../src/identity.js'
import { PresenceNotifier } from '../src/presence.js'

test('normalizes participant identifiers and resolves only known PN/LID aliases', () => {
  const index = createIdentityIndex(
    [{ id: '11111111111111:3@lid', phoneNumber: '15551234567:8@s.whatsapp.net' }],
    [['15551234567@s.whatsapp.net', '11111111111111@lid']],
  )

  assert.equal(index.resolve('15551234567@s.whatsapp.net'), '11111111111111@lid')
  assert.equal(index.resolve('11111111111111:6@lid'), '11111111111111@lid')
  assert.equal(index.resolve('15550000000@s.whatsapp.net'), null)
})

test('does not resolve non-members or infer identities from matching digits', () => {
  const index = createIdentityIndex([{ id: '15551234567@lid' }], [])
  assert.equal(index.resolve('15551234567@s.whatsapp.net'), null)
  assert.equal(index.resolve('99999999999999@lid'), null)
})

test('one group identity index resolves the configured PN and later PN/LID event aliases', () => {
  const index = createGroupIdentityIndex(
    [{ id: '11111111111111@lid' }],
    [['15551234567@s.whatsapp.net', '11111111111111@lid']],
  )

  assert.equal(index.resolve('15551234567@s.whatsapp.net'), '11111111111111@lid')
  assert.equal(index.resolve('15551234567:4@s.whatsapp.net'), '11111111111111@lid')
  assert.equal(index.resolve('11111111111111:2@lid'), '11111111111111@lid')

  const unknown = createGroupIdentityIndex(
    [{ id: '11111111111111@lid' }],
    [['15550000000@s.whatsapp.net', '99999999999999@lid']],
  )
  assert.equal(unknown.resolve('15550000000@s.whatsapp.net'), null)
})

test('isolates presence events to the configured group', () => {
  assert.equal(matchesGroup('12345@g.us', '12345@g.us'), true)
  assert.equal(matchesGroup('98765@g.us', '12345@g.us'), false)
})

test('deduplicates composing updates, releases stale episodes, and honors cooldown', async () => {
  const attempts: number[] = []
  const notifier = new PresenceNotifier('participant@lid', { staleMs: 100, cooldownMs: 500 })
  const send = async () => { attempts.push(1) }

  assert.equal(await notifier.handle('participant:1@lid', 'composing', 0, send), true)
  assert.equal(await notifier.handle('participant@lid', 'composing', 10, send), false)
  assert.equal(await notifier.handle('participant@lid', 'paused', 20, send), false)
  assert.equal(await notifier.handle('participant@lid', 'paused', 21, send), false)
  assert.equal(await notifier.handle('participant@lid', 'composing', 30, send), false)
  assert.equal(await notifier.handle('participant@lid', 'composing', 550, send), true)
  assert.equal(attempts.length, 2)
})

test('guards an in-flight alert and never retries an uncertain failed send', async () => {
  const notifier = new PresenceNotifier('target@lid', { staleMs: 100, cooldownMs: 0 })
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const send = async () => pending

  const first = notifier.handle('target@lid', 'composing', 1, send)
  assert.equal(await notifier.handle('target@lid', 'composing', 2, send), false)
  release()
  assert.equal(await first, true)

  const failed = new PresenceNotifier('target@lid', { staleMs: 100, cooldownMs: 0 })
  const uncertain = async () => { throw new Error('delivery outcome unknown') }
  await assert.rejects(failed.handle('target@lid', 'composing', 1, uncertain))
  assert.equal(await failed.handle('target@lid', 'composing', 2, uncertain), false)
})

test('continuous composing refreshes the stale timer past cooldown and real inactivity starts a new episode', async () => {
  const attempts: number[] = []
  const notifier = new PresenceNotifier('target@lid', { staleMs: 120_000, cooldownMs: 300_000 })
  const send = async () => { attempts.push(1) }

  assert.equal(await notifier.handle('target@lid', 'composing', 0, send), true)
  for (let now = 10_000; now <= 390_000; now += 10_000) {
    assert.equal(await notifier.handle('target@lid', 'composing', now, send), false)
  }
  assert.equal(attempts.length, 1)

  assert.equal(await notifier.handle('target@lid', 'composing', 520_001, send), true)
  assert.equal(attempts.length, 2)
})

test('continuous composing after an uncertain failure does not retry without an inactivity gap', async () => {
  let attempts = 0
  const notifier = new PresenceNotifier('target@lid', { staleMs: 120_000, cooldownMs: 300_000 })
  const uncertain = async () => { attempts += 1; throw new Error('delivery outcome unknown') }

  await assert.rejects(notifier.handle('target@lid', 'composing', 0, uncertain))
  for (let now = 10_000; now <= 390_000; now += 10_000) {
    assert.equal(await notifier.handle('target@lid', 'composing', now, uncertain), false)
  }
  assert.equal(attempts, 1)
})
