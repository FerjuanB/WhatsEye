import assert from 'node:assert/strict'
import test from 'node:test'
import { readProbeConfig, type ProbeMode } from '../src/config.js'

function withEnv(values: Record<string, string | undefined>, action: () => void) {
  const names = [
    'GROUP_JID', 'TARGET_JID', 'ALERT_TO_SELF', 'SELF_MESSAGE_TEST',
    'ALERT_TO_JID', 'ALERT_MESSAGE_TEST', 'AUTH_DIR', 'ALERT_CONFIRM_SECONDS',
    'ALERT_TO_TELEGRAM', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
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

test('unpair accepts the selected auth directory without requiring messaging configuration', () => {
  withEnv({ AUTH_DIR: 'auth_sender' }, () => {
    const config = readProbeConfig('unpair')
    assert.equal(config.authDir, 'auth_sender')
    assert.equal(config.groupJid, undefined)
    assert.equal(config.alertToJid, undefined)
  })
})

test('alert confirmation window defaults to five seconds and accepts a bounded whole number', () => {
  withEnv({}, () => assert.equal(readProbeConfig('pair').alertConfirmMs, 5_000))
  withEnv({ ALERT_CONFIRM_SECONDS: '0' }, () => assert.equal(readProbeConfig('pair').alertConfirmMs, 0))
  withEnv({ ALERT_CONFIRM_SECONDS: ' 12 ' }, () => assert.equal(readProbeConfig('pair').alertConfirmMs, 12_000))
  for (const invalid of ['-1', '1.5', 'soon', '121']) {
    withEnv({ ALERT_CONFIRM_SECONDS: invalid }, () => {
      assert.throws(() => readProbeConfig('pair'), /ALERT_CONFIRM_SECONDS must be a whole number/)
    })
  }
})

const FAKE_TOKEN = '123456:FAKE_TOKEN_FOR_TESTS'
const telegramBase = {
  GROUP_JID: '12345@g.us',
  TARGET_JID: '15550000001@s.whatsapp.net',
  ALERT_TO_TELEGRAM: 'true',
  TELEGRAM_BOT_TOKEN: FAKE_TOKEN,
  TELEGRAM_CHAT_ID: '-1001234567890',
}

test('telegram destination is opt-in and exposes token and chat id only when enabled', () => {
  withEnv(telegramBase, () => {
    const config = readProbeConfig('watch')
    assert.deepEqual(config.telegram, { botToken: FAKE_TOKEN, chatId: '-1001234567890' })
    assert.equal(config.alertToSelf, false)
    assert.equal(config.alertToJid, undefined)
  })
  withEnv({ ...telegramBase, ALERT_TO_TELEGRAM: 'false' }, () => {
    assert.equal(readProbeConfig('watch').telegram, undefined)
  })
  withEnv({ ...telegramBase, ALERT_TO_TELEGRAM: undefined, TARGET_JID: undefined }, () => {
    assert.equal(readProbeConfig('watch').telegram, undefined)
  })
  withEnv({ ...telegramBase, ALERT_TO_TELEGRAM: '', TELEGRAM_BOT_TOKEN: 'not a token' }, () => {
    assert.equal(readProbeConfig('pair').telegram, undefined)
  })
})

test('telegram can be combined with self or explicit recipient alerts', () => {
  withEnv({ ...telegramBase, ALERT_TO_JID: '15550000002@s.whatsapp.net' }, () => {
    const config = readProbeConfig('watch')
    assert.equal(config.alertToJid, '15550000002@s.whatsapp.net')
    assert.equal(config.telegram?.chatId, '-1001234567890')
  })
  withEnv({ ...telegramBase, ALERT_TO_SELF: 'true' }, () => {
    const config = readProbeConfig('watch')
    assert.equal(config.alertToSelf, true)
    assert.ok(config.telegram)
  })
})

test('telegram accepts positive chat ids', () => {
  withEnv({ ...telegramBase, TELEGRAM_CHAT_ID: '987654321' }, () => {
    assert.equal(readProbeConfig('watch').telegram?.chatId, '987654321')
  })
})

test('telegram configuration failures never echo the token or chat id', () => {
  const cases: Array<[Record<string, string | undefined>, ProbeMode, RegExp]> = [
    [{ TELEGRAM_BOT_TOKEN: undefined }, 'watch', /TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID/],
    [{ TELEGRAM_BOT_TOKEN: '  ' }, 'watch', /TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID/],
    [{ TELEGRAM_CHAT_ID: undefined }, 'watch', /TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID/],
    [{ TELEGRAM_BOT_TOKEN: 'abc:FAKE_TOKEN_FOR_TESTS' }, 'watch', /TELEGRAM_BOT_TOKEN has an invalid format/],
    [{ TELEGRAM_BOT_TOKEN: '123456:FAKE TOKEN' }, 'watch', /TELEGRAM_BOT_TOKEN has an invalid format/],
    [{ TELEGRAM_BOT_TOKEN: '123456' }, 'watch', /TELEGRAM_BOT_TOKEN has an invalid format/],
    [{ TELEGRAM_CHAT_ID: '@somechannel' }, 'watch', /TELEGRAM_CHAT_ID must be an integer/],
    [{ TELEGRAM_CHAT_ID: '12.5' }, 'watch', /TELEGRAM_CHAT_ID must be an integer/],
    [{ TELEGRAM_CHAT_ID: '--5' }, 'watch', /TELEGRAM_CHAT_ID must be an integer/],
    [{}, 'groups', /ALERT_TO_TELEGRAM is available only with the watch command/],
    [{}, 'alert-test', /ALERT_TO_TELEGRAM is available only with the watch command/],
    [{ TARGET_JID: undefined }, 'watch', /TARGET_JID/],
  ]
  for (const [overrides, mode, pattern] of cases) {
    withEnv({ ...telegramBase, ...overrides }, () => {
      assert.throws(() => readProbeConfig(mode), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, pattern)
        assert.ok(!error.message.includes('FAKE'))
        assert.ok(!error.message.includes('1001234567890'))
        return true
      })
    })
  }
})
