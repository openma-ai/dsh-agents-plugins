import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

test('the built client registers one DSH ModuleLoader factory with platform-only requires', async () => {
  let handoff: { readonly id: string; readonly factory: (require: (id: string) => unknown) => unknown } | undefined
  const styles: unknown[] = []
  const context = {
    window: {
      __ModuleLoader__: {
        load(value: typeof handoff) { handoff = value },
      },
    },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: (value: unknown) => { styles.push(value) } },
    },
    console,
  }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), context)

  assert.equal(handoff?.id, '@openma/dsh-agents-plugins-bridge-ui')
  const required: string[] = []
  const exports = handoff?.factory((id) => {
    required.push(id)
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return jsxRuntime
    throw new Error(`unexpected client platform require: ${id}`)
  }) as { readonly apply?: unknown; readonly inject?: unknown }

  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(Array.from(exports.inject as readonly string[]), ['slots', 'locale', 'remote'])
  assert.deepEqual([...new Set(required)].sort(), ['react', 'react/jsx-runtime'])
  assert.equal(styles.length, 1)
})
