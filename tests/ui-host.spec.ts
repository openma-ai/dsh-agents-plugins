import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import * as bridge from '../src/index.js'
import { AgentPluginsGateway } from '../src/ui-host.js'

test('the bridge publishes a loadable Agent Plugins Host gateway', () => {
  assert.equal(
    typeof (bridge as Record<string, unknown>).AgentPluginsGateway,
    'function',
  )
})

test('the Host gateway exposes independent durable and discovery reads', () => {
  const gateway = new AgentPluginsGateway(new Context())

  assert.deepEqual(remoteMethods(gateway), [
    { method: 'snapshot', invocation: { kind: 'direct' } },
    { method: 'discoverLocal', invocation: { kind: 'direct' } },
    { method: 'discoverMarketplaces', invocation: { kind: 'direct' } },
    { method: 'addMarketplace', invocation: { kind: 'direct' } },
    { method: 'importMarketplace', invocation: { kind: 'direct' } },
    { method: 'importLocal', invocation: { kind: 'direct' } },
    { method: 'installPlugin', invocation: { kind: 'direct' } },
    { method: 'setEnabled', invocation: { kind: 'direct' } },
  ])
})

test('snapshot projects durable state without exposing row configuration or filesystem roots', () => {
  const ctx = new Context()
  ctx.provide('pluginBridgeRuntime', {
    listMarketplaces: () => [{
      name: 'company',
      provider: 'claude-code-marketplace',
      root: '/private/catalog',
      manifestPath: '.claude-plugin/marketplace.json',
      plugins: [
        { name: 'deploy', source: { kind: 'github-repository', repo: 'company/deploy' } },
      ],
    }],
    listInstallations: () => [{
      name: 'deploy',
      marketplace: 'company',
      format: 'claude-code-legacy',
      root: '/private/plugins/deploy',
      enabled: true,
      rows: [{
        id: 'deploy-mcp',
        name: '@deepseek-ai/dsh-mcp-client',
        config: { env: { TOKEN: 'must-not-cross-the-wire' } },
      }],
      activations: [{ policy: 'hook-user-approval', rowId: 'deploy-hook', digest: 'a'.repeat(64) }],
      requirements: [{
        kind: 'foreign-host' as const,
        host: 'codex',
        capability: 'registered-app-connection',
        componentPath: '.app.json',
        metadata: { connectionId: 'connector_must-not-cross-the-wire' },
      }],
      unsupported: [{ type: 'app', path: '.app.json' }],
      diagnostics: ['cannot inspect /private/plugins/deploy: TOKEN=must-not-cross-the-wire'],
    }],
  })
  const gateway = new AgentPluginsGateway(ctx)

  const snapshot = gateway.snapshot()

  assert.deepEqual(snapshot, {
    marketplaces: [{
      name: 'company',
      provider: 'claude-code-marketplace',
      plugins: ['deploy'],
    }],
    installations: [{
      name: 'deploy',
      marketplace: 'company',
      format: 'claude-code-legacy',
      enabled: true,
      rowCount: 1,
      protectedCount: 1,
      requiredHosts: ['codex'],
      unsupportedCount: 1,
      diagnostics: ['1 diagnostic; details are available in Host logs'],
    }],
  })
  assert.doesNotMatch(JSON.stringify(snapshot), /private|TOKEN|connector_|must-not-cross-the-wire/u)
})

test('discovery reads preserve opaque refs while hiding foreign filesystem locations', async () => {
  const ctx = new Context()
  ctx.provide('pluginBridgeRuntime', {
    discoverLocalPlugins: async () => ({
      candidates: [{
        ref: 'codex-local-cache:personal/demo/1.0.0',
        locator: 'codex-local-cache',
        key: 'personal/demo/1.0.0',
        name: 'demo',
        root: '/private/codex/demo',
        evidence: 'plugin-cache' as const,
        version: '1.0.0',
        marketplace: 'personal',
        scope: 'user',
        enabled: true,
      }],
      diagnostics: ['pi-user-settings: cannot read "/private/pi/settings.json": TOKEN=must-not-cross-the-wire'],
    }),
    discoverRegisteredMarketplaces: async () => ({
      candidates: [{
        ref: 'claude-code-registered-marketplaces:company',
        locator: 'claude-code-registered-marketplaces',
        key: 'company',
        name: 'company',
        location: '/private/claude/company',
        sourceType: 'installed-checkout' as const,
        revision: 'main',
      }],
      diagnostics: ['claude-code-registered-marketplaces: cannot read "/private/claude/known_marketplaces.json"'],
    }),
  })
  const gateway = new AgentPluginsGateway(ctx)

  assert.deepEqual(await gateway.discoverLocal(), {
    candidates: [{
      ref: 'codex-local-cache:personal/demo/1.0.0',
      locator: 'codex-local-cache',
      name: 'demo',
      evidence: 'plugin-cache',
      version: '1.0.0',
      marketplace: 'personal',
      scope: 'user',
      enabled: true,
    }],
    diagnostics: ['pi-user-settings: 1 diagnostic; details are available in Host logs'],
  })
  assert.deepEqual(await gateway.discoverMarketplaces(), {
    candidates: [{
      ref: 'claude-code-registered-marketplaces:company',
      locator: 'claude-code-registered-marketplaces',
      name: 'company',
      sourceType: 'installed-checkout',
      revision: 'main',
    }],
    diagnostics: ['claude-code-registered-marketplaces: 1 diagnostic; details are available in Host logs'],
  })
  assert.doesNotMatch(JSON.stringify([
    await gateway.discoverLocal(),
    await gateway.discoverMarketplaces(),
  ]), /\/private|TOKEN|must-not-cross-the-wire/u)
})

test('mutations are serialized and keep structured UI arguments at the Host boundary', async () => {
  const calls: string[] = []
  let active = 0
  let maxActive = 0
  const mutate = async (call: string): Promise<void> => {
    calls.push(call)
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active -= 1
  }
  const ctx = new Context()
  ctx.provide('pluginBridgeRuntime', {
    listMarketplaces: () => [],
    listInstallations: () => [],
    addMarketplace: (location: string) => mutate(`add:${location}`),
    importRegisteredMarketplace: (ref: string) => mutate(`marketplace:${ref}`),
    importLocalPlugin: (ref: string) => mutate(`local:${ref}`),
    install: (spec: string) => mutate(`install:${spec}`),
    enable: (name: string) => mutate(`enable:${name}`),
    disable: (name: string) => mutate(`disable:${name}`),
  })
  const gateway = new AgentPluginsGateway(ctx)

  await Promise.all([
    gateway.addMarketplace('github:company/catalog'),
    gateway.importMarketplace('claude-code-registered-marketplaces:company'),
    gateway.importLocal('codex-local-cache:personal/demo/1.0.0'),
    gateway.installPlugin('deploy', 'company'),
    gateway.setEnabled('deploy', false),
    gateway.setEnabled('deploy', true),
  ])

  assert.equal(maxActive, 1)
  assert.deepEqual(calls, [
    'add:github:company/catalog',
    'marketplace:claude-code-registered-marketplaces:company',
    'local:codex-local-cache:personal/demo/1.0.0',
    'install:deploy@company',
    'disable:deploy',
    'enable:deploy',
  ])
})

test('a failed install returns a safe reason while recording its full cause only in Host logs', async () => {
  const warnings: string[] = []
  const ctx = new Context()
  ctx.logger.warn = (message: unknown) => { warnings.push(String(message)) }
  ctx.provide('pluginBridgeRuntime', {
    listMarketplaces: () => [],
    listInstallations: () => [],
    install: async () => { throw new Error('git clone failed: TOKEN=host-log-only') },
  })
  const gateway = new AgentPluginsGateway(ctx)

  assert.deepEqual(await gateway.installPlugin('demo', 'team'), {
    status: 'failed',
    reason: 'source',
  })
  assert.deepEqual(warnings, [
    'agentPluginsBridge installPlugin demo@team failed: git clone failed: TOKEN=host-log-only',
  ])
})

test('an activation-phase install failure is preserved as a safe Host result', async () => {
  const ctx = new Context()
  ctx.logger.warn = () => {}
  ctx.provide('pluginBridgeRuntime', {
    listMarketplaces: () => [],
    listInstallations: () => [],
    install: async () => {
      throw Object.assign(new Error('plugin activation failed: private loader detail'), {
        phase: 'activation',
      })
    },
  })
  const gateway = new AgentPluginsGateway(ctx)

  assert.deepEqual(await gateway.installPlugin('demo', 'team'), {
    status: 'failed',
    reason: 'activation',
  })
})
