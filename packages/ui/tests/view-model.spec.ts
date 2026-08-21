import assert from 'node:assert/strict'
import test from 'node:test'

test('loadPluginBridgeView unwraps all Host reads as one settings snapshot', async () => {
  const client = await import('../src/client/view-model.js').catch(() => undefined)
  assert.equal(typeof client?.loadPluginBridgeView, 'function')

  const snapshot = {
    marketplaces: [{ name: 'team', provider: 'codex-marketplace', plugins: ['demo'] }],
    installations: [],
  }
  const local = {
    candidates: [{
      ref: 'codex-local-cache:personal/demo/1.0.0',
      locator: 'codex-local-cache',
      name: 'demo',
      evidence: 'plugin-cache' as const,
    }],
    diagnostics: [],
  }
  const marketplaces = { candidates: [], diagnostics: ['one catalog is malformed'] }
  const piUpdates = { mode: 'notify' as const, updates: [] }
  const api = {
    snapshot: async () => ({ ok: true as const, value: snapshot }),
    discoverLocal: async () => ({ ok: true as const, value: local }),
    discoverMarketplaces: async () => ({ ok: true as const, value: marketplaces }),
    piUpdates: async () => ({ ok: true as const, value: piUpdates }),
  }

  assert.deepEqual(await client?.loadPluginBridgeView(api as never), {
    snapshot,
    local,
    marketplaces,
    piUpdates,
  })
})

test('loadPluginBridgeView reports the exact failed Remote endpoint', async () => {
  const client = await import('../src/client/view-model.js').catch(() => undefined)
  assert.equal(typeof client?.loadPluginBridgeView, 'function')
  const api = {
    snapshot: async () => ({ ok: true as const, value: { marketplaces: [], installations: [] } }),
    discoverLocal: async () => ({
      ok: false as const,
      error: { code: 'INTERNAL', message: 'locator failed' },
    }),
    discoverMarketplaces: async () => ({ ok: true as const, value: { candidates: [], diagnostics: [] } }),
    piUpdates: async () => ({ ok: true as const, value: { mode: 'notify', updates: [] } }),
  }

  await assert.rejects(
    () => client?.loadPluginBridgeView(api as never),
    /agentPluginsBridge\.discoverLocal failed: INTERNAL: locator failed/u,
  )
})
