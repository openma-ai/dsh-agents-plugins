import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PluginBridgeKernel } from '../src/kernel.js'
import {
  createCodexMarketplaceRegistrationLocator,
} from '../src/discovery/codex-marketplaces.js'
import * as codexMarketplaceDiscoveryPlugin from '../src/discovery/codex-marketplaces.js'
import {
  createClaudeCodeMarketplaceRegistrationLocator,
} from '../src/discovery/claude-code-marketplaces.js'

test('Codex marketplace locator reads only registered config tables and preserves source kinds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-codex-marketplaces-'))
  const configPath = join(root, 'config.toml')
  const local = join(root, 'local-catalog')
  await mkdir(local)
  await writeFile(configPath, [
    '[marketplaces.local-tools]',
    'source_type = "local"',
    `source = ${JSON.stringify(local)}`,
    '[marketplaces.remote-tools]',
    'source_type = "git"',
    'source = "https://github.com/company/plugins.git"',
    'ref = "main"',
    '[marketplaces.unsupported]',
    'source_type = "npm"',
    'source = "@company/plugins"',
  ].join('\n'))

  const observation = await createCodexMarketplaceRegistrationLocator({ configPath }).discover()

  assert.deepEqual(observation.candidates, [{
    key: 'local-tools',
    name: 'local-tools',
    location: await realpath(local),
    sourceType: 'local',
    manifestPath: '.agents/plugins/marketplace.json',
  }, {
    key: 'remote-tools',
    name: 'remote-tools',
    location: 'https://github.com/company/plugins.git',
    sourceType: 'git',
    revision: 'main',
    manifestPath: '.agents/plugins/marketplace.json',
  }])
  assert.deepEqual(observation.diagnostics, [
    'codex-registered-marketplaces: unsupported uses unsupported source_type "npm"',
  ])
})

test('Claude Code marketplace locator trusts the explicit known_marketplaces installLocation registry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-claude-marketplaces-'))
  const registryPath = join(root, 'plugins', 'known_marketplaces.json')
  const checkout = join(root, 'plugins', 'marketplaces', 'company')
  await mkdir(checkout, { recursive: true })
  await writeFile(registryPath, JSON.stringify({
    company: {
      source: { source: 'github', repo: 'company/plugins' },
      installLocation: checkout,
      lastUpdated: '2026-01-01T00:00:00.000Z',
    },
  }))

  const observation = await createClaudeCodeMarketplaceRegistrationLocator({ registryPath }).discover()

  assert.deepEqual(observation, { candidates: [{
    key: 'company',
    name: 'company',
    location: await realpath(checkout),
    sourceType: 'installed-checkout',
    manifestPath: '.claude-plugin/marketplace.json',
  }] })
})

test('marketplace registration discovery is an independent reversible Cordis row', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-marketplace-row-'))
  const ctx = new Context()
  const kernelFiber = await ctx.plugin(PluginBridgeKernel)
  const locatorFiber = await ctx.plugin(codexMarketplaceDiscoveryPlugin, {
    configPath: join(root, 'missing.toml'),
  })

  assert.deepEqual(ctx.pluginBridge.listMarketplaceRegistrationLocators().map(locator => locator.name), [
    'codex-registered-marketplaces',
  ])

  await locatorFiber.dispose()
  assert.deepEqual(ctx.pluginBridge.listMarketplaceRegistrationLocators(), [])
  await kernelFiber.dispose()
})
