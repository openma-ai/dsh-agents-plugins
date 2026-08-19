import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

test('Pi extension host registers scoped commands and tools and dispatches lifecycle callbacks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-pi-extension-host-'))
  await writeFile(join(root, 'index.ts'), `
export default function fixture(pi: any) {
  let starts = 0
  let lastInput = ''
  pi.on('session_start', () => { starts += 1 })
  pi.on('input', (event: any) => { lastInput = event.text })
  pi.registerCommand('fixture-status', {
    description: 'Show fixture extension state',
    handler: async (args: string, ctx: any) => {
      ctx.ui.notify('started=' + starts + ' input=' + lastInput + ' args=' + args.trim(), 'info')
    },
  })
  pi.registerCommand('goal', {
    description: 'Collides with a native DSH command',
    handler: async (_args: string, ctx: any) => {
      ctx.ui.notify('pi goal', 'info')
    },
  })
  pi.registerTool({
    name: 'fixture_tool',
    label: 'Fixture tool',
    description: 'Exercise the Pi tool adapter',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string', minLength: 1 },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
        mode: { anyOf: [{ const: 'fast' }, { const: 'safe' }] },
      },
      required: ['value'],
      additionalProperties: false,
    },
    async execute(toolCallId: string, params: any) {
      return {
        content: [{ type: 'text', text: toolCallId + ':' + params.value }],
        details: { starts, lastInput },
      }
    },
  })
}
`)

  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  let hostCtx: Context | undefined
  const hostFiber = ctx.inject(['commands', 'tools'], injectedCtx => { hostCtx = injectedCtx })
  await hostFiber
  assert.notEqual(hostCtx, undefined)
  const session = ctx.sessions.create(SessionId('pi-extension-host-test'))
  const agent = {
    id: session.id,
    options: { provider: 'fixture', model: 'fixture' },
    session,
    status: 'idle',
    inbox: { hasPending: false },
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: async (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal),
    send() {},
    followup() {},
    steer() {},
    inject() {},
  } as unknown as Agent
  const scope = createScope(hostCtx!, agent)
  ;(agent as unknown as { ctx: Context }).ctx = scope.ctx
  const disposeNativeGoal = agent.ctx.commands.register({
    name: 'goal',
    description: 'Native DSH goal command',
    handler: () => ({ kind: 'success', text: 'native goal' }),
  })

  const { mountPiExtensionForAgent } = await import('../src/pi-extension-host.js')
  const mounted = await mountPiExtensionForAgent(hostCtx!, agent, {
    pluginName: 'fixture-extension',
    pluginRoot: root,
    entries: ['index.ts'],
  })
  await mounted.dispatch('session_start', { type: 'session_start' })
  await mounted.dispatch('input', { type: 'input', text: 'hello', source: 'interactive' })

  const command = ctx.commands.find(agent, 'fixture-status')
  assert.notEqual(command, undefined)
  const commandResult = await command!.handler({
    agent,
    commandId: 'fixture-command' as never,
    rawInput: ' ping',
    signal: new AbortController().signal,
  })
  assert.deepEqual(commandResult, {
    kind: 'success',
    text: 'started=1 input=hello args=ping',
  })
  assert.equal(ctx.commands.find(agent, 'goal')?.description, 'Native DSH goal command')
  const namespacedGoal = ctx.commands.find(agent, 'pi-fixture-extension-goal')
  assert.notEqual(namespacedGoal, undefined)
  assert.deepEqual(await namespacedGoal!.handler({
    agent,
    commandId: 'fixture-goal-command' as never,
    rawInput: '',
    signal: new AbortController().signal,
  }), { kind: 'success', text: 'pi goal' })

  const tool = ctx.tools.get('fixture_tool', agent)
  assert.notEqual(tool, undefined)
  assert.deepEqual(ctx.tools.schemas(agent), [{
    name: 'fixture_tool',
    description: 'Exercise the Pi tool adapter',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        mode: { oneOf: [{ const: 'fast' }, { const: 'safe' }] },
      },
      required: ['value'],
      additionalProperties: false,
    },
  }])
  const toolResult = await tool!.execute({ value: 'works' }, {
    callId: 'fixture-call',
    signal: new AbortController().signal,
    agent,
  } as never)
  assert.deepEqual(toolResult, {
    content: [{ type: 'text', text: 'fixture-call:works' }],
    details: { starts: 1, lastInput: 'hello' },
  })

  await mounted.dispose()
  assert.equal(ctx.commands.find(agent, 'fixture-status'), undefined)
  assert.equal(ctx.commands.find(agent, 'pi-fixture-extension-goal'), undefined)
  assert.equal(ctx.commands.find(agent, 'goal')?.description, 'Native DSH goal command')
  assert.equal(ctx.tools.get('fixture_tool', agent), undefined)
  disposeNativeGoal()
  await scope.dispose()
  await hostFiber.dispose()
})
