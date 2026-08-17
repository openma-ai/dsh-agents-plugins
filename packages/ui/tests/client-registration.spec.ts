import assert from 'node:assert/strict'
import test from 'node:test'

test('the Web contribution mounts its Remote before registering the bridge settings tab', async () => {
  const client = await import('../src/client/register.js').catch(() => undefined)
  assert.equal(typeof client?.registerPluginBridgeUi, 'function')

  const events: string[] = []
  const contribution = { package: '@openma/dsh-agents-plugins-bridge', descriptors: [] }
  const component = () => null
  let registration: { options: Record<string, unknown>; component: unknown } | undefined
  let remoteInjectionActive = false
  const api = {
    snapshot: async () => ({ ok: true, value: { marketplaces: [], installations: [] } }),
    discoverLocal: async () => ({ ok: true, value: { candidates: [], diagnostics: [] } }),
    discoverMarketplaces: async () => ({ ok: true, value: { candidates: [], diagnostics: [] } }),
  }
  const ctx = {
    remote: {
      $mount: async (value: unknown) => {
        assert.equal(value, contribution)
        events.push('remote')
        return async () => { events.push('remote:dispose') }
      },
    },
    locale: {
      register: () => {
        events.push('locale')
        return () => { events.push('locale:dispose') }
      },
      bind: () => (key: string) => key,
    },
    effect: (factory: () => unknown) => factory(),
    inject: (services: readonly string[], callback: (scope: unknown) => void) => {
      assert.deepEqual(services, ['remote.agentPluginsBridge'])
      events.push('remote:inject')
      remoteInjectionActive = true
      callback({
        ...ctx,
        remote: {
          ...ctx.remote,
          get agentPluginsBridge() {
            if (!remoteInjectionActive) throw new Error('Remote face escaped its Cordis injection scope')
            return api
          },
        },
      })
      remoteInjectionActive = false
    },
    slots: {
      inject: (name: string, factory: () => unknown) => {
        assert.equal(name, 'settings.plugins.tab')
        events.push('slot:inject')
        factory()
      },
      register: (options: Record<string, unknown>, value: unknown) => {
        events.push('slot:register')
        registration = { options, component: value }
        return () => { events.push('slot:dispose') }
      },
    },
  }

  const dispose = await client?.registerPluginBridgeUi(
    ctx as never,
    contribution as never,
    component as never,
    { zh: {}, en: {} },
  )

  assert.deepEqual(events, ['remote', 'remote:inject', 'locale', 'slot:inject', 'slot:register'])
  assert.equal(registration?.component, component)
  assert.deepEqual(registration?.options, {
    name: 'settings.plugins.tab',
    id: 'agent-plugins',
    order: 5,
    label: registration?.options.label,
    locale: 'settings.pluginBridge',
    inject: registration?.options.inject,
  })
  assert.equal(typeof registration?.options.label, 'function')
  assert.equal(typeof registration?.options.inject, 'function')
  const face = (registration?.options.inject as (() => Record<string, unknown>))()
  assert.deepEqual(Object.keys(face).sort(), [
    'addMarketplace',
    'importLocal',
    'importMarketplace',
    'install',
    'load',
    'rescan',
    'setEnabled',
  ])
  assert.equal(Object.hasOwn(face, 'api'), false)
  await (face.load as () => Promise<unknown>)()

  await dispose?.()
  assert.equal(events.at(-1), 'remote:dispose')
})

test('mutation callbacks reuse the returned durable snapshot and rescan only foreign state', async () => {
  const client = await import('../src/client/register.js')
  const calls: string[] = []
  const snapshot = {
    marketplaces: [{ name: 'team', provider: 'codex-marketplace', plugins: ['demo'] }],
    installations: [{
      name: 'demo',
      marketplace: 'team',
      format: 'codex-legacy',
      enabled: true,
      rowCount: 2,
      protectedCount: 0,
      unsupportedCount: 0,
      diagnostics: [],
    }],
  }
  const local = { candidates: [], diagnostics: [] }
  const marketplaces = { candidates: [], diagnostics: [] }
  const api = {
    snapshot: async () => { throw new Error('mutation must not reload the durable snapshot') },
    discoverLocal: async () => {
      calls.push('discoverLocal')
      return { ok: true as const, value: local }
    },
    discoverMarketplaces: async () => {
      calls.push('discoverMarketplaces')
      return { ok: true as const, value: marketplaces }
    },
    installPlugin: async (name: string, marketplace: string) => {
      calls.push(`install:${name}@${marketplace}`)
      return { ok: true as const, value: snapshot }
    },
  }

  const face = client.createPluginBridgeSettingsFace(api as never)

  assert.deepEqual(await face.install('demo', 'team'), { snapshot, local, marketplaces })
  assert.deepEqual(calls, ['install:demo@team', 'discoverLocal', 'discoverMarketplaces'])
})
