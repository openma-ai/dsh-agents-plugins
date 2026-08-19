import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { dshSkillsAdapter } from '../src/adapters/dsh-skills.js'
import { dshCodexAppsAdapter } from '../src/adapters/dsh-codex-apps.js'
import {
  PluginBridgeKernel,
  type DshPluginRow,
  type InstalledPluginLocator,
} from '../src/kernel.js'
import {
  PluginBridgeManager,
  type BridgeLoader,
} from '../src/manager.js'
import { codexLegacyProvider } from '../src/providers/codex-legacy.js'

class MemoryLoader implements BridgeLoader {
  readonly rows = new Map<string, DshPluginRow>()

  async create(row: DshPluginRow): Promise<string> {
    this.rows.set(row.id, row)
    return row.id
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id)
  }
}

test('local discovery isolates locator failures, deduplicates roots, and never activates rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-discovery-manager-'))
  const packageRoot = join(root, 'foreign')
  await mkdir(packageRoot)
  const kernel = new PluginBridgeKernel(new Context())
  const locator = (name: string): InstalledPluginLocator => ({
    name,
    async discover() {
      return {
        candidates: [{
          key: 'demo', name: 'demo', root: packageRoot, evidence: 'plugin-cache' as const,
        }],
      }
    },
  })
  kernel.registerInstalledPluginLocator(locator('alpha'))
  kernel.registerInstalledPluginLocator(locator('beta'))
  kernel.registerInstalledPluginLocator({
    name: 'zulu',
    async discover() { throw new Error('registry is unreadable') },
  })
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(kernel, loader, join(root, 'bridge'))

  const result = await manager.discoverLocalPlugins()

  assert.deepEqual(result.candidates, [{
    ref: 'alpha:demo',
    locator: 'alpha',
    key: 'demo',
    name: 'demo',
    root: await realpath(packageRoot),
    evidence: 'plugin-cache',
  }])
  assert.equal(result.diagnostics.length, 2)
  assert.match(result.diagnostics[0] ?? '', /beta:demo.*same root.*alpha:demo/i)
  assert.match(result.diagnostics[1] ?? '', /zulu.*registry is unreadable/i)
  assert.equal(loader.rows.size, 0)
})

test('explicit local import copies into bridge storage before transactional materialization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-local-import-'))
  const foreign = join(root, 'foreign-plugin')
  await mkdir(join(foreign, '.codex-plugin'), { recursive: true })
  await mkdir(join(foreign, 'skills', 'demo'), { recursive: true })
  await writeFile(join(foreign, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'demo', skills: './skills/',
  }))
  await writeFile(join(foreign, 'skills', 'demo', 'SKILL.md'), [
    '---', 'name: demo', 'description: Demo', '---', 'Use demo.',
  ].join('\n'))
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerInstalledPluginLocator({
    name: 'codex-local-cache',
    async discover() {
      return {
        candidates: [{
          key: 'personal/demo/1.0.0', name: 'demo', root: foreign,
          evidence: 'plugin-cache' as const, version: '1.0.0', marketplace: 'personal',
        }],
      }
    },
  })
  kernel.registerPackageFormatProvider(codexLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const loader = new MemoryLoader()
  const storage = join(root, 'bridge')
  const manager = new PluginBridgeManager(kernel, loader, storage)

  const installed = await manager.importLocalPlugin('codex-local-cache:personal/demo/1.0.0')

  assert.equal(installed.name, 'demo')
  assert.equal(installed.marketplace, 'import:codex-local-cache')
  assert.equal(installed.format, 'codex-legacy')
  assert.equal(installed.enabled, true)
  assert.equal(installed.rows.length, 1)
  assert.notEqual(installed.root, foreign)
  assert.match(installed.root, /bridge\/plugins\/imports\//)
  assert.match(String(installed.rows[0]?.config?.bundledSkillDir), /bridge\/plugins\/imports\//)
  assert.equal(loader.rows.size, 1)
  assert.equal(await readFile(join(foreign, 'skills', 'demo', 'SKILL.md'), 'utf8'), [
    '---', 'name: demo', 'description: Demo', '---', 'Use demo.',
  ].join('\n'))
  await access(join(installed.root, '.codex-plugin', 'plugin.json'))
})

test('a Codex host-only App imports successfully while retaining its runtime requirement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-codex-host-app-'))
  const foreign = join(root, 'foreign-plugin')
  await mkdir(join(foreign, '.codex-plugin'), { recursive: true })
  await writeFile(join(foreign, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'sites', apps: './.app.json',
  }))
  await writeFile(join(foreign, '.app.json'), JSON.stringify({
    apps: { sites: { id: 'connector_sites', required: true } },
  }))
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerInstalledPluginLocator({
    name: 'codex-local-cache',
    async discover() {
      return { candidates: [{ key: 'sites', name: 'sites', root: foreign, evidence: 'plugin-cache' as const }] }
    },
  })
  kernel.registerPackageFormatProvider(codexLegacyProvider)
  kernel.registerComponentAdapter(dshCodexAppsAdapter)
  const loader = new MemoryLoader()
  const storage = join(root, 'bridge')
  const manager = new PluginBridgeManager(kernel, loader, storage)

  const installed = await manager.importLocalPlugin('codex-local-cache:sites')

  assert.equal(installed.enabled, true)
  assert.deepEqual(installed.rows.map(row => row.name), [
    '@deepseek-ai/dsh-mcp-client',
    '@openma/dsh-agents-plugins-bridge/policies/codex-app-tool-approval',
  ])
  assert.match(
    String((installed.rows[0]?.config?.args as unknown[] | undefined)?.[0]),
    /codex-host-relay-cli\.js$/,
  )
  assert.deepEqual(installed.unsupported, [])
  assert.deepEqual((installed as unknown as { requirements: readonly unknown[] }).requirements, [{
    kind: 'foreign-host',
    host: 'codex',
    capability: 'registered-app-connection',
    componentPath: '.app.json',
    metadata: { app: 'sites', connectionId: 'connector_sites', required: true },
  }])
  assert.equal(loader.rows.size, 2)
  const persisted = JSON.parse(await readFile(join(storage, 'state.json'), 'utf8')) as {
    installations: Array<{ requirements?: readonly unknown[] }>
  }
  assert.equal(persisted.installations[0]?.requirements?.length, 1)
})

test('local import gives Loader a mutable copy without surrendering the stored row id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-loader-boundary-'))
  const foreign = join(root, 'foreign-plugin')
  await mkdir(join(foreign, '.codex-plugin'), { recursive: true })
  await mkdir(join(foreign, 'skills', 'demo'), { recursive: true })
  await writeFile(join(foreign, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'demo', skills: './skills/',
  }))
  await writeFile(join(foreign, 'skills', 'demo', 'SKILL.md'), [
    '---', 'name: demo', 'description: Demo', '---', 'Use demo.',
  ].join('\n'))
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerInstalledPluginLocator({
    name: 'codex-local-cache',
    async discover() {
      return { candidates: [{ key: 'demo', name: 'demo', root: foreign, evidence: 'plugin-cache' as const }] }
    },
  })
  kernel.registerPackageFormatProvider(codexLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const consumedIds: string[] = []
  const loader: BridgeLoader = {
    async create(row) {
      const id = row.id
      delete (row as { id?: string }).id
      consumedIds.push(id)
      return id
    },
    async remove() {},
  }
  const manager = new PluginBridgeManager(kernel, loader, join(root, 'bridge'))

  const installed = await manager.importLocalPlugin('codex-local-cache:demo')

  assert.deepEqual(consumedIds, ['plugin-bridge-demo-skill-skills'])
  assert.equal(installed.rows[0]?.id, 'plugin-bridge-demo-skill-skills')
  assert.equal(manager.listInstallations()[0]?.rows[0]?.id, 'plugin-bridge-demo-skill-skills')
})

test('a failed local import rolls back Loader rows and keeps the foreign package untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-local-import-rollback-'))
  const foreign = join(root, 'foreign-plugin')
  await mkdir(join(foreign, '.codex-plugin'), { recursive: true })
  await mkdir(join(foreign, 'skills', 'demo'), { recursive: true })
  await writeFile(join(foreign, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'demo', skills: './skills/',
  }))
  await writeFile(join(foreign, 'skills', 'demo', 'SKILL.md'), 'foreign stays here')
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerInstalledPluginLocator({
    name: 'codex-local-cache',
    async discover() {
      return { candidates: [{ key: 'demo', name: 'demo', root: foreign, evidence: 'plugin-cache' as const }] }
    },
  })
  kernel.registerPackageFormatProvider(codexLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const active = new Set<string>()
  const loader: BridgeLoader = {
    async create(row) {
      active.add(row.id)
      throw new Error('activation failed')
    },
    async remove(id) { active.delete(id) },
  }
  const manager = new PluginBridgeManager(kernel, loader, join(root, 'bridge'))

  await assert.rejects(() => manager.importLocalPlugin('codex-local-cache:demo'), /activation failed/)

  assert.deepEqual(manager.listInstallations(), [])
  assert.deepEqual([...active], [])
  assert.equal(await readFile(join(foreign, 'skills', 'demo', 'SKILL.md'), 'utf8'), 'foreign stays here')
  assert.deepEqual(await readdir(join(root, 'bridge', 'plugins', 'imports')), [])
  assert.deepEqual(await readdir(join(root, 'bridge', 'data', 'imports')), [])
  assert.equal((await readdir(join(root, 'bridge', 'trash'))).length, 2)
})

test('registered marketplace discovery is read-only and explicit import copies a local catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-marketplace-import-'))
  const foreign = join(root, 'foreign-marketplace')
  await mkdir(join(foreign, '.claude-plugin'), { recursive: true })
  await writeFile(join(foreign, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: 'company-tools',
    plugins: [{
      name: 'remote-tool',
      source: {
        source: 'git-subdir',
        url: 'https://github.com/company/remote-tools.git',
        path: 'plugins/remote-tool',
        sha: 'a1b2c3d4',
      },
    }],
  }))
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerMarketplaceRegistrationLocator({
    name: 'claude-code-registered-marketplaces',
    async discover() {
      return { candidates: [{
        key: 'company-tools',
        name: 'company-tools',
        location: foreign,
        sourceType: 'installed-checkout' as const,
      }] }
    },
  })
  const { claudeCodeMarketplaceProvider } = await import('../src/marketplaces/claude-code.js')
  kernel.registerMarketplaceProvider(claudeCodeMarketplaceProvider)
  const loader = new MemoryLoader()
  const storage = join(root, 'bridge')
  const manager = new PluginBridgeManager(kernel, loader, storage)

  const discovery = await manager.discoverRegisteredMarketplaces()
  assert.deepEqual(discovery, {
    candidates: [{
      ref: 'claude-code-registered-marketplaces:company-tools',
      locator: 'claude-code-registered-marketplaces',
      key: 'company-tools',
      name: 'company-tools',
      location: await realpath(foreign),
      sourceType: 'installed-checkout',
    }],
    diagnostics: [],
  })
  assert.deepEqual(manager.listMarketplaces(), [])

  const imported = await manager.importRegisteredMarketplace(
    'claude-code-registered-marketplaces:company-tools',
  )

  assert.equal(imported.name, 'company-tools')
  assert.deepEqual(imported.plugins, [{
    name: 'remote-tool',
    source: {
      kind: 'git-repository',
      url: 'https://github.com/company/remote-tools.git',
      subdirectory: 'plugins/remote-tool',
      sha: 'a1b2c3d4',
    },
  }])
  assert.notEqual(imported.root, foreign)
  assert.match(imported.root, /bridge\/marketplaces\/imports\//)
  await access(join(imported.root, '.claude-plugin', 'marketplace.json'))
  assert.deepEqual(manager.listMarketplaces().map(marketplace => marketplace.name), ['company-tools'])
})
