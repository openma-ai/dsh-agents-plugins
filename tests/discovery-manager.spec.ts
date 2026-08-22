import assert from 'node:assert/strict'
import { access, cp, mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { dshSkillsAdapter } from '../src/adapters/dsh-skills.js'
import { dshCodexAppsAdapter } from '../src/adapters/dsh-codex-apps.js'
import { dshPiSkillsAdapter } from '../src/adapters/dsh-pi-skills.js'
import {
  PluginBridgeKernel,
  type DshPluginRow,
  type InstalledPluginLocator,
} from '../src/kernel.js'
import {
  PluginBridgeManager,
  type BridgeLoader,
  type GitRepositoryAcquirer,
} from '../src/manager.js'
import { claudeCodeMarketplaceProvider } from '../src/marketplaces/claude-code.js'
import { codexMarketplaceProvider } from '../src/marketplaces/codex.js'
import { codexLegacyProvider } from '../src/providers/codex-legacy.js'
import { claudeCodeLegacyProvider } from '../src/providers/claude-code-legacy.js'
import { piPackageProvider } from '../src/providers/pi-package.js'

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

test('a Codex cache import updates to the newest discovered version at the stable bridge root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-codex-auto-update-'))
  const versionRoots = new Map<string, string>()
  for (const [version, body] of [
    ['1.0.0', 'Use demo v1.'],
    ['1.1.0-rc.2', 'Use demo v1.1 RC.'],
    ['1.1.0', 'Use demo v1.1.'],
  ] as const) {
    const pluginRoot = join(root, 'cache', 'personal', 'demo', version)
    await mkdir(join(pluginRoot, '.codex-plugin'), { recursive: true })
    await mkdir(join(pluginRoot, 'skills', 'demo'), { recursive: true })
    await writeFile(join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({
      name: 'demo', skills: './skills/',
    }))
    await writeFile(join(pluginRoot, 'skills', 'demo', 'SKILL.md'), body)
    versionRoots.set(version, pluginRoot)
  }
  let visibleVersions = ['1.0.0']
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerInstalledPluginLocator({
    name: 'codex-local-cache',
    async discover() {
      return {
        candidates: visibleVersions.map(version => ({
          key: `personal/demo/${version}`,
          name: 'demo',
          root: versionRoots.get(version)!,
          evidence: 'plugin-cache' as const,
          version,
          marketplace: 'personal',
        })),
      }
    },
  })
  kernel.registerPackageFormatProvider(codexLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const loader = new MemoryLoader()
  const storage = join(root, 'bridge')
  const manager = new PluginBridgeManager(kernel, loader, storage)
  const installed = await manager.importLocalPlugin('codex-local-cache:personal/demo/1.0.0')
  const stableRoot = installed.root

  visibleVersions = ['1.0.0', '1.1.0-rc.2', '1.1.0']
  const report = await manager.syncImportedPlugins()

  assert.deepEqual(report, {
    updated: [{ name: 'demo', fromVersion: '1.0.0', toVersion: '1.1.0' }],
    diagnostics: [],
  })
  assert.equal(manager.listInstallations()[0]?.root, stableRoot)
  assert.equal(
    await readFile(join(stableRoot, 'skills', 'demo', 'SKILL.md'), 'utf8'),
    'Use demo v1.1.',
  )
  assert.equal(loader.rows.size, 1)
  const persisted = JSON.parse(await readFile(join(storage, 'state.json'), 'utf8')) as {
    installations: Array<{ source?: { version?: string } }>
  }
  assert.equal(persisted.installations[0]?.source?.version, '1.1.0')
})

test('a failed Codex cache auto-update restores the old package and active rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-codex-auto-update-rollback-'))
  const versionRoots = new Map<string, string>()
  for (const [version, body] of [['1.0.0', 'Use stable demo.'], ['2.0.0', 'Use rejected demo.']] as const) {
    const pluginRoot = join(root, 'cache', 'personal', 'demo', version)
    await mkdir(join(pluginRoot, '.codex-plugin'), { recursive: true })
    await mkdir(join(pluginRoot, 'skills', 'demo'), { recursive: true })
    await writeFile(join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({
      name: 'demo', skills: './skills/',
    }))
    await writeFile(join(pluginRoot, 'skills', 'demo', 'SKILL.md'), body)
    versionRoots.set(version, pluginRoot)
  }
  let visibleVersions = ['1.0.0']
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerInstalledPluginLocator({
    name: 'codex-local-cache',
    async discover() {
      return {
        candidates: visibleVersions.map(version => ({
          key: `personal/demo/${version}`,
          name: 'demo',
          root: versionRoots.get(version)!,
          evidence: 'plugin-cache' as const,
          version,
          marketplace: 'personal',
        })),
      }
    },
  })
  kernel.registerPackageFormatProvider(codexLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const rows = new Map<string, DshPluginRow>()
  const loader: BridgeLoader = {
    async create(row) {
      const skillRoot = String(row.config?.bundledSkillDir)
      const body = await readFile(join(skillRoot, 'demo', 'SKILL.md'), 'utf8')
      if (body === 'Use rejected demo.') throw new Error('new plugin activation rejected')
      rows.set(row.id, row)
      return row.id
    },
    async remove(id) {
      if (!rows.delete(id)) throw new Error(`unknown loader row ${id}`)
    },
  }
  const storage = join(root, 'bridge')
  const manager = new PluginBridgeManager(kernel, loader, storage)
  const installed = await manager.importLocalPlugin('codex-local-cache:personal/demo/1.0.0')

  visibleVersions = ['1.0.0', '2.0.0']
  const report = await manager.syncImportedPlugins()

  assert.deepEqual(report.updated, [])
  assert.match(report.diagnostics[0] ?? '', /demo.*2\.0\.0.*activation rejected/i)
  assert.equal(
    await readFile(join(installed.root, 'skills', 'demo', 'SKILL.md'), 'utf8'),
    'Use stable demo.',
  )
  assert.equal(rows.size, 1)
  const persisted = JSON.parse(await readFile(join(storage, 'state.json'), 'utf8')) as {
    installations: Array<{ source?: { version?: string } }>
  }
  assert.equal(persisted.installations[0]?.source?.version, '1.0.0')
})

test('a Codex cache auto-update rejects symlinks without interrupting reconciliation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-codex-auto-update-symlink-'))
  const versionRoots = new Map<string, string>()
  for (const version of ['1.0.0', '2.0.0']) {
    const pluginRoot = join(root, 'cache', 'personal', 'demo', version)
    await mkdir(join(pluginRoot, '.codex-plugin'), { recursive: true })
    await mkdir(join(pluginRoot, 'skills', 'demo'), { recursive: true })
    await writeFile(join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({
      name: 'demo', skills: './skills/',
    }))
    await writeFile(join(pluginRoot, 'skills', 'demo', 'SKILL.md'), `Use demo ${version}.`)
    versionRoots.set(version, pluginRoot)
  }
  await symlink(
    join(root, 'missing-secret.txt'),
    join(versionRoots.get('2.0.0')!, 'skills', 'demo', 'secret.txt'),
  )
  let visibleVersions = ['1.0.0']
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerInstalledPluginLocator({
    name: 'codex-local-cache',
    async discover() {
      return {
        candidates: visibleVersions.map(version => ({
          key: `personal/demo/${version}`,
          name: 'demo',
          root: versionRoots.get(version)!,
          evidence: 'plugin-cache' as const,
          version,
          marketplace: 'personal',
        })),
      }
    },
  })
  kernel.registerPackageFormatProvider(codexLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(kernel, loader, join(root, 'bridge'))
  const installed = await manager.importLocalPlugin('codex-local-cache:personal/demo/1.0.0')

  visibleVersions = ['1.0.0', '2.0.0']
  const report = await manager.syncImportedPlugins()

  assert.deepEqual(report.updated, [])
  assert.match(report.diagnostics[0] ?? '', /demo.*2\.0\.0.*unsupported symlink/i)
  assert.equal(
    await readFile(join(installed.root, 'skills', 'demo', 'SKILL.md'), 'utf8'),
    'Use demo 1.0.0.',
  )
  assert.equal(loader.rows.size, 1)
})

test('a Claude Code import follows the exact installed registry entry including rollback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-claude-auto-update-'))
  const versionRoots = new Map<string, string>()
  for (const [version, body] of [['1.0.0', 'Use registry v1.'], ['2.0.0', 'Use registry v2.']] as const) {
    const pluginRoot = join(root, 'cache', version)
    await mkdir(join(pluginRoot, '.claude-plugin'), { recursive: true })
    await mkdir(join(pluginRoot, 'skills', 'demo'), { recursive: true })
    await writeFile(join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'claude-demo', version,
    }))
    await writeFile(join(pluginRoot, 'skills', 'demo', 'SKILL.md'), body)
    versionRoots.set(version, pluginRoot)
  }
  let activeVersion = '2.0.0'
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerInstalledPluginLocator({
    name: 'claude-code-installed',
    async discover() {
      return {
        candidates: [{
          key: 'claude-demo@company#user',
          name: 'claude-demo',
          root: versionRoots.get(activeVersion)!,
          evidence: 'installed-registry' as const,
          version: activeVersion,
          marketplace: 'company',
          scope: 'user',
        }],
      }
    },
  })
  kernel.registerPackageFormatProvider(claudeCodeLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(kernel, loader, join(root, 'bridge'))
  const installed = await manager.importLocalPlugin(
    'claude-code-installed:claude-demo@company#user',
  )

  activeVersion = '1.0.0'
  const report = await manager.syncImportedPlugins()

  assert.deepEqual(report, {
    updated: [{ name: 'claude-demo', fromVersion: '2.0.0', toVersion: '1.0.0' }],
    diagnostics: [],
  })
  assert.equal(
    await readFile(join(installed.root, 'skills', 'demo', 'SKILL.md'), 'utf8'),
    'Use registry v1.',
  )
  assert.equal(loader.rows.size, 1)
})

test('Pi reconciliation follows npm and git roots but leaves local packages explicit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-pi-auto-update-'))
  const roots = {
    npm: join(root, 'npm-demo'),
    git: join(root, 'git-demo'),
    local: join(root, 'local-demo'),
  }
  const writePackage = async (
    packageRoot: string,
    name: string,
    body: string,
    version?: string,
  ): Promise<void> => {
    await mkdir(join(packageRoot, 'skills', 'demo'), { recursive: true })
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name,
      ...version === undefined ? {} : { version },
      pi: { skills: ['skills/'] },
    }))
    await writeFile(join(packageRoot, 'skills', 'demo', 'SKILL.md'), body)
  }
  await writePackage(roots.npm, 'npm-demo', 'Use npm v1.', '1.0.0')
  await writePackage(roots.git, 'git-demo', 'Use git checkout one.')
  await writePackage(roots.local, 'local-demo', 'Use local edit one.', '1.0.0')
  let npmVersion = '1.0.0'
  let localVersion = '1.0.0'
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerInstalledPluginLocator({
    name: 'pi-installed-user',
    async discover() {
      return {
        candidates: [{
          key: 'user/npm/npm-demo',
          name: 'npm-demo',
          root: roots.npm,
          evidence: 'installed-registry' as const,
          version: npmVersion,
          scope: 'user',
          upstreamSource: 'npm:npm-demo',
        }, {
          key: 'user/git/example.com%2Fgit-demo',
          name: 'git-demo',
          root: roots.git,
          evidence: 'installed-registry' as const,
          scope: 'user',
          upstreamSource: 'git:https://example.com/git-demo.git',
        }, {
          key: 'user/local/0123456789abcdef',
          name: 'local-demo',
          root: roots.local,
          evidence: 'installed-registry' as const,
          version: localVersion,
          scope: 'user',
        }],
      }
    },
  })
  kernel.registerPackageFormatProvider(piPackageProvider)
  kernel.registerComponentAdapter(dshPiSkillsAdapter)
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(kernel, loader, join(root, 'bridge'))
  const npmInstalled = await manager.importLocalPlugin('pi-installed-user:user/npm/npm-demo')
  const gitInstalled = await manager.importLocalPlugin('pi-installed-user:user/git/example.com%2Fgit-demo')
  const localInstalled = await manager.importLocalPlugin('pi-installed-user:user/local/0123456789abcdef')

  assert.equal(npmInstalled.source?.upstreamSource, 'npm:npm-demo')
  assert.equal(gitInstalled.source?.upstreamSource, 'git:https://example.com/git-demo.git')
  assert.equal(localInstalled.source?.upstreamSource, undefined)

  npmVersion = '2.0.0'
  localVersion = '2.0.0'
  await writePackage(roots.npm, 'npm-demo', 'Use npm v2.', npmVersion)
  await writePackage(roots.git, 'git-demo', 'Use git checkout two.')
  await writePackage(roots.local, 'local-demo', 'Use local edit two.', localVersion)
  const report = await manager.syncImportedPlugins()

  assert.deepEqual(report, {
    updated: [
      { name: 'npm-demo', fromVersion: '1.0.0', toVersion: '2.0.0' },
      { name: 'git-demo' },
    ],
    diagnostics: [],
  })
  assert.equal(
    await readFile(join(npmInstalled.root, 'skills', 'demo', 'SKILL.md'), 'utf8'),
    'Use npm v2.',
  )
  assert.equal(
    await readFile(join(gitInstalled.root, 'skills', 'demo', 'SKILL.md'), 'utf8'),
    'Use git checkout two.',
  )
  assert.equal(
    await readFile(join(localInstalled.root, 'skills', 'demo', 'SKILL.md'), 'utf8'),
    'Use local edit one.',
  )
  assert.equal(loader.rows.size, 3)

  await manager.dispose()
  const statePath = join(root, 'bridge', 'state.json')
  const persisted = JSON.parse(await readFile(statePath, 'utf8')) as {
    installations: Array<{ name: string; source?: unknown }>
  }
  const legacyGit = persisted.installations.find(installation => installation.name === 'git-demo')
  assert.ok(legacyGit)
  delete legacyGit.source
  await writeFile(statePath, `${JSON.stringify(persisted, undefined, 2)}\n`)

  const restarted = new PluginBridgeManager(kernel, new MemoryLoader(), join(root, 'bridge'))
  await restarted.start()
  assert.deepEqual(await restarted.syncImportedPlugins(), { updated: [], diagnostics: [] })
  assert.equal(
    restarted.listInstallations().find(installation => installation.name === 'git-demo')?.source?.upstreamSource,
    'git:https://example.com/git-demo.git',
  )
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

test('a Codex Git registration selects its Codex catalog from a multi-agent repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-codex-marketplace-import-'))
  const foreign = join(root, 'foreign-marketplace')
  await mkdir(join(foreign, '.agents', 'plugins'), { recursive: true })
  await mkdir(join(foreign, '.claude-plugin'), { recursive: true })
  await writeFile(join(foreign, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
    name: 'chatcut-inc',
    plugins: [{ name: 'chatcut-codex', source: { source: 'local', path: './codex' } }],
  }))
  await writeFile(join(foreign, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: 'chatcut-inc',
    plugins: [{ name: 'chatcut-claude', source: './claude' }],
  }))
  const acquirer: GitRepositoryAcquirer = {
    async clone(_repo, destination) {
      await cp(foreign, destination, { recursive: true })
    },
  }
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerMarketplaceRegistrationLocator({
    name: 'codex-registered-marketplaces',
    async discover() {
      return { candidates: [{
        key: 'chatcut-inc',
        name: 'chatcut-inc',
        location: 'https://github.com/ChatCut-Inc/agent-plugin.git',
        sourceType: 'git' as const,
        revision: 'main',
        manifestPath: '.agents/plugins/marketplace.json',
      }] }
    },
  })
  kernel.registerMarketplaceProvider(codexMarketplaceProvider)
  kernel.registerMarketplaceProvider(claudeCodeMarketplaceProvider)
  const manager = new PluginBridgeManager(
    kernel,
    new MemoryLoader(),
    join(root, 'bridge'),
    { git: acquirer },
  )

  const imported = await manager.importRegisteredMarketplace(
    'codex-registered-marketplaces:chatcut-inc',
  )

  assert.equal(imported.provider, 'codex-marketplace')
  assert.deepEqual(imported.plugins.map(plugin => plugin.name), ['chatcut-codex'])
})
