import assert from 'node:assert/strict'
import test from 'node:test'
import { createTelegramSender, sendToDestinations } from '../src/telegram.js'

const FAKE_TOKEN = '123456:FAKE_TOKEN_FOR_TESTS'
const CHAT_ID = '-1001234567890'

type FetchCall = { url: string; init: RequestInit }

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: FetchCall[] = []
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return respond()
  }
  return { calls, impl: impl as typeof fetch }
}

test('telegram sender posts fixed JSON text with a timeout signal', async () => {
  const { calls, impl } = fakeFetch(() => new Response('{"ok":true}', { status: 200 }))
  const send = createTelegramSender({ botToken: FAKE_TOKEN, chatId: CHAT_ID }, impl)

  await send('fixed alert text')

  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, `https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`)
  assert.equal(calls[0]!.init.method, 'POST')
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { chat_id: CHAT_ID, text: 'fixed alert text' })
  assert.match(String(new Headers(calls[0]!.init.headers).get('content-type')), /application\/json/)
  assert.ok(calls[0]!.init.signal instanceof AbortSignal)
})

test('telegram sender throws a generic error for non-2xx responses without leaking details', async () => {
  const { calls, impl } = fakeFetch(() => new Response(`{"description":"bad ${FAKE_TOKEN} ${CHAT_ID}"}`, { status: 401 }))
  const send = createTelegramSender({ botToken: FAKE_TOKEN, chatId: CHAT_ID }, impl)

  await assert.rejects(send('text'), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, 'Telegram alert send failed.')
    assert.equal(error.cause, undefined)
    return true
  })
  assert.equal(calls.length, 1, 'no retry after a failure')
})

test('telegram sender throws a generic error for network failures and timeouts', async () => {
  for (const failure of [new TypeError(`fetch failed for ${FAKE_TOKEN}`), new DOMException('timed out', 'TimeoutError')]) {
    const { calls, impl } = fakeFetch(() => { throw failure })
    const send = createTelegramSender({ botToken: FAKE_TOKEN, chatId: CHAT_ID }, impl)
    await assert.rejects(send('text'), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Telegram alert send failed.')
      assert.ok(!error.message.includes(FAKE_TOKEN))
      assert.equal(error.cause, undefined)
      return true
    })
    assert.equal(calls.length, 1)
  }
})

test('fan-out attempts every destination and counts each outcome', async () => {
  const sent: string[] = []
  const result = await sendToDestinations([
    async (text) => { sent.push(`a:${text}`) },
    async (text) => { sent.push(`b:${text}`) },
  ], 'hello')
  assert.deepEqual(sent, ['a:hello', 'b:hello'])
  assert.deepEqual(result, { attempts: 2, successes: 2, failures: 0 })
})

test('fan-out still sends to the other destination when one fails', async () => {
  const sent: string[] = []
  const result = await sendToDestinations([
    async () => { throw new Error('boom') },
    async (text) => { sent.push(text) },
  ], 'hello')
  assert.deepEqual(sent, ['hello'])
  assert.deepEqual(result, { attempts: 2, successes: 1, failures: 1 })
})

test('fan-out reports zero counts for no destinations', async () => {
  assert.deepEqual(await sendToDestinations([], 'hello'), { attempts: 0, successes: 0, failures: 0 })
})
