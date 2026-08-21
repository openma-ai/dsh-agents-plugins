import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createReleasePlan } from '../src/release-plan.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('release plan publishes runtime packages before the one-install root', async () => {
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
    version: string
  }
  assert.deepEqual(await createReleasePlan(root, `v${version}`), [
    {
      directory: 'packages/theme-adapter',
      name: '@openma/dsh-agents-plugins-bridge-theme',
      version,
    },
    {
      directory: 'packages/ui',
      name: '@openma/dsh-agents-plugins-bridge-ui',
      version,
    },
    {
      directory: '.',
      name: '@openma/dsh-agents-plugins-bridge',
      version,
    },
  ])
})

test('release uses npm Trusted Publisher without a long-lived token', async () => {
  const workflow = await readFile(resolve(root, '.github/workflows/release.yml'), 'utf8')
  assert.match(workflow, /id-token:\s*write/u)
  assert.match(workflow, /actions\/setup-node@v6/u)
  assert.match(workflow, /package-manager-cache:\s*false/u)
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN/u)

  for (const file of ['package.json', 'packages/theme-adapter/package.json', 'packages/ui/package.json']) {
    const manifest = JSON.parse(await readFile(resolve(root, file), 'utf8')) as {
      repository?: { url?: string }
    }
    assert.equal(manifest.repository?.url, 'git+https://github.com/openma-ai/dsh-agents-plugins.git')
  }
})
