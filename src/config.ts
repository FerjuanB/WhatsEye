import { readFile } from 'node:fs/promises'
import { jidNormalizedUser } from '@whiskeysockets/baileys'

export type ProbeMode = 'pair' | 'groups' | 'participants' | 'watch' | 'self-test'

export type ProbeConfig = {
  groupJid?: string
  targetJid?: string
  alertToSelf: boolean
  selfMessageTest: boolean
}

export async function loadLocalEnv(path = '.env') {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new Error('Could not read the local .env file.')
  }

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (!match || match[1]!.startsWith('#')) continue
    const [, key, rawValue] = match
    if (process.env[key!] !== undefined) continue
    process.env[key!] = rawValue!.replace(/^(['"])(.*)\1$/, '$2')
  }
}

function parseBoolean(name: string, value: string | undefined): boolean {
  if (value === undefined || value === '') return false
  if (value.toLowerCase() === 'true') return true
  if (value.toLowerCase() === 'false') return false
  throw new Error(`${name} must be true or false.`)
}

function normalizeJid(value: string | undefined, key: string, kind: 'group' | 'user') {
  if (!value) return undefined
  const normalized = jidNormalizedUser(value.trim())
  const valid = kind === 'group'
    ? normalized.endsWith('@g.us')
    : normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@lid')
  if (!valid || normalized.includes(' ')) throw new Error(`${key} must be a valid ${kind} JID.`)
  return normalized
}

export function readProbeConfig(mode: ProbeMode): ProbeConfig {
  const groupJid = normalizeJid(process.env.GROUP_JID, 'GROUP_JID', 'group')
  const targetJid = normalizeJid(process.env.TARGET_JID, 'TARGET_JID', 'user')
  const alertToSelf = parseBoolean('ALERT_TO_SELF', process.env.ALERT_TO_SELF)
  const selfMessageTest = parseBoolean('SELF_MESSAGE_TEST', process.env.SELF_MESSAGE_TEST)

  if ((mode === 'participants' || mode === 'watch') && !groupJid) {
    throw new Error('Set GROUP_JID to a group you participate in before using this command.')
  }
  if (alertToSelf && mode !== 'watch') throw new Error('ALERT_TO_SELF is available only with the watch command.')
  if (alertToSelf && !targetJid) throw new Error('Set TARGET_JID to a group participant before enabling alerts.')
  if (mode === 'self-test' && !selfMessageTest) {
    throw new Error('Set SELF_MESSAGE_TEST=true to explicitly enable the self-message test.')
  }
  if (selfMessageTest && mode !== 'self-test') {
    throw new Error('SELF_MESSAGE_TEST is available only with the self-test command.')
  }

  return { groupJid, targetJid, alertToSelf, selfMessageTest }
}
