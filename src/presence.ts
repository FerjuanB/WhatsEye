import { jidNormalizedUser } from '@whiskeysockets/baileys'

export type PresenceState = 'composing' | 'paused' | 'available' | 'unavailable' | 'recording'

const ALERT_STATES: ReadonlySet<PresenceState> = new Set<PresenceState>(['composing', 'recording'])

export type AlertCooldown = { lastAlertAt: number }

type NotifierOptions = {
  staleMs: number
  cooldownMs: number
  confirmMs?: number
  cooldown?: AlertCooldown
  maxEntries?: number
}

export class PresenceNotifier {
  private readonly targetId: string
  private readonly staleMs: number
  private readonly cooldownMs: number
  private readonly confirmMs: number
  private readonly cooldown: AlertCooldown
  private readonly maxEntries: number
  private readonly active = new Map<string, number>()
  private cancelConfirmation: (() => void) | undefined
  private inFlight = false

  constructor(targetId: string, options: NotifierOptions) {
    this.targetId = jidNormalizedUser(targetId)
    this.staleMs = options.staleMs
    this.cooldownMs = options.cooldownMs
    this.confirmMs = options.confirmMs ?? 0
    this.cooldown = options.cooldown ?? { lastAlertAt: Number.NEGATIVE_INFINITY }
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

    if (!ALERT_STATES.has(state)) {
      this.active.delete(participantId)
      this.cancelConfirmation?.()
      return false
    }

    const activeSince = this.active.get(participantId)
    if (activeSince !== undefined && now - activeSince <= this.staleMs) {
      this.active.set(participantId, now)
      return false
    }
    this.active.set(participantId, now)
    if (this.inFlight || this.cancelConfirmation || now - this.cooldown.lastAlertAt < this.cooldownMs) return false

    if (this.confirmMs > 0 && !(await this.confirmStillComposing())) return false

    this.inFlight = true
    try {
      await send()
      this.cooldown.lastAlertAt = now + this.confirmMs
      return true
    } finally {
      this.inFlight = false
    }
  }

  dispose() {
    this.cancelConfirmation?.()
  }

  private confirmStillComposing(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.cancelConfirmation = undefined
        resolve(true)
      }, this.confirmMs)
      this.cancelConfirmation = () => {
        clearTimeout(timer)
        this.cancelConfirmation = undefined
        resolve(false)
      }
    })
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
