import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry, { emitAgentEvent, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ComponentAdapterMaterialization,
  ComponentMaterializationInput,
  PluginPackageSource,
} from '../src/kernel.js'
import {
  dshClaudeMonitorsAdapter,
  type ClaudeMonitorsRuntimeConfig,
} from '../src/adapters/dsh-claude-monitors.js'
import * as claudeMonitorsRuntime from '../src/claude-monitors.js'

interface SpawnSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: {
    readonly stdin: 'ignore'
    readonly stdout: 'pipe'
    readonly stderr: 'inherit'
  }
  readonly graceMs: number
  readonly env?: NodeJS.ProcessEnv
}

class FakeHandle {
  readonly stdout = new PassThrough()
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  terminateCalls = 0
  waitCalls = 0
  private settle!: (outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void

  constructor() {
    this.done = new Promise(resolve => { this.settle = resolve })
  }

  terminate(): void {
    this.terminateCalls += 1
    this.stdout.end()
    this.settle({ exitCode: null, signal: 'SIGTERM' })
  }

  async waitForExit(): Promise<boolean> {
    this.waitCalls += 1
    await this.done
    return true
  }
}

class FakeSubprocess extends Service {
  readonly spawns: Array<{ spec: SpawnSpec; handle: FakeHandle }> = []

  constructor(ctx: Context) {
    super(ctx, 'subprocess')
  }

  spawn(spec: SpawnSpec): FakeHandle {
    const handle = new FakeHandle()
    this.spawns.push({ spec, handle })
    return handle
  }
}

function source(files: Record<string, unknown>): PluginPackageSource {
  return {
    root: '/fixture/claude-plugin',
    has: path => Object.hasOwn(files, path),
    kind: path => Object.hasOwn(files, path) ? 'file' : undefined,
    readJson: path => files[path],
  }
}

function input(files: Record<string, unknown>): ComponentMaterializationInput {
  const pluginSource = source(files)
  return {
    source: pluginSource,
    pluginDataRoot: '/fixture/claude-data',
    detected: {
      provider: 'claude-code-legacy',
      manifestPath: '.claude-plugin/plugin.json',
      manifest: { name: 'ops-pack' },
      components: [{ type: 'monitor', path: 'monitors/monitors.json' }],
    },
    component: { type: 'monitor', path: 'monitors/monitors.json' },
  }
}

async function eventually(assertion: () => void): Promise<void> {
  let failure: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion()
      return
    } catch (error: unknown) {
      failure = error
      await new Promise(resolve => setTimeout(resolve, 2))
    }
  }
  throw failure
}

test('Claude monitor materialization validates declarations instead of silently falling back', () => {
  const result = dshClaudeMonitorsAdapter.materialize(input({
    'monitors/monitors.json': [
      {
        name: 'deploy-status',
        command: 'node "${CLAUDE_PLUGIN_ROOT}/poll.mjs"',
        description: 'Deployment status changes',
      },
      {
        name: 'debug-log',
        command: 'tail -F ./debug.log',
        description: 'Debug log changes',
        when: 'on-skill-invoke:debug',
      },
      {
        name: 'unsupported',
        command: 'true',
        description: 'Unknown event mapping',
        when: 'on-command:deploy',
      },
    ],
  }))

  assert.ok(!Array.isArray(result))
  const materialized = result as ComponentAdapterMaterialization
  assert.deepEqual(materialized.rows, [{
    id: 'plugin-bridge-ops-pack-claude-monitors',
    name: '@openma/dsh-agents-plugins-bridge/claude-monitors',
    config: {
      pluginName: 'ops-pack',
      pluginRoot: '/fixture/claude-plugin',
      pluginData: '/fixture/claude-data',
      monitors: [
        {
          name: 'deploy-status',
          command: 'node "${CLAUDE_PLUGIN_ROOT}/poll.mjs"',
          description: 'Deployment status changes',
          when: 'always',
        },
        {
          name: 'debug-log',
          command: 'tail -F ./debug.log',
          description: 'Debug log changes',
          when: 'on-skill-invoke:debug',
        },
      ],
    },
  }])
  assert.deepEqual(materialized.diagnostics, [
    'claude-code-legacy: monitor "unsupported" is unsupported: when must be "always" or "on-skill-invoke:<skill-name>"',
  ])
})

test('Claude monitors use DSH lifecycle/session events, stream notices, and terminate on unload', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(FakeSubprocess)

  const config: ClaudeMonitorsRuntimeConfig = {
    pluginName: 'ops-pack',
    pluginRoot: '/fixture/claude-plugin',
    pluginData: '/fixture/claude-data',
    monitors: [
      {
        name: 'deploy-status',
        command: 'node "${CLAUDE_PLUGIN_ROOT}/poll.mjs"',
        description: 'Deployment status changes',
        when: 'always',
      },
      {
        name: 'debug-log',
        command: 'tail -F ./debug.log',
        description: 'Debug log changes',
        when: 'on-skill-invoke:debug',
      },
      {
        name: 'review-log',
        command: 'tail -F ./review.log',
        description: 'Review log changes',
        when: 'on-skill-invoke:review',
      },
    ],
  }
  const runtimeFiber = await ctx.plugin(claudeMonitorsRuntime, config)

  const deliveries: Array<{ kind: 'followup' | 'steer'; message: unknown }> = []
  let status: 'idle' | 'running' = 'idle'
  const agent = {
    id: SessionId('claude-monitor-agent'),
    options: { provider: 'fixture', model: 'fixture' },
    get status() { return status },
    inbox: { hasPending: false },
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: async (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal),
    send() {},
    followup(message: unknown) { deliveries.push({ kind: 'followup', message }) },
    steer(message: unknown) { deliveries.push({ kind: 'steer', message }) },
    inject() {},
  } as unknown as Agent
  let sessionCtx: Context | undefined
  const sessionFiber = ctx.inject(['sessions'], injectedCtx => { sessionCtx = injectedCtx })
  await sessionFiber
  assert.notEqual(sessionCtx, undefined)
  const scope = createScope(sessionCtx!, agent)
  ;(agent as Agent & { ctx: Context }).ctx = scope.ctx
  ;(agent as Agent & { session: Agent['session'] }).session = agent.ctx.sessions.create(agent.id, {
    meta: { cwd: '/fixture/workspace' },
  })
  const unregister = ctx.agents.register(agent)

  emitAgentEvent(ctx, agent, 'agent/session-start', { source: 'startup' })
  const subprocess = (ctx as Context & { subprocess: FakeSubprocess }).subprocess
  assert.equal(subprocess.spawns.length, 1)
  assert.deepEqual(subprocess.spawns[0]?.spec, {
    argv: process.platform === 'win32'
      ? ['cmd.exe', '/d', '/s', '/c', 'node "${CLAUDE_PLUGIN_ROOT}/poll.mjs"']
      : ['sh', '-lc', 'node "${CLAUDE_PLUGIN_ROOT}/poll.mjs"'],
    cwd: '/fixture/workspace',
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' },
    graceMs: 3000,
    env: {
      CLAUDE_PLUGIN_ROOT: '/fixture/claude-plugin',
      CLAUDE_PLUGIN_DATA: '/fixture/claude-data',
      CLAUDE_PROJECT_DIR: '/fixture/workspace',
    },
  })

  subprocess.spawns[0]?.handle.stdout.write('deployment ready\n')
  await eventually(() => {
    assert.equal(deliveries.length, 1)
    assert.equal(deliveries[0]?.kind, 'followup')
    const message = deliveries[0]?.message as ReturnType<typeof createUserMessage>
    assert.equal(message.content[0]?.type, 'text')
    assert.equal(message.content[0]?.type === 'text' ? message.content[0].text : undefined,
      '<monitor_notification name="deploy-status">\ndeployment ready\n</monitor_notification>')
    assert.deepEqual(message.source, {
      kind: 'plugin',
      plugin: 'claude-monitor:ops-pack',
      form: 'notice',
      summary: 'deploy-status: deployment ready',
    })
  })

  status = 'running'
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: CallId('skill-call'),
    name: 'skill',
    arguments: '{"name":"debug"}',
  })
  assert.equal(subprocess.spawns.length, 2)

  subprocess.spawns[1]?.handle.stdout.write('trace changed\n')
  await eventually(() => {
    assert.equal(deliveries.length, 2)
    assert.equal(deliveries[1]?.kind, 'steer')
  })

  agent.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '<skill_content name="review">review instructions</skill_content>' }],
    source: { kind: 'skill-invocation', name: 'review', form: 'instructions' },
  }), { surfaceOp: 'append' })
  assert.equal(subprocess.spawns.length, 3)

  await runtimeFiber.dispose()
  assert.deepEqual(subprocess.spawns.map(spawn => spawn.handle.terminateCalls), [1, 1, 1])
  assert.deepEqual(subprocess.spawns.map(spawn => spawn.handle.waitCalls), [1, 1, 1])

  unregister()
  await scope.dispose()
  await sessionFiber.dispose()
})
