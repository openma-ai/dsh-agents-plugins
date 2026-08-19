import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { dshHooksAdapter } from '../src/adapters/dsh-hooks.js'
import { dshSkillsAdapter } from '../src/adapters/dsh-skills.js'
import { PluginBridgeKernel, type DshPluginRow } from '../src/kernel.js'
import { PluginBridgeManager, type BridgeLoader } from '../src/manager.js'
import { claudeCodeMarketplaceProvider } from '../src/marketplaces/claude-code.js'
import { hookUserApprovalPolicy } from '../src/policies/hook-user-approval.js'
import { claudeCodeLegacyProvider } from '../src/providers/claude-code-legacy.js'

class MemoryLoader implements BridgeLoader {
  readonly rows = new Map<string, DshPluginRow>()

  async create(row: DshPluginRow): Promise<string> {
    if (this.rows.has(row.id)) throw new Error(`duplicate loader row ${row.id}`)
    this.rows.set(row.id, row)
    return row.id
  }

  async remove(id: string): Promise<void> {
    if (!this.rows.delete(id)) throw new Error(`unknown loader row ${id}`)
  }
}

async function fixture(): Promise<{
  readonly kernel: PluginBridgeKernel
  readonly marketplace: string
  readonly storage: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-hook-manager-'))
  const marketplace = join(root, 'marketplace')
  const plugin = join(marketplace, 'plugins', 'demo')
  await mkdir(join(plugin, '.claude-plugin'), { recursive: true })
  await mkdir(join(plugin, 'skills', 'demo'), { recursive: true })
  await mkdir(join(plugin, 'hooks'), { recursive: true })
  await mkdir(join(marketplace, '.claude-plugin'), { recursive: true })
  await writeFile(join(marketplace, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: 'local-claude',
    plugins: [{ name: 'demo', source: './plugins/demo' }],
  }))
  await writeFile(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'demo', skills: './skills/', hooks: './hooks/hooks.json',
  }))
  await writeFile(
    join(plugin, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: Demo\n---\nUse demo.\n',
  )
  await writeFile(join(plugin, 'hooks', 'hooks.json'), '{"hooks":{"SessionStart":[]}}\n')

  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerMarketplaceProvider(claudeCodeMarketplaceProvider)
  kernel.registerPackageFormatProvider(claudeCodeLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  kernel.registerComponentAdapter(dshHooksAdapter)
  kernel.registerActivationPolicy(hookUserApprovalPolicy)
  return { kernel, marketplace, storage: join(root, 'state') }
}

test('explicit install activates Claude Code hook rows without another approval step', async () => {
  const { kernel, marketplace, storage } = await fixture()
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(kernel, loader, storage)
  await manager.addMarketplace(marketplace)
  const installed = await manager.install('demo@local-claude')

  assert.deepEqual([...loader.rows.values()].map(row => row.name), [
    '@deepseek-ai/dsh-skill-filesystem',
    '@openma/dsh-agents-plugins-bridge/hooks-claude-code',
  ])
  assert.deepEqual(installed.activations, [])
  const reviews = await manager.reviewActivations('hook-user-approval', 'demo')
  assert.deepEqual(reviews, [])

  const state = JSON.parse(await readFile(join(storage, 'state.json'), 'utf8')) as {
    approvals: { policy: string; rowId: string; digest: string }[]
  }
  assert.deepEqual(state.approvals, [])
})

test('restart restores enabled hook rows even when their definition changed', async () => {
  const { kernel, marketplace, storage } = await fixture()
  const firstLoader = new MemoryLoader()
  const first = new PluginBridgeManager(kernel, firstLoader, storage)
  await first.addMarketplace(marketplace)
  const installed = await first.install('demo@local-claude')
  await first.dispose()

  await writeFile(join(installed.root, 'hooks', 'hooks.json'), '{"hooks":{"SessionStart":[{"hooks":[]}]}}\n')
  const restoredLoader = new MemoryLoader()
  const restored = new PluginBridgeManager(kernel, restoredLoader, storage)
  await restored.start()

  assert.deepEqual([...restoredLoader.rows.values()].map(row => row.name), [
    '@deepseek-ai/dsh-skill-filesystem',
    '@openma/dsh-agents-plugins-bridge/hooks-claude-code',
  ])
  const changed = await restored.reviewActivations('hook-user-approval', 'demo')
  assert.deepEqual(changed, [])
  const state = JSON.parse(await readFile(join(storage, 'state.json'), 'utf8')) as {
    approvals: unknown[]
  }
  assert.deepEqual(state.approvals, [])
})

test('disable, enable, and uninstall preserve the hook lifecycle transactionally', async () => {
  const { kernel, marketplace, storage } = await fixture()
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(kernel, loader, storage)
  await manager.addMarketplace(marketplace)
  await manager.install('demo@local-claude')
  await manager.disable('demo')
  assert.equal(loader.rows.size, 0)
  await manager.enable('demo')
  assert.equal(loader.rows.size, 2)
  await manager.uninstall('demo')
  assert.equal(loader.rows.size, 0)

  const state = JSON.parse(await readFile(join(storage, 'state.json'), 'utf8')) as {
    approvals: unknown[]
  }
  assert.deepEqual(state.approvals, [])
})
