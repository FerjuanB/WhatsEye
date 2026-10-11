import { jidNormalizedUser } from '@whiskeysockets/baileys'

export type PresenceState = 'composing' | 'paused' | 'available' | 'unavailable' | 'recording'

type NotifierOptions = { staleMs: number; cooldownMs: number; maxEntries?: number }

export class PresenceNotifier {
  private readonly targetId: string
  private readonly staleMs: number
  private readonly cooldownMs: number
  private readonly maxEntries: number
  private readonly active = new Map<string, number>()
  private lastAttemptAt = Number.NEGATIVE_INFINITY
  private inFlight = false

  constructor(targetId: string, options: NotifierOptions) {
    this.targetId = jidNormalizedUser(targetId)
    this.staleMs = options.staleMs
    this.cooldownMs = options.cooldownMs
    this.maxEntries = options.maxEntries ?? 256
  }

  async handle(
    participantId: string,
    state: PresenceState,
    now: number,
    send: () => Promise<void>,
  ): Promise<boolean> {
    this.prune(now)
    participantId = jidNormalizedUser(participantId)
    if (participantId !== this.targetId) return false

    const activeSince = this.active.get(participantId)
    if (state !== 'composing') {
      this.active.delete(participantId)
      return false
    }

    if (activeSince !== undefined && now - activeSince <= this.staleMs) return false
    this.active.set(participantId, now)
    if (this.inFlight || now - this.lastAttemptAt < this.cooldownMs) return false

    this.inFlight = true
    this.lastAttemptAt = now
    try {
      await send()
      return true
    } finally {
      this.inFlight = false
    }
  }

  private prune(now: number) {
    for (const [id, since] of this.active) {
      if (now - since > this.staleMs) this.active.delete(id)
    }
    while (this.active.size >= this.maxEntries) {
      const oldest = this.active.keys().next().value as string | undefined
      if (!oldest) break
      this.active.delete(oldest)
    }
  }
}
