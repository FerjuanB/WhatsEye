import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { acquireAuthLock } from '../src/lock.js'

async function withLockPath(run: (lockPath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'probe-lock-'))
  try {
    await run(join(directory, 'auth_info.lock'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('acquire creates the lock file containing this process PID', async () => {
  await withLockPath(async (lockPath) => {
    const release = await acquireAuthLock(lockPath)
    assert.equal(await readFile(lockPath, 'utf8'), String(process.pid))
    await release()
  })
})

test('a second acquire while the lock is held is rejected without leaking paths or PIDs', async () => {
  await withLockPath(async (lockPath) => {
    const release = await acquireAuthLock(lockPath)
    await assert.rejects(acquireAuthLock(lockPath), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Another probe process is using AUTH_DIR; stop it before running this command.')
      assert.ok(!error.message.includes(lockPath))
      assert.ok(!error.message.includes(String(process.pid)))
      return true
    })
    await release()
  })
})

test('a stale lock whose process is not alive is taken over', async () => {
  await withLockPath(async (lockPath) => {
    await writeFile(lockPath, '999999')
    const release = await acquireAuthLock(lockPath, { isProcessAlive: () => false })
    assert.equal(await readFile(lockPath, 'utf8'), String(process.pid))
    await release()
  })
})

test('an empty or unreadable lock may still be mid-write, so it fails closed', async () => {
  await withLockPath(async (lockPath) => {
    await writeFile(lockPath, '')
    await assert.rejects(acquireAuthLock(lockPath, { isProcessAlive: () => false }), {
      message: 'Another probe process is using AUTH_DIR; stop it before running this command.',
    })
    assert.equal(await readFile(lockPath, 'utf8'), '')
  })
})

test('release removes the lock so a later acquire succeeds', async () => {
  await withLockPath(async (lockPath) => {
    const release = await acquireAuthLock(lockPath)
    await release()
    await assert.rejects(readFile(lockPath, 'utf8'), { code: 'ENOENT' })
    const second = await acquireAuthLock(lockPath)
    await second()
  })
})

test('release keeps a lock that now records a different PID', async () => {
  await withLockPath(async (lockPath) => {
    const release = await acquireAuthLock(lockPath)
    await writeFile(lockPath, '999999')
    await release()
    assert.equal(await readFile(lockPath, 'utf8'), '999999')
  })
})
