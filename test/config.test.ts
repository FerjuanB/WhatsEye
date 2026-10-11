import assert from 'node:assert/strict'
import test from 'node:test'
import { readProbeConfig } from '../src/config.js'

function withEnv(values: Record<string, string | undefined>, action: () => void) {
  const names = ['GROUP_JID', 'TARGET_JID', 'ALERT_TO_SELF', 'SELF_MESSAGE_TEST']
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  for (const name of names) {
    const value = values[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try { action() } finally {
    for (const name of names) {
      const value = previous.get(name)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('rejects empty group and user JID components before socket creation', () => {
  withEnv({ GROUP_JID: '@g.us' }, () => {
    assert.throws(() => readProbeConfig('watch'), /GROUP_JID must be a valid group JID/)
  })
  withEnv({ GROUP_JID: '120363123456789-123456@g.us', TARGET_JID: '@lid' }, () => {
    assert.throws(() => readProbeConfig('watch'), /TARGET_JID must be a valid user JID/)
  })
})

test('rejects nonnumeric and malformed device JID components', () => {
  withEnv({ GROUP_JID: 'group@g.us' }, () => {
    assert.throws(() => readProbeConfig('watch'), /GROUP_JID must be a valid group JID/)
  })
  withEnv({ GROUP_JID: '12345@g.us', TARGET_JID: '15551234567:device@lid' }, () => {
    assert.throws(() => readProbeConfig('watch'), /TARGET_JID must be a valid user JID/)
  })
})

test('accepts numeric legacy group JIDs and numeric device suffixes for user JIDs', () => {
  withEnv({
    GROUP_JID: '120363123456789-123456@g.us',
    TARGET_JID: '15551234567:4@s.whatsapp.net',
  }, () => {
    const config = readProbeConfig('watch')
    assert.equal(config.groupJid, '120363123456789-123456@g.us')
    assert.equal(config.targetJid, '15551234567@s.whatsapp.net')
  })
})
