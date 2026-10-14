# Reconnect schedule and session lock

## Objective

Make long-running commands recover from disconnects without a hard give-up, and stop two probe processes from using the same linked session (`AUTH_DIR`) at once.

## Parts

- **Part A, reconnect schedule.** Replace the five-attempt limit and uptime-based reset with a fixed delay schedule. Delays: attempts 1 to 5 double from 1s to 16s; attempts 6 to 10 grow by 90s steps (90s to 450s); attempts 11 and later wait 300s, with no upper limit on attempts. The counter resets to 0 when a connection reaches `open`.
- **Part B, session lock.** Create `<AUTH_DIR>.lock` beside the auth directory, containing the owning PID. A live owner blocks the command. A stale lock (dead PID) is taken over once. Release removes the file only when it still records this PID. The lock is acquired in `runProbe` before any auth state is read, for every mode, including `unpair`.

## Route

Delegated writer (single writer, one worker). Tests were written first for both parts, and RED was observed before implementation.

## Checklist

- [x] A1 `reconnectDelayMs` test written first (attempts 1, 5, 6, 7, 10, 11, 50). RED observed: `reconnectDelayMs` not exported, suite failed to load.
- [x] A2 `reconnectDelayMs` implemented in `src/runtime.ts`; `MAX_RECONNECTS`, `STABLE_CONNECTION_MS`, `nextReconnectCount` and the reconnect-limit throws removed.
- [x] A3 Counter reset to 0 after `opened: true` is observed in the loop; `openedAt` removed.
- [x] A4 Failed attempts (never opened, or closed after open) increment and wait `reconnectDelayMs(counter)`; log lines print attempt number and seconds without a `/MAX` suffix.
- [x] A5 One-shot modes and `loggedOut` paths unchanged.
- [x] A6 Unused `nextReconnectCount` import removed from the test file.
- [ ] A7 Live reconnect behavior against a real account: not validated (needs a controlled account and a forced disconnect).
- [x] B1 Lock tests written first in `test/lock.test.ts` (5 cases). RED observed: module `src/lock.ts` missing, suite failed to load.
- [x] B2 `acquireAuthLock` in `src/lock.ts` (`open` with `wx`, live-PID check with EPERM treated as alive, one stale retry, PID-checked release).
- [x] B3 Wired in `runProbe` as a wrapper around `runLockedProbe` (the previous body), so `unpair` and every other mode are covered. Lock acquisition failure throws before any auth access.
- [x] B4 `.gitignore` entry `/auth_*.lock`.
- [ ] B5 Two real processes on one `AUTH_DIR` with a live socket: not validated (only the file-level logic is unit-tested).

## Verification evidence

- `npx tsx --test test/runtime.test.ts` before Part A implementation: failed to load, `reconnectDelayMs` not provided by `../src/runtime.js`.
- `npx tsx --test test/lock.test.ts` before B implementation: failed to load, `src/lock.ts` missing.
- `npx tsx --test test/lock.test.ts` after implementation: 5 pass, 0 fail.
- `npm test`: 43 pass, 0 fail, exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.

## Decisions beyond the spec

- The lock wrapper is `runProbe` -> `acquireAuthLock(\`${authPath}.lock\`)` -> `runLockedProbe`, so the existing signal-handler setup and body are unchanged.
- A lock file with an empty, unreadable, or non-numeric PID fails closed as busy, because another process may be mid-write. Only a parsed PID whose process is gone counts as stale.
- If the stale-lock retry also finds the file, the same busy message is thrown.

## Known risk

- The counter resets on every `open`. A connection that opens and then closes repeatedly (flapping) keeps restarting at attempt 1 (1s delay). The spec requires this reset; the flapping loop has no cap. Needs a live observation before relying on it.

## Pending

- Live reconnect schedule and live two-process lock behavior are unvalidated (A7, B5). No WhatsApp behavior is claimed.
- `SPEC.md` line 42 still says "at most five retries with exponential delays capped at 30 seconds". It is outside the allowed edit surfaces and was not changed; it is now stale.
