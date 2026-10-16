import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'
import { MIN_CONNECT_ATTEMPT_TIMEOUT_MS, configureNetworkDefaults } from '../src/network.js'

test('raises the per-address connect attempt timeout above the 250 ms Node default', () => {
  const original = net.getDefaultAutoSelectFamilyAttemptTimeout()
  try {
    net.setDefaultAutoSelectFamilyAttemptTimeout(250)
    configureNetworkDefaults()
    assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), MIN_CONNECT_ATTEMPT_TIMEOUT_MS)
  } finally {
    net.setDefaultAutoSelectFamilyAttemptTimeout(original)
  }
})

test('keeps a larger timeout chosen through NODE_OPTIONS', () => {
  const original = net.getDefaultAutoSelectFamilyAttemptTimeout()
  try {
    net.setDefaultAutoSelectFamilyAttemptTimeout(MIN_CONNECT_ATTEMPT_TIMEOUT_MS + 1000)
    configureNetworkDefaults()
    assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), MIN_CONNECT_ATTEMPT_TIMEOUT_MS + 1000)
  } finally {
    net.setDefaultAutoSelectFamilyAttemptTimeout(original)
  }
})
