import { open, readFile, rm } from 'node:fs/promises'

const BUSY_MESSAGE = 'Another probe process is using AUTH_DIR; stop it before running this command.'

export type AuthLockOptions = {
  isProcessAlive?: (pid: number) => boolean
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

async function createLockFile(lockPath: string): Promise<void> {
  const handle = await open(lockPath, 'wx')
  try {
    await handle.writeFile(String(process.pid))
  } finally {
    await handle.close()
  }
}

// 'missing' means the file vanished, 'invalid' means it exists but has no usable PID yet (possibly mid-write).
async function readLockPid(lockPath: string): Promise<number | 'missing' | 'invalid'> {
  try {
    const pid = Number.parseInt((await readFile(lockPath, 'utf8')).trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : 'invalid'
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 'missing'
    throw error
  }
}

export async function acquireAuthLock(lockPath: string, options: AuthLockOptions = {}): Promise<() => Promise<void>> {
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive
  try {
    await createLockFile(lockPath)
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error
    const pid = await readLockPid(lockPath)
    if (pid === 'invalid') throw new Error(BUSY_MESSAGE)
    if (typeof pid === 'number' && isProcessAlive(pid)) throw new Error(BUSY_MESSAGE)
    // Either the recorded process is gone or the file already vanished. Retry the create exactly once.
    await rm(lockPath, { force: true })
    try {
      await createLockFile(lockPath)
    } catch (retryError) {
      if (errorCode(retryError) === 'EEXIST') throw new Error(BUSY_MESSAGE)
      throw retryError
    }
  }

  return async () => {
    let recorded: string
    try {
      recorded = await readFile(lockPath, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return
      throw error
    }
    if (recorded.trim() !== String(process.pid)) return
    await rm(lockPath, { force: true })
  }
}
