import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../src/client.js'

test('theme client registers every compiled definition and disposes them in reverse order', () => {
  const calls: string[] = []
  const ctx = {
    theme: {
      register(definition: { readonly id: string }) {
        calls.push(`register:${definition.id}`)
        return () => { calls.push(`dispose:${definition.id}`) }
      },
    },
  }
  const dispose = apply(ctx as never, {
    themes: [
      { id: 'pack-ocean', colorScheme: 'dark', tokens: { '--dsw-alias-brand-primary': '#08f' } },
      { id: 'pack-paper', colorScheme: 'light', tokens: {} },
    ],
  })

  assert.deepEqual(calls, ['register:pack-ocean', 'register:pack-paper'])
  dispose()
  assert.deepEqual(calls, [
    'register:pack-ocean',
    'register:pack-paper',
    'dispose:pack-paper',
    'dispose:pack-ocean',
  ])
})
