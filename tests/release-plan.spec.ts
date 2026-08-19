import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createReleasePlan } from '../src/release-plan.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('release plan publishes child plugin packages before the one-install root', async () => {
  assert.deepEqual(await createReleasePlan(root, 'v0.1.0'), [
    {
      directory: 'packages/theme-adapter',
      name: '@openma/dsh-agents-plugins-bridge-theme',
      version: '0.1.0',
    },
    {
      directory: 'packages/ui',
      name: '@openma/dsh-agents-plugins-bridge-ui',
      version: '0.1.0',
    },
    {
      directory: '.',
      name: '@openma/dsh-agents-plugins-bridge',
      version: '0.1.0',
    },
  ])
})
