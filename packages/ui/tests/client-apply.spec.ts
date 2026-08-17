import assert from 'node:assert/strict'
import { it as test } from 'vitest'

test('the browser entry mounts its own Remote before contributing UI', async () => {
  const client = await import('../src/client/index.js').catch(() => undefined)
  assert.equal(typeof client?.apply, 'function')
  assert.deepEqual(client?.inject, ['slots', 'locale', 'remote'])
  const events: string[] = []
  const ctx = {
    remote: {
      $mount: async (contribution: { readonly descriptors: readonly unknown[] }) => {
        events.push(`mount:${String(contribution.descriptors.length)}`)
        return async () => { events.push('dispose') }
      },
      agentPluginsBridge: {},
    },
    effect: (factory: () => unknown) => factory(),
    inject: (_services: readonly string[], callback: (scope: unknown) => void) => {
      events.push('remote:inject')
      callback(ctx)
    },
    locale: {
      register: () => { events.push('locale'); return () => {} },
      bind: () => (key: string) => key,
    },
    slots: {
      inject: (_name: string, factory: () => unknown) => { events.push('inject'); factory() },
      register: () => { events.push('register'); return () => {} },
    },
  }

  const dispose = await client?.apply(ctx as never)

  assert.deepEqual(events, ['mount:8', 'remote:inject', 'locale', 'inject', 'register'])
  await dispose?.()
  assert.equal(events.at(-1), 'dispose')
})
