import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, CONTEXT_SUMMARY_MAX_CHARS } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import type { ComponentAdapter, ComponentAdapterMaterialization } from '../kernel.js'
import { componentJson, insidePlugin, packageName, record, slug } from './utils.js'

const MONITOR_RUNTIME = '@openma/dsh-agents-plugins-bridge/claude-monitors'
const MONITOR_GRACE_MS = 3000
const MONITOR_KEYS = ['name', 'command', 'description', 'when'] as const

export interface ClaudeMonitorDefinition {
  readonly name: string
  readonly command: string
  readonly description: string
  readonly when: 'always' | `on-skill-invoke:${string}`
}

export interface ClaudeMonitorsRuntimeConfig {
  readonly pluginName: string
  readonly pluginRoot: string
  readonly pluginData?: string
  readonly monitors: readonly ClaudeMonitorDefinition[]
}

interface SubprocessSpawnSpecLike {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: {
    readonly stdin: 'ignore'
    readonly stdout: 'pipe'
    readonly stderr: 'inherit'
  }
  readonly graceMs: number
  readonly env: NodeJS.ProcessEnv
}

interface SubprocessOutcomeLike {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

interface SubprocessHandleLike {
  readonly stdout: Readable | undefined
  readonly done: Promise<SubprocessOutcomeLike>
  terminate(): void
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

interface SubprocessRuntimeLike {
  spawn(spec: SubprocessSpawnSpecLike): SubprocessHandleLike
}

interface RuntimeContext extends Context {
  readonly subprocess: SubprocessRuntimeLike
}

interface RunningMonitor {
  readonly handle: SubprocessHandleLike
  readonly pump: Promise<void>
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

function normalizeMonitor(
  value: unknown,
  index: number,
): ClaudeMonitorDefinition {
  const label = `claude-code-legacy: monitors[${index}]`
  const monitor = record(value, label)
  const unknown = Object.keys(monitor).find(key => !MONITOR_KEYS.includes(key as typeof MONITOR_KEYS[number]))
  if (unknown !== undefined) throw new TypeError(`${label}.${unknown} is not supported`)
  const name = nonEmptyString(monitor.name, `${label}.name`)
  const command = nonEmptyString(monitor.command, `${label}.command`)
  const description = nonEmptyString(monitor.description, `${label}.description`)
  if (command.includes('${user_config.')) {
    throw new TypeError(`${label}.command uses user_config, which DSH does not expose to this runtime`)
  }
  const when = monitor.when === undefined ? 'always' : monitor.when
  if (when === 'always') return { name, command, description, when }
  if (typeof when !== 'string' || !when.startsWith('on-skill-invoke:')) {
    throw new TypeError('when must be "always" or "on-skill-invoke:<skill-name>"')
  }
  const skill = when.slice('on-skill-invoke:'.length)
  if (!isSkillName(skill)) {
    throw new TypeError('when must name a DSH-compatible skill after "on-skill-invoke:"')
  }
  return { name, command, description, when: `on-skill-invoke:${skill}` }
}

function monitorMaterialization(
  input: Parameters<ComponentAdapter['materialize']>[0],
): ComponentAdapterMaterialization {
  if (input.detected.provider !== 'claude-code-legacy') {
    throw new TypeError(`${input.detected.provider}: monitor components require the Claude Code adapter`)
  }
  const raw = componentJson(input)
  if (!Array.isArray(raw)) {
    return {
      rows: [],
      diagnostics: [`claude-code-legacy: ${input.component.path} is unsupported: monitors must be a JSON array`],
    }
  }
  const monitors: ClaudeMonitorDefinition[] = []
  const diagnostics: string[] = []
  const names = new Set<string>()
  for (const [index, value] of raw.entries()) {
    try {
      const monitor = normalizeMonitor(value, index)
      if (monitor.command.includes('${CLAUDE_PLUGIN_DATA}') && input.pluginDataRoot === undefined) {
        throw new TypeError('command requires CLAUDE_PLUGIN_DATA, but this installation has no plugin data root')
      }
      if (names.has(monitor.name)) {
        throw new TypeError(`duplicate monitor name "${monitor.name}"`)
      }
      names.add(monitor.name)
      monitors.push(monitor)
    } catch (error: unknown) {
      let identity = `monitors[${index}]`
      if (typeof value === 'object' && value !== null && !Array.isArray(value)
        && typeof (value as Record<string, unknown>).name === 'string') {
        identity = `monitor "${(value as Record<string, unknown>).name as string}"`
      }
      diagnostics.push(
        `claude-code-legacy: ${identity} is unsupported: ${error instanceof Error ? error.message.replace(/^claude-code-legacy: monitors\[\d+\]\./u, '') : String(error)}`,
      )
    }
  }
  if (monitors.length === 0) return { rows: [], ...diagnostics.length === 0 ? {} : { diagnostics } }
  const pluginName = packageName(input)
  const plugin = slug(pluginName)
  const monitorComponents = input.detected.components.filter(component => component.type === 'monitor')
  const suffix = monitorComponents.length > 1 ? `-${slug(input.component.path)}` : ''
  const rowId = `plugin-bridge-${plugin}-claude-monitors${suffix}`
  return {
    rows: [{
      id: rowId,
      name: MONITOR_RUNTIME,
      config: {
        pluginName,
        pluginRoot: insidePlugin(input, '.'),
        ...input.pluginDataRoot === undefined ? {} : { pluginData: input.pluginDataRoot },
        monitors,
      },
    }],
    ...diagnostics.length === 0 ? {} : { diagnostics },
  }
}

/** Map verified Claude monitor events onto the DSH agent/session and subprocess seams. */
export const dshClaudeMonitorsAdapter: ComponentAdapter = {
  name: 'dsh-claude-monitors',
  componentTypes: ['monitor'],
  materialize: monitorMaterialization,
}

function runtimeConfig(value: ClaudeMonitorsRuntimeConfig): ClaudeMonitorsRuntimeConfig {
  const config = record(value, 'claude monitors runtime config')
  const pluginName = nonEmptyString(config.pluginName, 'claude monitors runtime config.pluginName')
  const pluginRoot = nonEmptyString(config.pluginRoot, 'claude monitors runtime config.pluginRoot')
  const pluginData = config.pluginData === undefined
    ? undefined
    : nonEmptyString(config.pluginData, 'claude monitors runtime config.pluginData')
  if (!Array.isArray(config.monitors)) {
    throw new TypeError('claude monitors runtime config.monitors must be an array')
  }
  const monitors = config.monitors.map((monitor, index) => normalizeMonitor(monitor, index))
  return { pluginName, pluginRoot, ...pluginData === undefined ? {} : { pluginData }, monitors }
}

function shellCommand(command: string): readonly string[] {
  return process.platform === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', command]
    : ['sh', '-lc', command]
}

function xmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function summary(name: string, line: string): string {
  const account = `${name}: ${line.replace(/\s+/gu, ' ').trim()}`
  return account.length <= CONTEXT_SUMMARY_MAX_CHARS
    ? account
    : account.slice(0, CONTEXT_SUMMARY_MAX_CHARS)
}

function skillInvocation(event: SessionEvent): string | undefined {
  if (event.type === 'tool/call' && event.data.name === 'skill') {
    try {
      const args = JSON.parse(event.data.arguments) as unknown
      if (typeof args === 'object' && args !== null && !Array.isArray(args)
        && typeof (args as Record<string, unknown>).name === 'string') {
        return (args as Record<string, unknown>).name as string
      }
    } catch {
      return undefined
    }
  }
  if (event.type === 'user/message' && event.data.source.kind === 'skill-invocation') {
    return event.data.source.name
  }
  return undefined
}

class AgentMonitorRuntime {
  private readonly started = new Set<string>()
  private readonly running = new Map<string, RunningMonitor>()
  private closing = false

  constructor(
    private readonly ctx: RuntimeContext,
    private readonly agent: Agent,
    private readonly config: ClaudeMonitorsRuntimeConfig,
  ) {}

  startAlways(): void {
    for (const monitor of this.config.monitors) {
      if (monitor.when === 'always') this.start(monitor)
    }
  }

  observe(event: SessionEvent): void {
    const skill = skillInvocation(event)
    if (skill === undefined) return
    for (const monitor of this.config.monitors) {
      if (monitor.when === `on-skill-invoke:${skill}`) this.start(monitor)
    }
  }

  private start(monitor: ClaudeMonitorDefinition): void {
    if (this.closing || this.started.has(monitor.name)) return
    const cwd = this.agent.session.header.cwd
    if (cwd === undefined) {
      this.ctx.logger.warn(
        `claude monitor "${this.config.pluginName}/${monitor.name}" was not started: the DSH session has no cwd`,
      )
      return
    }
    if (monitor.command.includes('${CLAUDE_PLUGIN_DATA}') && this.config.pluginData === undefined) {
      this.ctx.logger.warn(
        `claude monitor "${this.config.pluginName}/${monitor.name}" was not started: CLAUDE_PLUGIN_DATA is unavailable`,
      )
      return
    }
    let handle: SubprocessHandleLike
    try {
      handle = this.ctx.subprocess.spawn({
        argv: shellCommand(monitor.command),
        cwd,
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' },
        graceMs: MONITOR_GRACE_MS,
        env: {
          CLAUDE_PLUGIN_ROOT: this.config.pluginRoot,
          ...this.config.pluginData === undefined ? {} : { CLAUDE_PLUGIN_DATA: this.config.pluginData },
          CLAUDE_PROJECT_DIR: cwd,
        },
      })
      if (handle.stdout === undefined) {
        handle.terminate()
        throw new Error('DSH subprocess provider did not expose piped stdout')
      }
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `claude monitor "${this.config.pluginName}/${monitor.name}" failed to start: ${String(error)}`,
      )
      return
    }
    this.started.add(monitor.name)
    const pump = this.pump(monitor, handle)
    this.running.set(monitor.name, { handle, pump })
    void pump.finally(() => {
      if (this.running.get(monitor.name)?.handle === handle) this.running.delete(monitor.name)
    })
  }

  private async pump(monitor: ClaudeMonitorDefinition, handle: SubprocessHandleLike): Promise<void> {
    const stream = handle.stdout
    if (stream === undefined) return
    const decoder = new StringDecoder('utf8')
    let pending = ''
    try {
      for await (const chunk of stream) {
        pending += typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer)
        let newline = pending.indexOf('\n')
        while (newline >= 0) {
          const line = pending.slice(0, newline).replace(/\r$/u, '')
          pending = pending.slice(newline + 1)
          this.deliver(monitor, line)
          newline = pending.indexOf('\n')
        }
      }
      pending += decoder.end()
      if (pending.length > 0) this.deliver(monitor, pending.replace(/\r$/u, ''))
      const outcome = await handle.done
      if (!this.closing && (outcome.exitCode !== 0 || outcome.signal !== null)) {
        this.ctx.logger.warn(
          `claude monitor "${this.config.pluginName}/${monitor.name}" exited: code=${String(outcome.exitCode)} signal=${String(outcome.signal)}`,
        )
      }
    } catch (error: unknown) {
      if (!this.closing) {
        this.ctx.logger.warn(
          `claude monitor "${this.config.pluginName}/${monitor.name}" output failed: ${String(error)}`,
        )
      }
    }
  }

  private deliver(monitor: ClaudeMonitorDefinition, line: string): void {
    if (this.closing) return
    const message = createUserMessage({
      content: [{
        type: 'text',
        text: `<monitor_notification name="${xmlAttribute(monitor.name)}">\n${line}\n</monitor_notification>`,
      }],
      source: {
        kind: 'plugin',
        plugin: `claude-monitor:${this.config.pluginName}`,
        form: 'notice',
        summary: summary(monitor.name, line),
      },
    })
    if (this.agent.status === 'idle') this.agent.followup(message)
    else this.agent.steer(message)
  }

  async dispose(): Promise<void> {
    if (this.closing) return
    this.closing = true
    const running = [...this.running.values()]
    for (const { handle } of running) handle.terminate()
    await Promise.allSettled(running.map(async ({ handle, pump }) => {
      await handle.waitForExit()
      await pump
    }))
    this.running.clear()
  }
}

type Cleanup = () => void | Promise<void>

/** Runtime half exported for a dedicated package export wrapper. */
export function applyClaudeMonitorsRuntime(
  ctx: Context,
  rawConfig: ClaudeMonitorsRuntimeConfig,
): void {
  const config = runtimeConfig(rawConfig)
  const runtimeCtx = ctx as RuntimeContext
  const cleanups = new Map<Agent, Cleanup>()
  let stopping = false

  const mount = (agent: Agent, alreadyStarted: boolean): void => {
    if (stopping || cleanups.has(agent)) return
    const runtime = new AgentMonitorRuntime(runtimeCtx, agent, config)
    let cleanup: Cleanup
    cleanup = agent.ctx.effect(() => {
      const stopStart = agent.ctx.on('agent/session-start', () => { runtime.startAlways() })
      const stopEvents = agent.ctx.on('session/event', (session, event) => {
        if (session === agent.session) runtime.observe(event)
      })
      if (alreadyStarted) runtime.startAlways()
      return async () => {
        stopEvents()
        stopStart()
        try {
          await runtime.dispose()
        } finally {
          if (cleanups.get(agent) === cleanup) cleanups.delete(agent)
        }
      }
    }, `claude-monitors.runtime(${config.pluginName})`)
    cleanups.set(agent, cleanup)
  }

  ctx.effect(() => {
    for (const agent of ctx.agents.list()) mount(agent, true)
    const stopCreated = ctx.on('agent/created', ({ agent }) => { mount(agent, false) })
    const stopDisposed = ctx.on('agent/disposed', ({ agent }) => {
      const cleanup = cleanups.get(agent)
      if (cleanup !== undefined) void Promise.resolve(cleanup())
    })
    return async () => {
      stopping = true
      stopDisposed()
      stopCreated()
      const owned = [...cleanups.values()]
      cleanups.clear()
      await Promise.allSettled(owned.map(cleanup => Promise.resolve(cleanup())))
    }
  }, `claude-monitors.lifecycle(${config.pluginName})`)
}

export const name = 'plugin-bridge-adapter-dsh-claude-monitors'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshClaudeMonitorsAdapter)
}
