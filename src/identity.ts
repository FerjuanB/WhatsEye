import { jidNormalizedUser } from '@whiskeysockets/baileys'

export type GroupMember = { id?: string; lid?: string; phoneNumber?: string }

export function createGroupIdentityIndex(
  members: GroupMember[],
  verifiedMappings: Array<[string, string]> = [],
) {
  const participantMappings = members.flatMap((member) => (
    member.lid && member.phoneNumber ? [[member.phoneNumber, member.lid] as [string, string]] : []
  ))
  return createIdentityIndex(members, [...participantMappings, ...verifiedMappings])
}

export function matchesGroup(eventGroupId: string, configuredGroupId: string) {
  return jidNormalizedUser(eventGroupId) === jidNormalizedUser(configuredGroupId)
}

export function createIdentityIndex(
  members: GroupMember[],
  mappings: Array<[string, string]>,
): { resolve: (id: string) => string | null } {
  const aliases = new Map<string, Set<string>>()

  const addAlias = (alias: string | undefined, canonical: string) => {
    if (!alias) return
    const normalized = jidNormalizedUser(alias)
    if (!normalized) return
    const values = aliases.get(normalized) ?? new Set<string>()
    values.add(canonical)
    aliases.set(normalized, values)
  }

  for (const member of members) {
    const canonical = jidNormalizedUser(member.lid || member.id)
    if (!canonical) continue
    addAlias(member.id, canonical)
    addAlias(member.lid, canonical)
    addAlias(member.phoneNumber, canonical)
  }

  for (const [pn, lid] of mappings) {
    const normalizedPn = jidNormalizedUser(pn)
    const normalizedLid = jidNormalizedUser(lid)
    const pnMembers = aliases.get(normalizedPn)
    const lidMembers = aliases.get(normalizedLid)
    if (pnMembers && lidMembers) {
      const membersInBoth = [...pnMembers].filter((id) => lidMembers.has(id))
      if (membersInBoth.length === 1) {
        addAlias(normalizedPn, membersInBoth[0]!)
        addAlias(normalizedLid, membersInBoth[0]!)
      }
    } else if (pnMembers && pnMembers.size === 1) {
      addAlias(normalizedLid, [...pnMembers][0]!)
    } else if (lidMembers && lidMembers.size === 1) {
      addAlias(normalizedPn, [...lidMembers][0]!)
    }
  }

  return {
    resolve(id: string) {
      const matches = aliases.get(jidNormalizedUser(id))
      return matches?.size === 1 ? [...matches][0]! : null
    },
  }
}
