import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import UI_REMOTE from '../packages/ui/src/client/remote.js'

const METHODS = [
  'snapshot',
  'discoverLocal',
  'discoverMarketplaces',
  'addMarketplace',
  'importMarketplace',
  'importLocal',
  'installPlugin',
  'setEnabled',
] as const

test('the public Host feature ships the official typert and remote artifacts', async () => {
  const host = await import('@openma/dsh-agents-plugins-bridge/ui-host').catch(() => undefined)
  const typert = await import('@openma/dsh-agents-plugins-bridge/typert').catch(() => undefined)
  const remote = await import('@openma/dsh-agents-plugins-bridge/remote').catch(() => undefined)

  assert.equal(typeof host?.AgentPluginsGateway, 'function')
  assert.equal(typeof typert?.TYPERT, 'object')
  assert.equal(typeof remote?.TYPERT_REMOTE, 'object')

  const gateway = new host!.AgentPluginsGateway(new Context())

  assert.deepEqual(
    remoteMethods(gateway).map(marker => marker.method),
    METHODS,
  )
  assert.deepEqual(
    typert!.TYPERT.invocations.map(descriptor => descriptor.method),
    METHODS,
  )
  assert.deepEqual(
    remote!.TYPERT_REMOTE.descriptors.map(descriptor => descriptor.method),
    METHODS,
  )
  assert.deepEqual(
    UI_REMOTE.descriptors.map(descriptor => descriptor.method),
    METHODS,
  )
  assert.deepEqual(
    UI_REMOTE.descriptors.map(descriptor => descriptor.id),
    remote!.TYPERT_REMOTE.descriptors.map(descriptor => descriptor.id),
  )
})
