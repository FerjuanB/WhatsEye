import net from 'node:net'

// Node tries each resolved address for only 250 ms by default. On slow links the IPv4 handshake can take longer,
// and when IPv6 has no route every attempt fails and fetch reports ETIMEDOUT.
export const MIN_CONNECT_ATTEMPT_TIMEOUT_MS = 2_000

export function configureNetworkDefaults() {
  const current = net.getDefaultAutoSelectFamilyAttemptTimeout()
  if (current < MIN_CONNECT_ATTEMPT_TIMEOUT_MS) net.setDefaultAutoSelectFamilyAttemptTimeout(MIN_CONNECT_ATTEMPT_TIMEOUT_MS)
}
