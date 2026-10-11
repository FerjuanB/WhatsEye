import { jidNormalizedUser } from '@whiskeysockets/baileys'

export const PRESENCE_ALERT_TEXT = 'A participant may be composing in the selected group.'
export const RECIPIENT_TEST_TEXT = 'WhatsApp recipient alert test.'

export type PhoneIdentity = { id?: string; phoneNumber?: string; lid?: string }
export type SignalMappings = {
  getPNForLID: (lid: string) => Promise<string | null>
  getLIDForPN: (pn: string) => Promise<string | null>
}

function phoneJid(value: string | null | undefined): string | undefined {
  if (!value || !/^\d+(?::\d+)?@s\.whatsapp\.net$/.test(value)) return undefined
  return jidNormalizedUser(value)
}

function lidJid(value: string | null | undefined): string | undefined {
  if (!value || !/^\d+(?::\d+)?@lid$/.test(value)) return undefined
  return jidNormalizedUser(value)
}

export function selectPresenceDestination(
  config: { alertToSelf: boolean; alertToJid?: string },
  selfJid?: string,
): string | undefined {
  if (config.alertToSelf && config.alertToJid) throw new Error('Self and explicit alert destinations cannot be combined.')
  if (config.alertToJid) return jidNormalizedUser(config.alertToJid)
  return config.alertToSelf && selfJid ? jidNormalizedUser(selfJid) : undefined
}

export function createFixedTextSender(
  destination: string,
  send: (jid: string, text: string) => Promise<unknown>,
) {
  return async (text: string) => send(destination, text)
}

export async function assertRecipientIsNotSender(
  recipientJid: string,
  ownIdentities: PhoneIdentity[],
  mappings: SignalMappings,
): Promise<void> {
  const recipient = phoneJid(recipientJid)
  if (!recipient) throw new Error('ALERT_TO_JID must be a valid phone-number JID.')

  const ownPhones = new Set<string>()
  const ownLids = new Set<string>()
  for (const identity of ownIdentities) {
    const directPhone = phoneJid(identity.phoneNumber) ?? phoneJid(identity.id)
    if (directPhone) ownPhones.add(directPhone)
    const directLid = lidJid(identity.lid) ?? lidJid(identity.id)
    if (directLid) ownLids.add(directLid)
  }

  for (const lid of ownLids) {
    try {
      const mappedPhone = phoneJid(await mappings.getPNForLID(lid))
      if (mappedPhone) ownPhones.add(mappedPhone)
    } catch {
      // Keep optional identity lookup failures private; the final check fails closed without a phone identity.
    }
  }

  if (ownPhones.size === 0) throw new Error('The sender phone identity is unavailable; refusing explicit recipient delivery.')
  if (ownPhones.has(recipient)) throw new Error('ALERT_TO_JID resolves to the sender account.')

  for (const phone of ownPhones) {
    try {
      const mappedLid = lidJid(await mappings.getLIDForPN(phone))
      if (mappedLid) ownLids.add(mappedLid)
    } catch { /* Optional alias lookup failures do not establish identity equivalence. */ }
  }

  try {
    const recipientLid = lidJid(await mappings.getLIDForPN(recipient))
    if (recipientLid && ownLids.has(recipientLid)) throw new Error('ALERT_TO_JID resolves to the sender account.')
  } catch (error) {
    if (error instanceof Error && error.message === 'ALERT_TO_JID resolves to the sender account.') throw error
    // A failed optional alias lookup does not establish identity equivalence.
  }
}
