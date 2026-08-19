import assert from 'node:assert/strict'
import test from 'node:test'

test('the checked-in Remote descriptor exposes the eight strict Host endpoints', async () => {
  const remote = await import('../src/client/remote.js').catch(() => undefined)
  assert.equal(typeof remote?.TYPERT_REMOTE, 'object')
  assert.equal(remote?.TYPERT_REMOTE.package, '@openma/dsh-agents-plugins-bridge')
  assert.deepEqual(remote?.TYPERT_REMOTE.descriptors.map(descriptor => descriptor.method), [
    'snapshot',
    'discoverLocal',
    'discoverMarketplaces',
    'addMarketplace',
    'importMarketplace',
    'importLocal',
    'installPlugin',
    'setEnabled',
  ])
  for (const descriptor of remote?.TYPERT_REMOTE.descriptors ?? []) {
    assert.deepEqual(descriptor.invocation, { kind: 'direct' })
    assert.equal(descriptor.result.mode, 'strict')
    for (const parameter of descriptor.parameters) assert.equal(parameter.codec.mode, 'strict')
  }
})

test('the Remote result codecs remove Host-private installation fields', async () => {
  const remote = await import('../src/client/remote.js').catch(() => undefined)
  assert.equal(typeof remote?.TYPERT_REMOTE, 'object')
  const snapshot = remote?.TYPERT_REMOTE.descriptors.find(descriptor => descriptor.method === 'snapshot')
  const parsed = snapshot?.result.schema.parse({
    marketplaces: [],
    installations: [{
      name: 'demo', marketplace: 'team', format: 'codex-legacy', enabled: true,
      rowCount: 1, protectedCount: 0, requiredHosts: ['codex'], unsupportedCount: 0, diagnostics: [],
      root: '/private/demo', rows: [{ config: { TOKEN: 'secret' } }],
    }],
  })
  assert.deepEqual(parsed?.installations[0]?.requiredHosts, ['codex'])
  assert.doesNotMatch(JSON.stringify(parsed), /private|TOKEN|secret/u)

  const install = remote?.TYPERT_REMOTE.descriptors.find(descriptor => descriptor.method === 'installPlugin')
  assert.deepEqual(install?.result.schema.parse({
    status: 'failed',
    reason: 'activation',
    details: 'TOKEN=must-not-cross-the-wire',
  }), {
    status: 'failed',
    reason: 'activation',
  })
})
