import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import TYPERT_REMOTE from '../packages/ui/src/client/remote.js'

test('the public Host subpath and checked-in browser descriptor expose the same methods', async () => {
  const host = await import('@openma/dsh-agents-plugins-bridge/ui-host').catch(() => undefined)
  assert.equal(typeof host?.AgentPluginsGateway, 'function')
  const gateway = new host!.AgentPluginsGateway(new Context())

  assert.deepEqual(
    remoteMethods(gateway).map(marker => marker.method),
    TYPERT_REMOTE.descriptors.map(descriptor => descriptor.method),
  )
})
