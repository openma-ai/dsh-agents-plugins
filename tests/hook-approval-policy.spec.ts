import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PluginBridgeKernel } from '../src/kernel.js'
import {
  hookUserApprovalPolicy,
} from '../src/policies/hook-user-approval.js'
import * as hookPolicyPlugin from '../src/policies/hook-user-approval.js'

test('hook approval policy re-inspects the current file and returns reviewable content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-hook-policy-'))
  const configPath = join(root, 'hooks.json')
  await writeFile(configPath, '{"hooks":{"SessionStart":[]}}\n')

  const inspected = await hookUserApprovalPolicy.inspect({
    policy: 'hook-user-approval',
    rowId: 'demo-hook',
    digest: 'stale',
    metadata: { configPath, componentPath: 'hooks/hooks.json', pluginName: 'demo' },
  })

  assert.equal(inspected.digest, '7d30ac1191a993b3406697fa7488c5f22a490013a19ef4a765be8d6229dde112')
  assert.equal(inspected.review, [
    'Plugin: demo',
    'Hook: hooks/hooks.json',
    `File: ${configPath}`,
    `Digest: ${inspected.digest}`,
    'Definition:',
    '{"hooks":{"SessionStart":[]}}',
  ].join('\n'))
})

test('hook approval policy is an independent Cordis row with a reversible registration', async () => {
  const ctx = new Context()
  const kernelFiber = await ctx.plugin(PluginBridgeKernel)
  const policyFiber = await ctx.plugin(hookPolicyPlugin)

  assert.deepEqual(ctx.pluginBridge.listActivationPolicies(), [hookUserApprovalPolicy])
  await policyFiber.dispose()
  assert.deepEqual(ctx.pluginBridge.listActivationPolicies(), [])
  await kernelFiber.dispose()
})
