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
import { codexMarketplaceProvider } from '../src/marketplaces/codex.js'
import { hookUserApprovalPolicy } from '../src/policies/hook-user-approval.js'
import { codexLegacyProvider } from '../src/providers/codex-legacy.js'

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
  await mkdir(join(plugin, '.codex-plugin'), { recursive: true })
  await mkdir(join(plugin, 'skills', 'demo'), { recursive: true })
  await mkdir(join(plugin, 'hooks'), { recursive: true })
  await writeFile(join(marketplace, 'marketplace.json'), JSON.stringify({
    name: 'local-codex',
    plugins: [{ name: 'demo', source: { source: 'local', path: './plugins/demo' } }],
  }))
  await writeFile(join(plugin, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'demo', skills: './skills/', hooks: './hooks/hooks.json',
  }))
  await writeFile(
    join(plugin, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: Demo\n---\nUse demo.\n',
  )
  await writeFile(join(plugin, 'hooks', 'hooks.json'), '{"hooks":{"SessionStart":[]}}\n')

  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerMarketplaceProvider(codexMarketplaceProvider)
  kernel.registerPackageFormatProvider(codexLegacyProvider)
  kernel.registerComponentAdapter(dshSkillsAdapter)
  kernel.registerComponentAdapter(dshHooksAdapter)
  kernel.registerActivationPolicy(hookUserApprovalPolicy)
  return { kernel, marketplace, storage: join(root, 'state') }
}

test('install holds hook rows until the reviewed digest is explicitly approved', async () => {
  const { kernel, marketplace, storage } = await fixture()
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(kernel, loader, storage)
  await manager.addMarketplace(marketplace)
  const installed = await manager.install('demo@local-codex')

  assert.deepEqual([...loader.rows.values()].map(row => row.name), [
    '@deepseek-ai/dsh-skill-filesystem',
  ])
  const reviews = await manager.reviewActivations('hook-user-approval', 'demo')
  assert.equal(reviews.length, 1)
  assert.equal(reviews[0]?.approved, false)
  assert.equal(reviews[0]?.digest, '7d30ac1191a993b3406697fa7488c5f22a490013a19ef4a765be8d6229dde112')
  assert.match(reviews[0]?.review ?? '', /Definition:\n\{"hooks":\{"SessionStart":\[\]\}\}/u)

  await assert.rejects(
    () => manager.approveActivation('hook-user-approval', 'demo', '0'.repeat(64)),
    /does not match the current hook-user-approval digest/,
  )
  assert.equal(loader.rows.size, 1)

  await manager.approveActivation('hook-user-approval', 'demo', reviews[0]!.digest)
  assert.equal(loader.rows.get(installed.activations[0]!.rowId)?.name, '@deepseek-ai/dsh-hooks-codex')

  const state = JSON.parse(await readFile(join(storage, 'state.json'), 'utf8')) as {
    approvals: { policy: string; rowId: string; digest: string }[]
  }
  assert.deepEqual(state.approvals, [{
    policy: 'hook-user-approval',
    rowId: installed.activations[0]!.rowId,
    digest: reviews[0]!.digest,
  }])
})

test('restart revokes a stale digest and restores only independently safe rows', async () => {
  const { kernel, marketplace, storage } = await fixture()
  const firstLoader = new MemoryLoader()
  const first = new PluginBridgeManager(kernel, firstLoader, storage)
  await first.addMarketplace(marketplace)
  const installed = await first.install('demo@local-codex')
  const review = (await first.reviewActivations('hook-user-approval', 'demo'))[0]!
  await first.approveActivation('hook-user-approval', 'demo', review.digest)
  await first.dispose()

  await writeFile(join(installed.root, 'hooks', 'hooks.json'), '{"hooks":{"SessionStart":[{"hooks":[]}]}}\n')
  const restoredLoader = new MemoryLoader()
  const restored = new PluginBridgeManager(kernel, restoredLoader, storage)
  await restored.start()

  assert.deepEqual([...restoredLoader.rows.values()].map(row => row.name), [
    '@deepseek-ai/dsh-skill-filesystem',
  ])
  const changed = await restored.reviewActivations('hook-user-approval', 'demo')
  assert.equal(changed[0]?.approved, false)
  assert.notEqual(changed[0]?.digest, review.digest)
  const state = JSON.parse(await readFile(join(storage, 'state.json'), 'utf8')) as {
    approvals: unknown[]
  }
  assert.deepEqual(state.approvals, [])
})

test('disable, enable, and uninstall preserve the approved hook lifecycle transactionally', async () => {
  const { kernel, marketplace, storage } = await fixture()
  const loader = new MemoryLoader()
  const manager = new PluginBridgeManager(kernel, loader, storage)
  await manager.addMarketplace(marketplace)
  await manager.install('demo@local-codex')
  const review = (await manager.reviewActivations('hook-user-approval', 'demo'))[0]!
  await manager.approveActivation('hook-user-approval', 'demo', review.digest)

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
