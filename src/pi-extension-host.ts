import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { assembleContextFor, installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition as DshToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  createEventBus,
  createExtensionRuntime,
  ExtensionRunner,
  type ExtensionActions,
  type ExtensionCommandContextActions,
  type ExtensionContextActions,
  type ExtensionRuntime,
  type ExtensionUIContext,
  type LoadExtensionsResult,
  type ModelRegistry,
  type SessionManager,
} from '@earendil-works/pi-coding-agent'
import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { boundedName } from './adapters/utils.js'
import { resolvePiExtensionFiles } from './pi-extension-files.js'

export interface PiExtensionHostConfig {
  readonly pluginName: string
  readonly pluginRoot: string
  readonly entries: readonly string[]
  readonly pluginData?: string
}

export interface MountedPiExtension {
  dispatch(type: string, event: Readonly<Record<string, unknown>>): Promise<unknown[]>
  dispose(): Promise<void>
}

export async function renderPiSystemPrompt(agent: Agent, signal: AbortSignal): Promise<string> {
  return renderPrompt(await agent.ctx.systemPrompt.assemble(assembleContextFor(agent, signal)))
}

interface PiLoaderModule {
  loadExtensions(
    paths: string[],
    cwd: string,
    eventBus: ReturnType<typeof createEventBus>,
    runtime: ExtensionRuntime,
  ): Promise<LoadExtensionsResult>
}

interface PiCanonicalToolResult {
  readonly content: JsonValue[]
  readonly details?: JsonValue
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`pi-extension-host: ${name} must be a non-empty string`)
  }
  return value
}

function configEntries(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== 'string')) {
    throw new TypeError('pi-extension-host: entries must be a non-empty string array')
  }
  return value as readonly string[]
}

function json(value: unknown): JsonValue {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) return null
  return JSON.parse(encoded) as JsonValue
}

const JSON_SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

/** Project TypeBox's wider vocabulary onto the JSON Schema subset DSH enforces. */
function dshParameterSchema(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const schema: Record<string, unknown> = {}
  if (typeof source.type === 'string' && JSON_SCHEMA_TYPES.has(source.type)) schema.type = source.type
  if (Array.isArray(source.type)) {
    const branches = source.type
      .filter((type): type is string => typeof type === 'string' && JSON_SCHEMA_TYPES.has(type))
      .map(type => ({ type }))
    if (branches.length > 0) schema.oneOf = branches
  }
  if (typeof source.properties === 'object' && source.properties !== null && !Array.isArray(source.properties)) {
    schema.properties = Object.fromEntries(
      Object.entries(source.properties as Record<string, unknown>)
        .map(([name, child]) => [name, dshParameterSchema(child)]),
    )
  }
  if (Array.isArray(source.required) && source.required.every(item => typeof item === 'string')) {
    schema.required = [...source.required]
  }
  if (typeof source.additionalProperties === 'boolean') schema.additionalProperties = source.additionalProperties
  if (source.items !== undefined) schema.items = dshParameterSchema(source.items)
  const alternatives = Array.isArray(source.oneOf) ? source.oneOf : source.anyOf
  if (Array.isArray(alternatives) && alternatives.length >= 2) {
    schema.oneOf = alternatives.map(dshParameterSchema)
  }
  if (Array.isArray(source.enum)) schema.enum = source.enum.map(json)
  if (source.const !== undefined) schema.const = json(source.const)
  if (typeof source.description === 'string') schema.description = source.description
  if (typeof source.title === 'string') schema.title = source.title
  if (source.default !== undefined) schema.default = json(source.default)
  if (source.examples !== undefined) schema.examples = json(source.examples)
  return schema
}

function canonicalToolResult(value: unknown): PiCanonicalToolResult {
  const record = typeof value === 'object' && value !== null
    ? value as { content?: unknown; details?: unknown }
    : {}
  const content = Array.isArray(record.content) ? record.content.map(json) : []
  return {
    content,
    ...record.details === undefined ? {} : { details: json(record.details) },
  }
}

function dshContent(value: JsonValue): ContentBlock[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ type: 'text', text: String(value) }]
  }
  const content = value as Record<string, JsonValue>
  if (content.type === 'text' && typeof content.text === 'string') {
    return [{ type: 'text', text: content.text }]
  }
  if (
    content.type === 'image'
    && typeof content.data === 'string'
    && typeof content.mimeType === 'string'
  ) {
    return [{ type: 'text', text: `[Pi image: ${content.mimeType}]` }]
  }
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function renderPiResult(value: JsonValue): ContentBlock[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return dshContent(value)
  }
  const content = (value as Record<string, JsonValue>).content
  return Array.isArray(content) ? content.flatMap(dshContent) : dshContent(value)
}

function textFromInput(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content) }]
  return content.flatMap(item => dshContent(json(item)))
}

function messageText(message: { readonly content?: unknown }): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter((block): block is { type: 'text'; text: string } => (
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
    ))
    .map(block => block.text)
    .join('\n')
}

function relativePath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

async function piLoader(): Promise<PiLoaderModule> {
  const packageEntry = import.meta.resolve('@earendil-works/pi-coding-agent')
  const loaderUrl = new URL('./core/extensions/loader.js', packageEntry)
  return import(loaderUrl.href) as Promise<PiLoaderModule>
}

function questionService(ctx: Context): {
  ask(request: Record<string, unknown>): Promise<{ answers: Array<{ selected: string[]; custom?: string }> }>
} | undefined {
  return ctx.get('userQuestions' as never) as ReturnType<typeof questionService>
}

function modelFor(agent: Agent, selection: ModelSelectionRef): Record<string, unknown> {
  const selected = selection.current ?? {
    provider: agent.options.provider ?? 'unknown',
    model: agent.options.model ?? 'unknown',
  }
  return {
    provider: selected.provider,
    id: selected.model,
    name: selected.model,
    api: selected.provider,
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  }
}

/** Load one copied Pi package into the exact DSH agent scope that consumes it. */
export async function mountPiExtensionForAgent(
  ctx: Context,
  agent: Agent,
  rawConfig: PiExtensionHostConfig,
): Promise<MountedPiExtension> {
  const pluginName = nonEmpty(rawConfig.pluginName, 'pluginName')
  const commandNamespace = boundedName(pluginName, 40)
  const pluginRoot = realpathSync(nonEmpty(rawConfig.pluginRoot, 'pluginRoot'))
  const entries = configEntries(rawConfig.entries)
  const files = resolvePiExtensionFiles(pluginRoot, entries)
  if (files.length === 0) throw new Error(`${pluginName}: no loadable Pi extension entrypoints`)
  const cwd = agent.session.header.cwd ?? process.cwd()

  const capabilityCtx = ctx

  const runtime = createExtensionRuntime()
  const bus = createEventBus()
  const loader = await piLoader()
  const loaded = await loader.loadExtensions(files, cwd, bus, runtime)
  if (loaded.errors.length > 0) {
    throw new Error(loaded.errors.map(error => `${relativePath(pluginRoot, error.path)}: ${error.error}`).join('\n'))
  }

  const disposers: Array<() => Promise<void> | void> = []
  const notices: string[] = []
  const customEntries: Array<Record<string, unknown>> = []
  const status = new Map<string, string>()
  const toolNames = new Map<string, string>()
  const requestConfig = agent.session.requestHeader()?.config
  const selection: ModelSelectionRef = {
    current: {
      provider: requestConfig?.provider ?? agent.options.provider ?? 'unknown',
      model: requestConfig?.model ?? agent.options.model ?? 'unknown',
      ...requestConfig?.reasoningEffort === undefined ? {} : { reasoningEffort: requestConfig.reasoningEffort },
    },
    assembled: undefined,
  }
  disposers.push(installModelSelection(agent.ctx, selection))
  let thinkingLevel: string = requestConfig?.reasoningEffort ?? 'off'
  let sessionName: string | undefined
  let activeTools = new Set<string>()
  const toolDisposers = new Map<string, () => void>()
  const execution = new AsyncLocalStorage<{ signal?: AbortSignal; sink: string[]; systemPrompt?: string }>()
  const promptOverrides = new WeakMap<AbortSignal, string>()
  let effectiveSystemPrompt = ''
  const disposePromptAssembly = capabilityCtx.on('system-prompt/assemble', async (assembly, context, next) => {
    const assembled = await next()
    if (context.signal === undefined || !promptOverrides.has(context.signal)) return assembled
    const override = promptOverrides.get(context.signal)!
    effectiveSystemPrompt = override
    return {
      ...assembled,
      sections: [{ name: `pi:${pluginName}`, text: override }],
    }
  })
  disposers.push(() => { disposePromptAssembly() })

  function availableName(
    foreignName: string,
    occupied: (candidate: string) => boolean,
  ): string {
    if (!occupied(foreignName)) return foreignName
    for (let suffix = 1; ; suffix += 1) {
      const candidate = boundedName(
        `pi-${commandNamespace}-${foreignName}${suffix === 1 ? '' : `-${suffix}`}`,
        64,
      )
      if (!occupied(candidate)) return candidate
    }
  }

  const theme = new Proxy({}, {
    get: () => (...args: unknown[]) => String(args.at(-1) ?? ''),
  })

  async function ask(
    prompt: string,
    options: readonly string[] | undefined,
  ): Promise<{ selected: string[]; custom?: string }> {
    const service = questionService(agent.ctx)
    if (service === undefined) throw new Error('Pi extension UI requires a DSH user-questions provider')
    const answer = await service.ask({
      questions: [{
        id: 'pi-extension-answer',
        question: prompt,
        ...options === undefined ? {} : { options: options.map(label => ({ label })) },
      }],
      agent,
      signal: execution.getStore()?.signal,
    })
    return answer.answers[0] ?? { selected: [] }
  }

  const sessionEntries = (): Array<Record<string, unknown>> => [
      ...agent.session.events.map(event => ({ ...event, id: `dsh-${event.seq}` })),
      ...customEntries,
    ]
  const sessionManager = {
    getCwd: () => cwd,
    getSessionDir: () => rawConfig.pluginData ?? pluginRoot,
    getSessionId: () => String(agent.id),
    getSessionFile: () => undefined,
    getLeafId: () => (sessionEntries().at(-1)?.id as string | undefined) ?? null,
    getLeafEntry: () => sessionEntries().at(-1),
    getEntry: (id: string) => sessionEntries().find(entry => entry.id === id),
    getLabel: () => undefined,
    getBranch: () => sessionEntries(),
    buildContextEntries: () => sessionEntries(),
    getHeader: () => null,
    getEntries: () => sessionEntries(),
    getTree: () => [],
    getSessionName: () => sessionName,
  } as unknown as SessionManager
  const modelRegistry = {
    getAvailable: () => [modelFor(agent, selection)],
    find: (provider: string, modelId: string) => {
      const model = modelFor(agent, selection)
      return model.provider === provider && model.id === modelId ? model : undefined
    },
    refresh: async () => undefined,
    isUsingOAuth: () => false,
    registerProvider: () => {
      throw new Error('pi-extension-host: Pi provider registration has no exact DSH mapping')
    },
    unregisterProvider: () => {
      throw new Error('pi-extension-host: Pi provider unregistration has no exact DSH mapping')
    },
  } as unknown as ModelRegistry
  const ui: ExtensionUIContext = {
    async select(title, options) {
      const answer = await ask(title, options)
      return answer.selected[0]
    },
    async confirm(title, message) {
      const answer = await ask(`${title}\n\n${message}`, ['Yes', 'No'])
      return answer.selected.includes('Yes')
    },
    async input(title, placeholder) {
      const answer = await ask(placeholder === undefined ? title : `${title}\n${placeholder}`, undefined)
      return answer.custom ?? answer.selected[0]
    },
    async editor(title, prefill) {
      const answer = await ask(prefill === undefined ? title : `${title}\n${prefill}`, undefined)
      return answer.custom ?? answer.selected[0]
    },
    notify(message) { (execution.getStore()?.sink ?? notices).push(message) },
    setStatus(key, value) {
      if (value === undefined) status.delete(key)
      else status.set(key, value)
    },
    onTerminalInput: () => () => undefined,
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setTitle() {},
    custom: async () => {
      throw new Error('pi-extension-host: custom Pi TUI components are not supported by the DSH host')
    },
    pasteToEditor() {},
    setEditorText() {},
    getEditorText: () => '',
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent: () => undefined,
    get theme() { return theme as never },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Pi themes are owned by the DSH host' }),
    getToolsExpanded: () => false,
    setToolsExpanded() {},
  }
  const runner = new ExtensionRunner(loaded.extensions, runtime, cwd, sessionManager, modelRegistry)
  runner.setUIContext(ui, piUiModeForAgent(agent))
  runner.onError(error => {
    ctx.logger.warn(`${pluginName}: Pi ${error.event} hook failed in ${relativePath(pluginRoot, error.extensionPath)}: ${error.error}`)
  })

  function registeredTools(): ReturnType<ExtensionRunner['getAllRegisteredTools']> {
    return runner.getAllRegisteredTools()
  }

  function syncTools(): void {
    for (const { definition } of registeredTools()) {
      const enabled = activeTools.has(definition.name)
      const dispose = toolDisposers.get(definition.name)
      if (!enabled && dispose !== undefined) {
        dispose()
        toolDisposers.delete(definition.name)
      } else if (enabled && dispose === undefined) {
        const dshName = toolNames.get(definition.name) ?? availableName(
          definition.name,
          candidate => candidate === 'run_code' || capabilityCtx.tools.get(candidate, agent) !== undefined,
        )
        toolNames.set(definition.name, dshName)
        const dshTool: DshToolDefinition = {
          name: dshName,
          description: definition.description,
          parameters: dshParameterSchema(definition.parameters),
          output: {
            schema: {},
            render: (_args, value) => renderPiResult(value),
          },
          ...definition.executionMode === 'parallel' ? { isConcurrencySafe: () => true } : {},
          async execute(args, exec) {
            const value = definition.prepareArguments?.(args) ?? args
            const result = await execution.run({ signal: exec.signal, sink: notices }, () => definition.execute(
                String(exec.callId),
                value as never,
                exec.signal,
                partial => void runner.emit({
                  type: 'tool_execution_update',
                  toolCallId: String(exec.callId),
                  toolName: definition.name,
                  args,
                  partialResult: partial,
                }),
                runner.createContext(),
              ))
            return canonicalToolResult(result)
          },
        }
        toolDisposers.set(definition.name, capabilityCtx.tools.register(dshTool))
      }
    }
  }

  const extensionActions: ExtensionActions = {
    sendUserMessage(content, options) {
      const message = createUserMessage({ content: textFromInput(content), source: { kind: 'user' } })
      if (options?.deliverAs === 'followUp') agent.followup(message)
      else agent.steer(message)
    },
    sendMessage(message, options) {
      const userMessage = createUserMessage({ content: textFromInput(message.content), source: { kind: 'user' } })
      if (options?.deliverAs === 'followUp' || options?.deliverAs === 'nextTurn') agent.followup(userMessage)
      else if (options?.triggerTurn === false) agent.inject(userMessage)
      else agent.steer(userMessage)
    },
    appendEntry(customType, data) {
      customEntries.push({ type: 'custom', customType, data, id: `dsh-pi-${customEntries.length + 1}` })
    },
    setSessionName(value) { sessionName = value },
    getSessionName: () => sessionName,
    setLabel() {},
    getActiveTools: () => [...activeTools].sort(),
    getAllTools: () => registeredTools().map(({ definition, sourceInfo }) => ({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      promptGuidelines: definition.promptGuidelines,
      sourceInfo,
    })) as never,
    setActiveTools(toolNameList) {
      activeTools = new Set(toolNameList)
      syncTools()
    },
    refreshTools: syncTools,
    getCommands: () => runner.getRegisteredCommands().map(command => ({
      name: command.invocationName,
      description: command.description,
      source: 'extension',
      sourceInfo: command.sourceInfo,
    })) as never,
    async setModel(model) {
      const previousModel = modelFor(agent, selection) as never
      const reasoningEffort = selection.current?.reasoningEffort
      selection.current = {
        provider: model.provider,
        model: model.id,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
      await runner.emit({ type: 'model_select', model, previousModel, source: 'set' })
      return true
    },
    getThinkingLevel: () => thinkingLevel as never,
    setThinkingLevel(level) {
      const previousLevel = thinkingLevel as never
      thinkingLevel = level
      const selected = selection.current ?? {
        provider: agent.options.provider ?? 'unknown',
        model: agent.options.model ?? 'unknown',
      }
      selection.current = {
        provider: selected.provider,
        model: selected.model,
        ...level === 'off' ? {} : { reasoningEffort: level as never },
      }
      void runner.emit({ type: 'thinking_level_select', level, previousLevel })
    },
  }
  const contextActions: ExtensionContextActions = {
    getModel: () => modelFor(agent, selection) as never,
    getScopedModels: () => [],
    isIdle: () => agent.status === 'idle',
    isProjectTrusted: () => true,
    getSignal: () => execution.getStore()?.signal,
    abort: () => agent.cancel({ kind: 'user' }),
    hasPendingMessages: () => agent.inbox.hasPending,
    shutdown: () => agent.cancel({ kind: 'user' }),
    getContextUsage: () => undefined,
    compact(options) {
      const compaction = ctx.get('compaction' as never) as {
        compactNow(target: Agent, operationSignal: AbortSignal): Promise<unknown>
      } | undefined
      if (compaction === undefined) {
        options?.onError?.(new Error('DSH compaction service is unavailable'))
        return
      }
      void compaction.compactNow(agent, execution.getStore()?.signal ?? new AbortController().signal)
        .then(result => { options?.onComplete?.(result as never) })
        .catch(error => { options?.onError?.(error instanceof Error ? error : new Error(String(error))) })
    },
    getSystemPrompt: () => execution.getStore()?.systemPrompt ?? effectiveSystemPrompt,
    getSystemPromptOptions: () => ({ cwd }),
  }
  const unsupportedSessionOperation = async (operation: string): Promise<{ cancelled: boolean }> => {
    throw new Error(`pi-extension-host: Pi ${operation} has no exact DSH mapping`)
  }
  const commandContextActions: ExtensionCommandContextActions = {
    waitForIdle: () => agent.whenIdle(),
    newSession: () => unsupportedSessionOperation('newSession'),
    fork: () => unsupportedSessionOperation('fork'),
    navigateTree: () => unsupportedSessionOperation('navigateTree'),
    switchSession: () => unsupportedSessionOperation('switchSession'),
    reload: async () => {
      throw new Error('pi-extension-host: Pi reload has no exact DSH mapping')
    },
  }
  runner.bindCore(extensionActions, contextActions)
  runner.bindCommandContext(commandContextActions)

  for (const command of runner.getRegisteredCommands()) {
      const commandName = command.invocationName
      const dshCommandName = availableName(
        commandName,
        candidate => capabilityCtx.commands.find(agent, candidate) !== undefined,
      )
      disposers.push(capabilityCtx.commands.register({
        name: dshCommandName,
        description: command.description ?? `Run Pi extension command /${commandName}`,
        input: { hint: '[arguments]' },
        async handler(invocation) {
          const commandNotices: string[] = []
          try {
            await execution.run({ signal: invocation.signal, sink: commandNotices }, () => command.handler(
                invocation.rawInput.trimStart(),
                runner.createCommandContext(),
              ))
            return {
              kind: 'success' as const,
              text: commandNotices.join('\n') || `Executed /${commandName}.`,
            }
          } catch (error) {
            return { kind: 'error' as const, text: error instanceof Error ? error.message : String(error) }
          }
        },
      }))
  }

  activeTools = new Set(registeredTools().map(item => item.definition.name))
  syncTools()

  async function emit(type: string, event: Readonly<Record<string, unknown>>): Promise<unknown[]> {
    if (type === 'before_agent_start') {
      const result = await runner.emitBeforeAgentStart(
        String(event.prompt ?? ''),
        event.images as never,
        String(event.systemPrompt ?? ''),
        { cwd },
      )
      if (
        event.signal instanceof AbortSignal
        && result !== undefined
        && Object.prototype.hasOwnProperty.call(result, 'systemPrompt')
      ) {
        promptOverrides.set(event.signal, result.systemPrompt ?? '')
      }
      return result === undefined ? [] : [result]
    }
    if (type === 'input') {
      const result = await runner.emitInput(
        String(event.text ?? ''),
        event.images as never,
        event.source as never,
        event.streamingBehavior as never,
      )
      return [result]
    }
    if (type === 'message_end') {
      const result = await runner.emitMessageEnd(event as never)
      return result === undefined ? [] : [result]
    }
    const result = await runner.emit(event as never)
    return result === undefined ? [] : [result]
  }
  let eventTail = Promise.resolve()
  const dispatch = (type: string, event: Readonly<Record<string, unknown>>): Promise<unknown[]> => {
    const task = eventTail.then(() => execution.run({
      sink: notices,
      ...event.signal instanceof AbortSignal ? { signal: event.signal } : {},
      ...typeof event.systemPrompt === 'string' ? { systemPrompt: event.systemPrompt } : {},
    }, () => emit(type, event)))
    eventTail = task.then(() => undefined, () => undefined)
    return task
  }

  return {
    dispatch,
    async dispose() {
      await dispatch('session_shutdown', { type: 'session_shutdown' })
      runner.invalidate(`${pluginName} was disabled or unloaded from DSH`)
      for (const dispose of [...toolDisposers.values()].reverse()) dispose()
      toolDisposers.clear()
      for (const dispose of disposers.reverse()) await dispose()
    },
  }
}

export const name = 'plugin-bridge-pi-extension-host'
export const inject = ['agents']

export function apply(ctx: Context, config: PiExtensionHostConfig): void {
  const agents = ctx.agents
  interface AgentMount {
    readonly ready: Promise<MountedPiExtension>
    dispose(): Promise<void>
  }
  const mounted = new Map<Agent, AgentMount>()
  const activeMessages = new Set<Agent>()
  const ensure = (agent: Agent): Promise<MountedPiExtension> => {
    const current = mounted.get(agent)
    if (current !== undefined) return current.ready
    let resolveReady!: (runtime: MountedPiExtension) => void
    let rejectReady!: (error: unknown) => void
    const ready = new Promise<MountedPiExtension>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    let disposed = false
    const fiber = agent.ctx.inject(['commands', 'tools'], async capabilityCtx => {
      let runtime: MountedPiExtension | undefined
      try {
        runtime = await mountPiExtensionForAgent(capabilityCtx, agent, config)
        if (disposed) {
          await runtime.dispose()
          throw new Error(`${config.pluginName}: Agent was disposed while its Pi extension was loading`)
        }
        await runtime.dispatch('session_start', { type: 'session_start', source: 'dsh' })
        resolveReady(runtime)
        return () => runtime?.dispose()
      } catch (error: unknown) {
        rejectReady(error)
        throw error
      }
    })
    const created: AgentMount = {
      ready,
      async dispose() {
        if (disposed) return
        disposed = true
        rejectReady(new Error(`${config.pluginName}: Agent was disposed before its Pi extension became ready`))
        await fiber.dispose()
      },
    }
    mounted.set(agent, created)
    return ready
  }
  const dispatch = (agent: Agent, type: string, event: Record<string, unknown>): void => {
    void ensure(agent).then(runtime => runtime.dispatch(type, event)).catch(error => {
      ctx.logger.warn(`${config.pluginName}: Pi ${type} hook failed: ${String(error)}`)
    })
  }

  const prepare = (agent: Agent): void => {
    void ensure(agent).catch(error => {
      ctx.logger.warn(`${config.pluginName}: Pi extension failed to mount: ${String(error)}`)
    })
  }
  for (const agent of agents.list()) prepare(agent)
  ctx.on('agent/created', ({ agent }) => { prepare(agent) })
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const runtime = await ensure(agent)
    const systemPrompt = await renderPiSystemPrompt(agent, signal)
    const prompt = messages.flatMap(message => message.content)
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const results = await runtime.dispatch('before_agent_start', {
      type: 'before_agent_start',
      prompt,
      images: undefined,
      systemPrompt,
      signal,
    })
    const additions = results.flatMap(result => {
      if (typeof result !== 'object' || result === null) return []
      const extensionMessages = (result as { messages?: unknown }).messages
      if (!Array.isArray(extensionMessages)) return []
      return extensionMessages.map(message => createUserMessage({
        content: textFromInput(
          typeof message === 'object' && message !== null && 'content' in message
            ? (message as { content: unknown }).content
            : message,
        ),
        source: { kind: 'plugin', plugin: `pi:${config.pluginName}` },
      }))
    })
    if (signal.aborted) return { kind: 'reject' }
    return { kind: 'enter', messages: [...decision.messages, ...additions] }
  })
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    dispatch(agent, 'input', {
      type: 'input',
      text: messageText(message),
      images: undefined,
      source: 'interactive',
    })
  })
  ctx.on('agent/status', ({ agent, status: agentStatus }) => {
    if (agentStatus === 'idle') dispatch(agent, 'agent_settled', { type: 'agent_settled', messages: [] })
  })
  ctx.on('agent/disposed', ({ agent }) => {
    const runtime = mounted.get(agent)
    mounted.delete(agent)
    if (runtime !== undefined) void runtime.dispose()
  })
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.agent !== undefined) {
      dispatch(exec.agent, 'tool_execution_start', {
        type: 'tool_execution_start',
        toolCallId: String(exec.callId),
        toolName: exec.name,
        args: exec.arguments,
      })
    }
    return next()
  })
  ctx.on('tools/result', (exec, result) => {
    if (exec.agent !== undefined) {
      dispatch(exec.agent, 'tool_execution_end', {
        type: 'tool_execution_end',
        toolCallId: String(exec.callId),
        toolName: exec.name,
        result,
        isError: result.isError,
      })
    }
  })
  ctx.on('session/event', (session, event) => {
    const agent = agents.list().find(candidate => candidate.session === session)
    if (agent === undefined) return
    if (event.type === 'turn/start') dispatch(agent, 'agent_start', { type: 'agent_start' })
    if (event.type === 'assistant/chunk') {
      if (!activeMessages.has(agent)) {
        activeMessages.add(agent)
        dispatch(agent, 'message_start', { type: 'message_start', message: undefined })
      }
      dispatch(agent, 'message_update', {
        type: 'message_update',
        message: undefined,
        assistantMessageEvent: event.data.chunk,
      })
    }
    if (event.type === 'assistant/message') {
      if (!activeMessages.has(agent)) {
        activeMessages.add(agent)
        dispatch(agent, 'message_start', { type: 'message_start', message: event.data.message })
      }
      dispatch(agent, 'message_update', { type: 'message_update', message: event.data.message })
      dispatch(agent, 'message_end', { type: 'message_end', message: event.data.message })
      activeMessages.delete(agent)
    }
    if (event.type === 'turn/end') {
      dispatch(agent, 'agent_end', { type: 'agent_end', messages: session.deriveMessages() })
    }
  })
  ctx.effect(() => () => {
    for (const runtime of mounted.values()) void runtime.dispose()
    mounted.clear()
  }, 'pi-extension-host')
}
export function piUiModeForAgent(agent: Agent): 'tui' | 'rpc' {
  const mode = (agent.options as Agent['options'] & { interactionMode?: unknown }).interactionMode
  if (mode === 'rpc') return 'rpc'
  if (mode === 'interactive') return 'tui'
  throw new Error(`Pi extension Agent ${String(agent.id ?? 'unknown')} does not declare an interaction mode`)
}
