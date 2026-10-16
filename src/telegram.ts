const TELEGRAM_TIMEOUT_MS = 10_000
const GENERIC_FAILURE = 'Telegram alert send failed.'
const MAX_DESCRIPTION_LENGTH = 120

export type TelegramDestination = { botToken: string; chatId: string }
export type FixedTextSender = (text: string) => Promise<void>
export type AlertChannel = 'whatsapp' | 'telegram'
export type ChannelSender = { channel: AlertChannel; send: FixedTextSender }

// Carries only a reason that is safe to log: never the token, URL, chat id, or raw error text.
export class AlertSendError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message)
    this.name = 'AlertSendError'
  }
}

function redact(text: string, secrets: string[]): string {
  let result = text
  for (const secret of secrets) result = result.split(secret).join('<redacted>')
  return result.slice(0, MAX_DESCRIPTION_LENGTH)
}

async function httpFailureReason(response: Response, secrets: string[]): Promise<string> {
  const reason = `http ${response.status}`
  try {
    const body = await response.json() as { description?: unknown }
    if (typeof body.description === 'string' && body.description) return `${reason}: ${redact(body.description, secrets)}`
  } catch { /* A non-JSON body adds no safe detail. */ }
  return reason
}

export function createTelegramSender(
  { botToken, chatId }: TelegramDestination,
  fetchImpl: typeof fetch = fetch,
): FixedTextSender {
  return async (text) => {
    let response: Response
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      })
    } catch (error) {
      // Underlying errors can embed the request URL, which contains the bot token.
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw new AlertSendError(GENERIC_FAILURE, timedOut ? 'timeout' : 'network')
    }
    if (!response.ok) throw new AlertSendError(GENERIC_FAILURE, await httpFailureReason(response, [botToken, chatId]))
  }
}

// Describes a failure without its message, which may contain identifiers.
export function describeSendFailure(error: unknown): string {
  if (error instanceof AlertSendError) return error.reason
  const statusCode = (error as { output?: { statusCode?: unknown } } | null)?.output?.statusCode
  if (typeof statusCode === 'number') return `status ${statusCode}`
  return error instanceof Error ? error.name : 'unknown'
}

export type SendFailure = { channel: AlertChannel; reason: string }
export type FanOutResult = { attempts: number; successes: number; failures: SendFailure[] }

// Attempts every destination independently; one failure never skips the others and nothing is retried.
export async function sendToDestinations(senders: ChannelSender[], text: string): Promise<FanOutResult> {
  const outcomes = await Promise.allSettled(senders.map(async ({ send }) => send(text)))
  const failures: SendFailure[] = []
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') failures.push({ channel: senders[index]!.channel, reason: describeSendFailure(outcome.reason) })
  })
  return { attempts: outcomes.length, successes: outcomes.length - failures.length, failures }
}
