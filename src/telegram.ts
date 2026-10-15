const TELEGRAM_TIMEOUT_MS = 10_000
const GENERIC_FAILURE = 'Telegram alert send failed.'

export type TelegramDestination = { botToken: string; chatId: string }
export type FixedTextSender = (text: string) => Promise<void>

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
    } catch {
      // Underlying errors can embed the request URL, which contains the bot token.
      throw new Error(GENERIC_FAILURE)
    }
    if (!response.ok) throw new Error(GENERIC_FAILURE)
  }
}

export type FanOutResult = { attempts: number; successes: number; failures: number }

// Attempts every destination independently; one failure never skips the others and nothing is retried.
export async function sendToDestinations(senders: FixedTextSender[], text: string): Promise<FanOutResult> {
  const outcomes = await Promise.allSettled(senders.map(async (send) => send(text)))
  const successes = outcomes.filter((outcome) => outcome.status === 'fulfilled').length
  return { attempts: outcomes.length, successes, failures: outcomes.length - successes }
}
