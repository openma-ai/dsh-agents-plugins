import assert from 'node:assert/strict'
import { cp, lstat, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { dshMcpAdapter } from '../src/adapters/dsh-mcp.js'
import { dshAgentPluginsMcpAdapter } from '../src/adapters/dsh-agent-plugins-mcp.js'
import { dshSkillsAdapter } from '../src/adapters/dsh-skills.js'
import { PluginBridgeKernel, type DshPluginRow } from '../src/kernel.js'
import {
  PluginBridgeManager,
  type BridgeLoader,
  type GitRepositoryAcquirer,
} from '../src/manager.js'
import { claudeCodeMarketplaceProvider } from '../src/marketplaces/claude-code.js'
import { claudeCodeLegacyProvider } from '../src/providers/claude-code-legacy.js'
import { codexMarketplaceProvider } from '../src/marketplaces/codex.js'
import { codexLegacyProvider } from '../src/providers/codex-legacy.js'
import { agentPluginsV1Provider } from '../src/providers/agent-plugins-v1.js'

class MemoryLoader implements BridgeLoader {
  readonly rows = new Map<string, DshPluginRow>()
  readonly removed: string[] = []

  async create(row: DshPluginRow): Promise<string> {
    if (this.rows.has(row.id)) throw new Error(`duplicate loader row ${row.id}`)
    this.rows.set(row.id, row)
    return row.id
  }

  async remove(id: string): Promise<void> {
    if (!this.rows.delete(id)) throw new Error(`unknown loader row ${id}`)
    this.removed.push(id)
  }
}

class FailAfterCreateLoader extends MemoryLoader {
  failAfterCreate = false

  override async create(row: DshPluginRow): Promise<string> {
    const id = await super.create(row)
    if (this.failAfterCreate) {
      this.failAfterCreate = false
      throw new Error('Loader create failed after producing the row')
    }
    return id
  }
}

async function fixture(): Promise<{
  kernel: PluginBridgeKernel
  loader: MemoryLoader
  storage: string
  marketplace: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-manager-'))
  const marketplace = join(root, 'marketplace')
  const plugin = join(marketplace, 'plugins', 'demo')
  await mkdir(join(plugin, '.codex-plugin'), { recursive: true })
  await mkdir(join(plugin, 'skills', 'demo'), { recursive: true })
  await writeFile(join(marketplace, 'marketplace.json'), JSON.stringify({
    name: 'local-codex',
    plugins: [{ name: 'demo', source: { source: 'local', path: './plugins/demo' } }],
  }))
  await writeFile(join(plugin, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'demo',
    skills: './skills/',
  }))
  await writeFile(join(plugin, 'skills', 'demo', 'SKILL.md'), [
    '---',
    'name: demo',
    'description: Demo skill',
    '---',
    'Use the demo.',
  ].join('\n'))

  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerMarketplaceProvider(codexMarketplaceProvider)
  kernel.registerPackageFormatProvider(codexLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  kernel.registerComponentAdapter(dshMcpAdapter)
  return { kernel, loader: new MemoryLoader(), storage: join(root, 'state'), marketplace }
}

test('a marketplace install is copied, normalized, materialized, and durable', async () => {
  const { kernel, loader, storage, marketplace } = await fixture()
  const manager = new PluginBridgeManager(kernel, loader, storage)

  const catalog = await manager.addMarketplace(marketplace)
  const installed = await manager.install('demo@local-codex')

  assert.equal(catalog.name, 'local-codex')
  assert.equal(installed.format, 'codex-legacy')
  assert.deepEqual(installed.unsupported, [])
  assert.equal(installed.rows.length, 1)
  assert.equal(loader.rows.get(installed.rows[0]!.id)?.name, '@deepseek-ai/dsh-skill-filesystem')
  assert.match(String(installed.rows[0]!.config?.bundledSkillDir), /state\/plugins\/local-codex\/demo/)

  const state = JSON.parse(await readFile(join(storage, 'state.json'), 'utf8')) as {
    installations: { name: string; enabled: boolean }[]
  }
  assert.deepEqual(state.installations.map(({ name, enabled }) => ({ name, enabled })), [
    { name: 'demo', enabled: true },
  ])
})

test('an Agent Plugins install creates a persistent PLUGIN_DATA directory before MCP activation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-data-'))
  const marketplace = join(root, 'marketplace')
  const plugin = join(marketplace, 'plugins', 'portable')
  await mkdir(plugin, { recursive: true })
  await writeFile(join(marketplace, 'marketplace.json'), JSON.stringify({
    name: 'portable-marketplace',
    plugins: [{ name: 'portable', source: { source: 'local', path: './plugins/portable' } }],
  }))
  await writeFile(join(plugin, 'plugin.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'portable',
  }))
  await writeFile(join(plugin, 'mcp.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      legacy: { type: 'sse', url: 'https://example.test/sse' },
      server: { type: 'stdio', command: 'node' },
    },
  }))

  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerMarketplaceProvider(codexMarketplaceProvider)
  kernel.registerPackageFormatProvider(agentPluginsV1Provider)
  kernel.registerComponentAdapter(dshAgentPluginsMcpAdapter)
  const loader = new MemoryLoader()
  const storage = join(root, 'state')
  const manager = new PluginBridgeManager(kernel, loader, storage)
  await manager.addMarketplace(marketplace)
  const installed = await manager.install('portable@portable-marketplace')

  const dataRoot = installed.rows[0]?.config?.env as Record<string, string>
  assert.equal(dataRoot.PLUGIN_DATA, join(storage, 'data', 'portable-marketplace', 'portable'))
  assert.equal((await lstat(dataRoot.PLUGIN_DATA)).isDirectory(), true)
  assert.deepEqual(installed.diagnostics, [
    'agent-plugins-v1: skipped MCP server "legacy": transport "sse" is not supported by dsh-mcp-client',
  ])
})

test('startup restores each persisted component row without re-detecting the package', async () => {
  const { kernel, loader, storage, marketplace } = await fixture()
  const first = new PluginBridgeManager(kernel, loader, storage)
  await first.addMarketplace(marketplace)
  const installed = await first.install('demo@local-codex')
  await first.dispose()
  assert.equal(loader.rows.size, 0)

  const restoredLoader = new MemoryLoader()
  const restored = new PluginBridgeManager(new PluginBridgeKernel(new Context()), restoredLoader, storage)
  await restored.start()

  assert.deepEqual([...restoredLoader.rows], installed.rows.map(row => [row.id, row]))
})

test('startup migrates bridge skill roots out of the workspace filesystem sandbox', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-skill-root-migration-'))
  const storage = join(root, 'state')
  const skillRoot = join(storage, 'plugins', 'imports', 'demo', 'skills')
  await mkdir(storage, { recursive: true })
  await writeFile(join(storage, 'state.json'), JSON.stringify({
    version: 1,
    marketplaces: [],
    installations: [{
      name: 'demo', marketplace: 'import:codex-local-cache', format: 'codex-legacy',
      root: join(storage, 'plugins', 'imports', 'demo'), enabled: true,
      rows: [{
        id: 'plugin-bridge-demo-skill-skills',
        name: '@deepseek-ai/dsh-skill-filesystem',
        config: {
          providerName: 'plugin-bridge-demo-skills',
          includeDefaultRoots: false,
          customSkillDirs: [skillRoot],
        },
      }],
      activations: [],
      unsupported: [],
    }],
    approvals: [],
  }))
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(new PluginBridgeKernel(new Context()), loader, storage)

  await manager.start()

  assert.deepEqual(loader.rows.get('plugin-bridge-demo-skill-skills')?.config, {
    providerName: 'plugin-bridge-demo-skills',
    includeDefaultRoots: false,
    bundledSkillDir: skillRoot,
  })
  const persisted = JSON.parse(await readFile(join(storage, 'state.json'), 'utf8')) as {
    installations: Array<{ rows: DshPluginRow[] }>
  }
  assert.equal(persisted.installations[0]?.rows[0]?.config?.bundledSkillDir, skillRoot)
  assert.equal(persisted.installations[0]?.rows[0]?.config?.customSkillDirs, undefined)
})

test('disable and uninstall remove only rows owned by that installation', async () => {
  const { kernel, loader, storage, marketplace } = await fixture()
  const manager = new PluginBridgeManager(kernel, loader, storage)
  await manager.addMarketplace(marketplace)
  const installed = await manager.install('demo@local-codex')

  await manager.disable('demo')
  assert.equal(loader.rows.size, 0)
  assert.deepEqual(loader.removed, installed.rows.map(row => row.id).reverse())
  assert.equal(manager.listInstallations()[0]?.enabled, false)

  await manager.enable('demo')
  assert.equal(loader.rows.size, 1)
  assert.equal(manager.listInstallations()[0]?.enabled, true)

  await manager.uninstall('demo')
  assert.deepEqual(manager.listInstallations(), [])
})

test('a failed enable removes the row whose Loader create failed after producing it', async () => {
  const { kernel, storage, marketplace } = await fixture()
  const loader = new FailAfterCreateLoader()
  const manager = new PluginBridgeManager(kernel, loader, storage)
  await manager.addMarketplace(marketplace)
  await manager.install('demo@local-codex')
  await manager.disable('demo')
  loader.failAfterCreate = true

  await assert.rejects(() => manager.enable('demo'), /failed after producing the row/)

  assert.equal(loader.rows.size, 0)
  assert.equal(manager.listInstallations()[0]?.enabled, false)
})

test('failed Loader activation rolls back earlier component rows and state', async () => {
  const { kernel, storage, marketplace } = await fixture()
  kernel.registerPackageFormatProvider({
    name: 'never',
    probe: () => undefined,
  })
  const created: string[] = []
  const loader: BridgeLoader = {
    async create(row) {
      created.push(row.id)
      throw new Error('activation rejected')
    },
    async remove(id) {
      created.splice(created.indexOf(id), 1)
    },
  }
  const manager = new PluginBridgeManager(kernel, loader, storage)
  await manager.addMarketplace(marketplace)

  await assert.rejects(
    () => manager.install('demo@local-codex'),
    (error: unknown) => (
      error instanceof Error
      && error.message === 'plugin activation failed: activation rejected'
      && (error as Error & { phase?: string }).phase === 'activation'
    ),
  )
  assert.deepEqual(created, [])
  assert.deepEqual(manager.listInstallations(), [])
})

test('a GitHub marketplace shorthand and GitHub plugin source use the injected safe acquirer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-github-'))
  const catalog = join(root, 'catalog')
  const plugin = join(root, 'plugin')
  await mkdir(join(catalog, '.claude-plugin'), { recursive: true })
  await mkdir(join(plugin, '.claude-plugin'), { recursive: true })
  await mkdir(join(plugin, 'skills', 'deploy'), { recursive: true })
  await writeFile(join(catalog, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: 'company-tools',
    plugins: [{
      name: 'deploy',
      source: { source: 'github', repo: 'company/deploy', ref: 'v2', sha: 'abcdef1' },
    }],
  }))
  await writeFile(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'deploy' }))
  await writeFile(join(plugin, 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Deploy\n---\nDeploy.')
  const calls: string[] = []
  const acquirer: GitRepositoryAcquirer = {
    async clone(repo, destination, revision) {
      calls.push(`${repo}:${revision.ref ?? ''}:${revision.sha ?? ''}`)
      await cp(repo === 'company/catalog' ? catalog : plugin, destination, { recursive: true })
    },
  }
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerMarketplaceProvider(claudeCodeMarketplaceProvider)
  kernel.registerPackageFormatProvider(claudeCodeLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(kernel, loader, join(root, 'state'), { git: acquirer })

  await manager.addMarketplace('company/catalog@main')
  await manager.install('deploy@company-tools')

  assert.deepEqual(calls, [
    'company/catalog:main:',
    'company/deploy:v2:abcdef1',
  ])
  assert.equal(loader.rows.size, 1)
})

test('a canonical Codex marketplace installs an HTTPS git-subdir source through the safe acquirer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-codex-git-'))
  const marketplace = join(root, 'marketplace')
  const repository = join(root, 'repository')
  await mkdir(join(marketplace, '.agents', 'plugins'), { recursive: true })
  await mkdir(join(repository, 'plugins', 'nested', '.codex-plugin'), { recursive: true })
  await mkdir(join(repository, 'plugins', 'nested', 'skills', 'nested'), { recursive: true })
  await writeFile(join(marketplace, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
    name: 'codex-remote',
    plugins: [{
      name: 'nested',
      source: {
        source: 'git-subdir',
        url: 'https://github.com/example/plugins.git',
        path: './plugins/nested',
        ref: 'main',
      },
    }],
  }))
  await writeFile(join(repository, 'plugins', 'nested', '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'nested',
    skills: './skills/',
  }))
  await writeFile(
    join(repository, 'plugins', 'nested', 'skills', 'nested', 'SKILL.md'),
    '---\nname: nested\ndescription: Nested\n---\nUse nested.',
  )
  const calls: string[] = []
  const acquirer: GitRepositoryAcquirer = {
    async clone() {
      throw new Error('owner/repo clone must not handle a generic HTTPS URL')
    },
    async cloneUrl(url, destination, revision) {
      calls.push(`${url}:${revision.ref ?? ''}:${revision.sha ?? ''}`)
      await cp(repository, destination, { recursive: true })
    },
  }
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerMarketplaceProvider(codexMarketplaceProvider)
  kernel.registerPackageFormatProvider(codexLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(kernel, loader, join(root, 'state'), { git: acquirer })

  await manager.addMarketplace(marketplace)
  const installed = await manager.install('nested@codex-remote')

  assert.deepEqual(calls, ['https://github.com/example/plugins.git:main:'])
  assert.equal(installed.rows.length, 1)
  assert.match(String(installed.rows[0]?.config?.bundledSkillDir), /state\/plugins\/codex-remote\/nested\/skills/)
})
