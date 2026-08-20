import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

test('Pi UI mode is an exact projection of the owning Agent interaction mode', async () => {
  const { piUiModeForAgent } = await import('../src/pi-extension-host.js')
  assert.equal(piUiModeForAgent({ options: { interactionMode: 'rpc' } } as unknown as Agent), 'rpc')
  assert.equal(piUiModeForAgent({ options: { interactionMode: 'interactive' } } as unknown as Agent), 'tui')
  assert.throws(
    () => piUiModeForAgent({ options: {} } as unknown as Agent),
    /does not declare an interaction mode/,
  )
})

test('Pi extension host registers scoped commands and tools and dispatches lifecycle callbacks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-pi-extension-host-'))
  const workspace = await mkdtemp(join(tmpdir(), 'plugin-bridge-pi-extension-workspace-'))
  await writeFile(join(root, 'index.ts'), `
export default function fixture(pi: any) {
  let starts = 0
  let lastInput = ''
  let sessionManager: unknown
  let lifecycleSessionStable = false
  pi.on('session_start', (_event: any, ctx: any) => {
    starts += 1
    sessionManager = ctx.sessionManager
  })
  pi.on('agent_start', (_event: any, ctx: any) => {
    lifecycleSessionStable = ctx.sessionManager === sessionManager
  })
  pi.on('before_agent_start', (event: any) => ({
    systemPrompt: event.systemPrompt + '\\nfixture-pi-system-suffix',
  }))
  pi.on('input', (event: any) => { lastInput = event.text })
  pi.registerCommand('fixture-status', {
    description: 'Show fixture extension state',
    handler: async (args: string, ctx: any) => {
      ctx.ui.notify('started=' + starts + ' stable=' + lifecycleSessionStable + ' cwd=' + ctx.cwd + ' input=' + lastInput + ' args=' + args.trim(), 'info')
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
  await ctx.plugin(SystemPrompt, { persona: 'Fixture workspace: {{cwd}}' })
  await ctx.plugin(ToolRuntime)
  ctx.systemPrompt.variable('cwd', context => context.agent?.session.header.cwd)
  let hostCtx: Context | undefined
  const hostFiber = ctx.inject(['commands', 'tools', 'systemPrompt'], injectedCtx => { hostCtx = injectedCtx })
  await hostFiber
  assert.notEqual(hostCtx, undefined)
  const session = ctx.sessions.create(SessionId('pi-extension-host-test'), { meta: { cwd: workspace } })
  const agent = {
    id: session.id,
    options: { provider: 'fixture', model: 'fixture', interactionMode: 'interactive' },
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

  const { inject, mountPiExtensionForAgent, renderPiSystemPrompt } = await import('../src/pi-extension-host.js')
  assert.deepEqual(inject, ['agents'])
  const mounted = await mountPiExtensionForAgent(hostCtx!, agent, {
    pluginName: 'fixture-extension',
    pluginRoot: root,
    entries: ['index.ts'],
  })
  await mounted.dispatch('session_start', { type: 'session_start' })
  await mounted.dispatch('agent_start', { type: 'agent_start' })
  await mounted.dispatch('input', { type: 'input', text: 'hello', source: 'interactive' })
  const promptSignal = new AbortController().signal
  const { renderPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const baseSystemPrompt = await renderPiSystemPrompt(agent, promptSignal)
  assert.match(baseSystemPrompt, new RegExp(`Fixture workspace: ${workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  await mounted.dispatch('before_agent_start', {
    type: 'before_agent_start',
    prompt: 'hello',
    images: undefined,
    systemPrompt: baseSystemPrompt,
    signal: promptSignal,
  })
  assert.equal(
    renderPrompt(await agent.ctx.systemPrompt.assemble({ agent, scope: agent, signal: promptSignal })),
    `${baseSystemPrompt}\nfixture-pi-system-suffix`,
  )

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
    text: `started=1 stable=true cwd=${workspace} input=hello args=ping`,
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

test('Pi extension host cold-starts from the agent capability scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-pi-extension-cold-start-'))
  await writeFile(join(root, 'index.ts'), `
export default function fixture(pi: any) {
  pi.registerCommand('telegram-status', {
    description: 'Show the Telegram bridge status',
    handler: async (_args: string, ctx: any) => ctx.ui.notify('telegram ready', 'info'),
  })
}
`)

  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)

  const agentServices = ctx.isolate('commands').isolate('tools')
  await agentServices.plugin(CommandRuntime)
  await agentServices.plugin(ToolRuntime)
  let agentCtx: Context | undefined
  const agentServicesFiber = agentServices.inject(['commands', 'tools'], scoped => { agentCtx = scoped })
  await agentServicesFiber
  assert.notEqual(agentCtx, undefined)

  const session = ctx.sessions.create(SessionId('pi-extension-cold-start-test'))
  const agent = {
    id: session.id,
    options: { provider: 'fixture', model: 'fixture', interactionMode: 'interactive' },
    session,
    status: 'idle',
    inbox: { hasPending: false },
    ctx: agentServices,
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: async (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal),
    send() {},
    followup() {},
    steer() {},
    inject() {},
  } as unknown as Agent
  const agentScope = createScope(agentServices, agent)
  ;(agent as Agent & { ctx: Context }).ctx = agentScope.ctx
  const host = await import('../src/pi-extension-host.js')
  const hostFiber = ctx.plugin(host, {
    pluginName: '@llblab/pi-telegram',
    pluginRoot: root,
    entries: ['index.ts'],
  })
  await hostFiber
  const disposeAgent = ctx.agents.register(agent)
  let command = agentCtx!.commands.find(agent, 'telegram-status')
  for (let attempt = 0; command === undefined && attempt < 100; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 20))
    command = agentCtx!.commands.find(agent, 'telegram-status')
  }
  assert.notEqual(command, undefined, ctx.logger.buffer.map(message => message.args.join(' ')).join('\n'))
  assert.deepEqual(await command!.handler({
    agent,
    commandId: 'telegram-status-cold-start' as never,
    rawInput: '',
    signal: new AbortController().signal,
  }), { kind: 'success', text: 'telegram ready' })

  await hostFiber.dispose()
  disposeAgent()
  await agentScope.dispose()
  await agentServicesFiber.dispose()
})
