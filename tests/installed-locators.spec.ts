import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PluginBridgeKernel } from '../src/kernel.js'
import {
  createCodexInstalledPluginLocator,
} from '../src/discovery/codex.js'
import * as codexDiscoveryPlugin from '../src/discovery/codex.js'
import {
  createClaudeCodeInstalledPluginLocator,
} from '../src/discovery/claude-code.js'

test('Codex locator reports versioned cache entries as cache evidence and isolates bad manifests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-codex-discovery-'))
  const cache = join(root, 'plugins', 'cache')
  const config = join(root, 'config.toml')
  const valid = join(cache, 'personal', 'demo', '1.2.3')
  const invalid = join(cache, 'personal', 'broken', '2.0.0')
  const unregistered = join(cache, 'remote-catalog', 'not-installed', '9.0.0')
  await mkdir(join(valid, '.codex-plugin'), { recursive: true })
  await mkdir(join(invalid, '.codex-plugin'), { recursive: true })
  await mkdir(join(unregistered, '.codex-plugin'), { recursive: true })
  await writeFile(join(valid, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'demo' }))
  await writeFile(join(invalid, '.codex-plugin', 'plugin.json'), '{')
  await writeFile(join(unregistered, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'not-installed' }))
  await writeFile(config, [
    '[plugins."demo@personal"]',
    'enabled = true',
    '[plugins."broken@personal"]',
    'enabled = false',
  ].join('\n'))

  const observation = await createCodexInstalledPluginLocator({ cacheDir: cache, configPath: config }).discover()

  assert.deepEqual(observation.candidates, [{
    key: 'personal/demo/1.2.3',
    name: 'demo',
    root: await realpath(valid),
    evidence: 'plugin-cache',
    version: '1.2.3',
    marketplace: 'personal',
    enabled: true,
  }])
  assert.equal(observation.diagnostics?.length, 1)
  assert.match(observation.diagnostics?.[0] ?? '', /personal\/broken\/2\.0\.0.*invalid.*plugin manifest/i)
})

test('Claude Code locator reads installed_plugins.json without treating marketplace caches as installed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-claude-discovery-'))
  const registry = join(root, 'plugins', 'installed_plugins.json')
  const installed = join(root, 'plugins', 'cache', 'company', 'demo', '1.0.0')
  await mkdir(join(installed, '.claude-plugin'), { recursive: true })
  await writeFile(join(installed, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo' }))
  await writeFile(registry, JSON.stringify({
    version: 2,
    plugins: {
      'demo@company': [{
        scope: 'user',
        installPath: installed,
        version: '1.0.0',
        installedAt: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
        gitCommitSha: 'abcdef1',
      }],
    },
  }))

  const observation = await createClaudeCodeInstalledPluginLocator({ registryPath: registry }).discover()

  assert.deepEqual(observation, {
    candidates: [{
      key: 'demo@company#user',
      name: 'demo',
      root: await realpath(installed),
      evidence: 'installed-registry',
      version: '1.0.0',
      marketplace: 'company',
      scope: 'user',
    }],
  })
})

test('a discovery provider is an independent reversible Cordis row', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-discovery-row-'))
  const ctx = new Context()
  const kernelFiber = await ctx.plugin(PluginBridgeKernel)
  const locatorFiber = await ctx.plugin(codexDiscoveryPlugin, { cacheDir: join(root, 'missing') })

  assert.deepEqual(ctx.pluginBridge.listInstalledPluginLocators().map(locator => locator.name), [
    'codex-local-cache',
  ])

  await locatorFiber.dispose()
  assert.deepEqual(ctx.pluginBridge.listInstalledPluginLocators(), [])
  await kernelFiber.dispose()
})
