import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { executePluginBridgeCommand } from '../src/command.js'
import { PluginBridgeKernel } from '../src/kernel.js'
import type { PluginBridgeManagement } from '../src/manager.js'

const USAGE = [
  'Usage:',
  '/plugin-bridge marketplace add <path-or-url>',
  '/plugin-bridge marketplace discover',
  '/plugin-bridge marketplace import <locator:key>',
  '/plugin-bridge marketplace list',
  '/plugin-bridge install <plugin>@<marketplace>',
  '/plugin-bridge discover',
  '/plugin-bridge import <locator:key>',
  '/plugin-bridge enable <plugin>',
  '/plugin-bridge disable <plugin>',
  '/plugin-bridge uninstall <plugin>',
].join('\n')

test('/plugin-bridge reports the one kernel and its provider layers', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerMarketplaceProvider({ name: 'claude-marketplace', probe: () => undefined })
  kernel.registerPackageFormatProvider({ name: 'agent-plugins-v1', probe: () => undefined })
  kernel.registerComponentAdapter({
    name: 'dsh-skills',
    componentTypes: ['skill'],
    materialize: () => [],
  })
  kernel.registerActivationPolicy({
    name: 'hook-user-approval',
    inspect: async requirement => ({ ...requirement, review: '' }),
  })

  assert.deepEqual(executePluginBridgeCommand(kernel, ''), {
    kind: 'success',
    text: [
      'Plugin Bridge',
      'Marketplaces: claude-marketplace',
      'Package formats: agent-plugins-v1',
      'Component adapters: dsh-skills',
      'Installed discovery: (none)',
      'Marketplace discovery: (none)',
      'Activation policies: hook-user-approval',
      '',
      USAGE,
    ].join('\n'),
  })
})

test('/plugin-bridge marketplace list renders an empty provider catalog explicitly', () => {
  const kernel = new PluginBridgeKernel(new Context())

  assert.deepEqual(executePluginBridgeCommand(kernel, ' marketplace list '), {
    kind: 'success',
    text: 'No marketplace providers are registered.',
  })
})

test('/plugin-bridge rejects unsupported subcommands with the owned usage', () => {
  const kernel = new PluginBridgeKernel(new Context())

  assert.deepEqual(executePluginBridgeCommand(kernel, 'frobnicate example'), {
    kind: 'error',
    text: `Unsupported plugin bridge command.\n${USAGE}`,
  })
  assert.deepEqual(executePluginBridgeCommand(kernel, 'hooks review demo'), {
    kind: 'error',
    text: `Unsupported plugin bridge command.\n${USAGE}`,
  })
})

test('/plugin-bridge management commands call the one runtime manager', async () => {
  const kernel = new PluginBridgeKernel(new Context())
  const calls: string[] = []
  const runtime: PluginBridgeManagement = {
    listMarketplaces: () => [{
      name: 'company', provider: 'claude-code-marketplace', root: '/catalog',
      manifestPath: '.claude-plugin/marketplace.json', plugins: [],
    }],
    listInstallations: () => [],
    async discoverLocalPlugins() {
      calls.push('discover')
      return {
        candidates: [{
          ref: 'codex-local-cache:personal/demo/1.0.0', locator: 'codex-local-cache',
          key: 'personal/demo/1.0.0', name: 'demo', root: '/foreign/demo',
          evidence: 'plugin-cache', version: '1.0.0', marketplace: 'personal', enabled: true,
        }],
        diagnostics: ['claude-code-installed: registry unavailable'],
      }
    },
    async importLocalPlugin(ref) {
      calls.push(`import:${ref}`)
      return {
        name: 'demo', marketplace: 'import:codex-local-cache', format: 'codex-legacy', root: '/demo',
        rows: [{ id: 'demo-skill', name: '@deepseek-ai/dsh-skill-filesystem' }],
        activations: [],
        requirements: [],
        unsupported: [], enabled: true,
      }
    },
    async discoverRegisteredMarketplaces() {
      calls.push('marketplace-discover')
      return {
        candidates: [{
          ref: 'claude-code-registered-marketplaces:company',
          locator: 'claude-code-registered-marketplaces', key: 'company', name: 'company',
          location: '/foreign/company', sourceType: 'installed-checkout',
        }],
        diagnostics: [],
      }
    },
    async importRegisteredMarketplace(ref) {
      calls.push(`marketplace-import:${ref}`)
      return this.listMarketplaces()[0]!
    },
    async addMarketplace(location) {
      calls.push(`add:${location}`)
      return this.listMarketplaces()[0]!
    },
    async install(spec) {
      calls.push(`install:${spec}`)
      return {
        name: 'demo', marketplace: 'company', format: 'claude-code-legacy', root: '/demo',
        rows: [{ id: 'demo-skill', name: '@deepseek-ai/dsh-skill-filesystem' }],
        activations: [],
        requirements: [],
        unsupported: [{ type: 'app', path: '.app.json' }], enabled: true,
      }
    },
    async reviewActivations(policy, plugin) {
      calls.push(`review:${policy}:${plugin ?? '*'}`)
      return [{
        plugin: 'demo', approved: false, policy, rowId: 'demo-hook',
        digest: 'a'.repeat(64), review: 'Plugin: demo\nDefinition:\n{}',
      }]
    },
    async approveActivation(policy, plugin, digest) {
      calls.push(`approve:${policy}:${plugin}:${digest}`)
    },
    async enable(name) { calls.push(`enable:${name}`) },
    async disable(name) { calls.push(`disable:${name}`) },
    async uninstall(name) { calls.push(`uninstall:${name}`) },
  }

  assert.deepEqual(await executePluginBridgeCommand(kernel, 'marketplace add /catalog', runtime), {
    kind: 'success', text: 'Added marketplace company (claude-code-marketplace).',
  })
  assert.deepEqual(await executePluginBridgeCommand(kernel, 'install demo@company', runtime), {
    kind: 'success',
    text: 'Installed demo from company as 1 dsh row(s). Unsupported components: app:.app.json',
  })
  assert.deepEqual(await executePluginBridgeCommand(kernel, 'discover', runtime), {
    kind: 'success',
    text: [
      'codex-local-cache:personal/demo/1.0.0\tdemo\t1.0.0\tplugin-cache\tenabled\t/foreign/demo',
      'Diagnostics:',
      '- claude-code-installed: registry unavailable',
    ].join('\n'),
  })
  assert.deepEqual(await executePluginBridgeCommand(
    kernel,
    'import codex-local-cache:personal/demo/1.0.0',
    runtime,
  ), {
    kind: 'success', text: 'Imported demo from codex-local-cache as 1 dsh row(s).',
  })
  assert.deepEqual(await executePluginBridgeCommand(kernel, 'marketplace discover', runtime), {
    kind: 'success',
    text: 'claude-code-registered-marketplaces:company\tcompany\tinstalled-checkout\t/foreign/company',
  })
  assert.deepEqual(await executePluginBridgeCommand(
    kernel,
    'marketplace import claude-code-registered-marketplaces:company',
    runtime,
  ), {
    kind: 'success', text: 'Imported marketplace company (claude-code-marketplace).',
  })
  assert.deepEqual(await executePluginBridgeCommand(kernel, 'disable demo', runtime), {
    kind: 'success', text: 'Disabled demo.',
  })
  assert.deepEqual(await executePluginBridgeCommand(kernel, 'enable demo', runtime), {
    kind: 'success', text: 'Enabled demo.',
  })
  assert.deepEqual(await executePluginBridgeCommand(kernel, 'uninstall demo', runtime), {
    kind: 'success', text: 'Uninstalled demo.',
  })
  assert.deepEqual(calls, [
    'add:/catalog', 'install:demo@company', 'discover',
    'import:codex-local-cache:personal/demo/1.0.0',
    'marketplace-discover', 'marketplace-import:claude-code-registered-marketplaces:company',
    'disable:demo', 'enable:demo', 'uninstall:demo',
  ])
})
