import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function bundleRows(packagePath: string): Promise<Array<{ id?: string; name?: string }>> {
  const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as {
    dsh?: { bundle?: { patch?: string } }
  }
  const relativePatch = manifest.dsh?.bundle?.patch
  assert.equal(typeof relativePatch, 'string')
  const document = parse(await readFile(resolve(dirname(packagePath), relativePatch!), 'utf8')) as Array<{
    insert?: Array<{ id?: string; name?: string }>
  }>
  return document.flatMap(entry => entry.insert ?? [])
}

test('root package is the one-install bundle while its Web surface stays adaptive', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    publishConfig?: { access?: string }
  }
  assert.equal(manifest.dependencies?.['@openma/dsh-agents-plugins-bridge-ui'], '0.1.0')
  assert.equal(manifest.publishConfig?.access, 'public')

  const rows = await bundleRows(resolve(root, 'package.json'))
  const ids = new Set(rows.map(row => row.id))

  for (const id of [
    'plugin-bridge-kernel',
    'plugin-bridge-adapter-skills',
    'plugin-bridge-adapter-mcp',
    'plugin-bridge-adapter-agent-plugins-mcp',
    'plugin-bridge-adapter-hooks',
    'plugin-bridge-adapter-prompt-commands',
    'plugin-bridge-runtime',
    'plugin-bridge-command',
    'plugin-bridge-ui-auto',
  ]) {
    assert.ok(ids.has(id), `missing root bundle row ${id}`)
  }

  assert.equal(ids.has('plugin-bridge-ui-host'), false)
  assert.equal(ids.has('plugin-bridge-ui'), false)
})

test('Web UI bundle owns only the settings gateway and Web client rows', async () => {
  const rows = await bundleRows(resolve(root, 'packages/ui/package.json'))
  assert.deepEqual(rows, [
    {
      id: 'plugin-bridge-ui-host',
      name: '@openma/dsh-agents-plugins-bridge/ui-host',
    },
    {
      id: 'plugin-bridge-ui',
      name: '@openma/dsh-agents-plugins-bridge-ui',
    },
  ])
})
