import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { startPluginAutoUpdates } from '../src/runtime.js'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('automatic plugin reconciliation runs immediately, repeats, and stops with the runtime', async () => {
  let calls = 0
  const stop = startPluginAutoUpdates(async () => {
    calls += 1
  }, 10)

  await delay(35)
  assert.ok(calls >= 2, `expected repeated reconciliation, received ${calls} call(s)`)

  await stop()
  const stoppedAt = calls
  await delay(25)
  assert.equal(calls, stoppedAt)
})

test('stopping automatic reconciliation waits for an in-flight update', async () => {
  const entered = deferred()
  const release = deferred()
  const stop = startPluginAutoUpdates(async () => {
    entered.resolve()
    await release.promise
  }, 10)
  await entered.promise

  let stopped = false
  const stopping = Promise.resolve(stop()).then(() => { stopped = true })
  await delay(5)
  assert.equal(stopped, false)

  release.resolve()
  await stopping
  assert.equal(stopped, true)
})
