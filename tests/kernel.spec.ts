import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  PluginBridgeKernel,
  type PackageFormatProvider,
  type PluginPackageSource,
} from '../src/kernel.js'
import {
  AGENT_PLUGINS_V1_SCHEMA,
  agentPluginsV1Provider,
} from '../src/providers/agent-plugins-v1.js'
import * as agentPluginsV1Plugin from '../src/providers/agent-plugins-v1.js'

function source(files: Record<string, unknown>): PluginPackageSource {
  return {
    root: '/fixture/plugin',
    has(path) {
      return Object.hasOwn(files, path)
    },
    kind: path => Object.hasOwn(files, path)
      ? path.endsWith('/') ? 'directory' : 'file'
      : undefined,
    readJson(path) {
      return files[path]
    },
  }
}

test('format providers probe in deterministic name order and dispose reversibly', () => {
  const kernel = new PluginBridgeKernel(new Context())
  const calls: string[] = []
  const provider = (name: string, matches: boolean): PackageFormatProvider => ({
    name,
    probe() {
      calls.push(name)
      return matches
        ? { manifestPath: `${name}.json`, manifest: { name }, components: [] }
        : undefined
    },
  })

  const disposeZulu = kernel.registerPackageFormatProvider(provider('zulu', false))
  kernel.registerPackageFormatProvider(provider('alpha', true))

  assert.deepEqual(kernel.listPackageFormatProviders().map(item => item.name), ['alpha', 'zulu'])
  assert.equal(kernel.detectPackageFormat(source({})).provider, 'alpha')
  assert.deepEqual(calls, ['alpha', 'zulu'])

  disposeZulu()
  assert.deepEqual(kernel.listPackageFormatProviders().map(item => item.name), ['alpha'])
})

test('ambiguous package formats fail loudly with deterministic provider names', () => {
  const kernel = new PluginBridgeKernel(new Context())
  for (const name of ['zulu', 'alpha']) {
    kernel.registerPackageFormatProvider({
      name,
      probe: () => ({ manifestPath: `${name}.json`, manifest: { name }, components: [] }),
    })
  }

  assert.throws(
    () => kernel.detectPackageFormat(source({})),
    /ambiguous package format: alpha, zulu/,
  )
})

test('Agent Plugins 1.0 minimal root manifest is recognized with fixed component locations', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerPackageFormatProvider(agentPluginsV1Provider)
  const detected = kernel.detectPackageFormat(source({
    'plugin.json': {
      $schema: AGENT_PLUGINS_V1_SCHEMA,
      name: 'minimal-plugin',
    },
    'skills/': true,
    'mcp.json': {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {},
    },
  }))

  assert.equal(detected.provider, 'agent-plugins-v1')
  assert.equal(detected.manifestPath, 'plugin.json')
  assert.deepEqual(detected.components, [
    { type: 'skill', path: 'skills/' },
    { type: 'agent-plugin-mcp-server', path: 'mcp.json' },
  ])
})

test('Agent Plugins 1.0 accepts schema-valid empty metadata strings', () => {
  const observation = agentPluginsV1Provider.probe(source({
    'plugin.json': {
      $schema: AGENT_PLUGINS_V1_SCHEMA,
      name: 'metadata-plugin',
      version: '',
      description: '',
      homepage: '',
      repository: '',
      license: '',
    },
  }))

  assert.equal(observation?.manifest.name, 'metadata-plugin')
})

test('Agent Plugins 1.0 rejects fatal closed-schema manifest violations', () => {
  const invalidManifests = [
    { name: 'Uppercase', expected: /field "name"/ },
    { name: 'valid-name', author: { name: 'Ada', extra: true }, expected: /field "author"/ },
    { name: 'valid-name', keywords: [42], expected: /field "keywords"/ },
  ] as const

  for (const { expected, ...manifest } of invalidManifests) {
    assert.throws(
      () => agentPluginsV1Provider.probe(source({
        'plugin.json': { $schema: AGENT_PLUGINS_V1_SCHEMA, ...manifest },
      })),
      expected,
    )
  }
})

test('Cordis provider rows register on the shared service and unload reversibly', async () => {
  const ctx = new Context()
  const kernelFiber = await ctx.plugin(PluginBridgeKernel)
  const providerFiber = await ctx.plugin(agentPluginsV1Plugin)

  assert.deepEqual(ctx.pluginBridge.listPackageFormatProviders().map(provider => provider.name), [
    'agent-plugins-v1',
  ])

  await providerFiber.dispose()
  assert.deepEqual(ctx.pluginBridge.listPackageFormatProviders(), [])
  await kernelFiber.dispose()
})

test('installed-plugin locators are ordered and unload reversibly', () => {
  const kernel = new PluginBridgeKernel(new Context())
  const alpha = {
    name: 'alpha-local',
    discover: async () => ({ candidates: [] }),
  }
  const zulu = {
    name: 'zulu-local',
    discover: async () => ({ candidates: [] }),
  }

  const disposeZulu = kernel.registerInstalledPluginLocator(zulu)
  kernel.registerInstalledPluginLocator(alpha)

  assert.deepEqual(kernel.listInstalledPluginLocators(), [alpha, zulu])
  disposeZulu()
  assert.deepEqual(kernel.listInstalledPluginLocators(), [alpha])
})

test('registered-marketplace locators are a separate reversible provider layer', () => {
  const kernel = new PluginBridgeKernel(new Context())
  const alpha = { name: 'alpha-marketplaces', discover: async () => ({ candidates: [] }) }
  const zulu = { name: 'zulu-marketplaces', discover: async () => ({ candidates: [] }) }

  const disposeZulu = kernel.registerMarketplaceRegistrationLocator(zulu)
  kernel.registerMarketplaceRegistrationLocator(alpha)

  assert.deepEqual(kernel.listMarketplaceRegistrationLocators(), [alpha, zulu])
  disposeZulu()
  assert.deepEqual(kernel.listMarketplaceRegistrationLocators(), [alpha])
})

test('activation policies are an independent reversible provider layer', () => {
  const kernel = new PluginBridgeKernel(new Context())
  const alpha = {
    name: 'alpha-policy',
    inspect: async (requirement: {
      readonly policy: string
      readonly rowId: string
      readonly digest: string
    }) => ({ ...requirement, review: 'alpha review' }),
  }
  const zulu = {
    name: 'zulu-policy',
    inspect: async (requirement: {
      readonly policy: string
      readonly rowId: string
      readonly digest: string
    }) => ({ ...requirement, review: 'zulu review' }),
  }

  const disposeZulu = kernel.registerActivationPolicy(zulu)
  kernel.registerActivationPolicy(alpha)

  assert.deepEqual(kernel.listActivationPolicies(), [alpha, zulu])
  disposeZulu()
  assert.deepEqual(kernel.listActivationPolicies(), [alpha])
})
