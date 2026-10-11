import assert from 'node:assert/strict'
import test from 'node:test'
import { readProbeConfig } from '../src/config.js'

function withEnv(values: Record<string, string | undefined>, action: () => void) {
  const names = [
    'GROUP_JID', 'TARGET_JID', 'ALERT_TO_SELF', 'SELF_MESSAGE_TEST',
    'ALERT_TO_JID', 'ALERT_MESSAGE_TEST', 'AUTH_DIR',
  ]
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

test('explicit watch recipient is independently configurable and opt-in', () => {
  withEnv({
    GROUP_JID: '12345@g.us',
    TARGET_JID: '15550000001@s.whatsapp.net',
    ALERT_TO_JID: '15550000002@s.whatsapp.net',
  }, () => {
    const config = readProbeConfig('watch')
    assert.equal(config.alertToJid, '15550000002@s.whatsapp.net')
    assert.equal(config.alertToSelf, false)
    assert.equal(config.alertMessageTest, false)
    assert.equal(config.authDir, 'auth_info')
  })
})

test('recipient and test flags are limited to their explicit modes', () => {
  withEnv({ ALERT_TO_JID: '15550000002@s.whatsapp.net' }, () => {
    assert.throws(() => readProbeConfig('groups'), /ALERT_TO_JID is available only/)
    assert.throws(() => readProbeConfig('alert-test'), /ALERT_MESSAGE_TEST=true/)
  })
  withEnv({ ALERT_MESSAGE_TEST: 'true' }, () => {
    assert.throws(() => readProbeConfig('watch'), /ALERT_MESSAGE_TEST is available only/)
  })
  withEnv({ ALERT_MESSAGE_TEST: 'true', ALERT_TO_JID: '15550000002@s.whatsapp.net' }, () => {
    const config = readProbeConfig('alert-test')
    assert.equal(config.groupJid, undefined)
    assert.equal(config.targetJid, undefined)
    assert.equal(config.alertMessageTest, true)
  })
})

test('rejects recipient conflicts, wrong JID types, and missing watch target', () => {
  withEnv({
    GROUP_JID: '12345@g.us', TARGET_JID: '15550000001@s.whatsapp.net',
    ALERT_TO_SELF: 'true', ALERT_TO_JID: '15550000002@s.whatsapp.net',
  }, () => assert.throws(() => readProbeConfig('watch'), /cannot be combined/))
  withEnv({ ALERT_TO_JID: '15550000002@lid' }, () => {
    assert.throws(() => readProbeConfig('alert-test'), /valid phone-number JID/)
  })
  withEnv({ GROUP_JID: '12345@g.us', ALERT_TO_JID: '15550000002@s.whatsapp.net' }, () => {
    assert.throws(() => readProbeConfig('watch'), /TARGET_JID/)
  })
})

test('allows the monitored target to be the explicit alert recipient', () => {
  withEnv({
    GROUP_JID: '12345@g.us', TARGET_JID: '15550000002@s.whatsapp.net',
    ALERT_TO_JID: '15550000002@s.whatsapp.net',
  }, () => {
    const config = readProbeConfig('watch')
    assert.equal(config.targetJid, config.alertToJid)
  })
})

test('pair and discovery phase works with recipient blank and test flags false', () => {
  withEnv({
    AUTH_DIR: 'auth_sender', GROUP_JID: '12345@g.us', TARGET_JID: '', ALERT_TO_JID: '',
    ALERT_TO_SELF: 'false', SELF_MESSAGE_TEST: 'false', ALERT_MESSAGE_TEST: 'false',
  }, () => {
    assert.equal(readProbeConfig('pair').alertToJid, undefined)
    assert.equal(readProbeConfig('groups').alertMessageTest, false)
    assert.equal(readProbeConfig('participants').alertToJid, undefined)
  })
})

test('validates safe top-level auth directory names and preserves legacy self mode', () => {
  withEnv({ AUTH_DIR: 'auth_sender' }, () => assert.equal(readProbeConfig('pair').authDir, 'auth_sender'))
  for (const invalid of ['../auth_sender', 'auth_sender/subdir', 'C:\\auth_sender', 'auth_']) {
    withEnv({ AUTH_DIR: invalid }, () => assert.throws(() => readProbeConfig('pair'), /safe top-level/))
  }
  withEnv({
    GROUP_JID: '12345@g.us', TARGET_JID: '15550000001@s.whatsapp.net', ALERT_TO_SELF: 'true',
  }, () => assert.equal(readProbeConfig('watch').alertToSelf, true))
  withEnv({ SELF_MESSAGE_TEST: 'true' }, () => assert.equal(readProbeConfig('self-test').selfMessageTest, true))
})
