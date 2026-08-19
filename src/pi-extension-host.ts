import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ToolDefinition as DshToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  createEventBus,
  createExtensionRuntime,
  type Extension,
  type ExtensionContext,
  type ExtensionRuntime,
  type LoadExtensionsResult,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
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

  const capabilityScope = createScope(ctx, agent)
  const capabilityCtx = capabilityScope.ctx

  const runtime = createExtensionRuntime()
  const bus = createEventBus()
  const loader = await piLoader()
  const loaded = await loader.loadExtensions(files, pluginRoot, bus, runtime)
  if (loaded.errors.length > 0) {
    throw new Error(loaded.errors.map(error => `${relativePath(pluginRoot, error.path)}: ${error.error}`).join('\n'))
  }

  const extensions = loaded.extensions
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
    signal?: AbortSignal,
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
      signal,
    })
    return answer.answers[0] ?? { selected: [] }
  }

  function extensionContext(signal?: AbortSignal, sink = notices): ExtensionContext {
    const model = modelFor(agent, selection)
    const sessionEntries = [
      ...agent.session.events.map(event => ({ ...event, id: `dsh-${event.seq}` })),
      ...customEntries,
    ]
    return {
      mode: 'tui',
      hasUI: questionService(agent.ctx) !== undefined,
      cwd: agent.session.header.cwd ?? process.cwd(),
      sessionManager: {
        getEntries: () => sessionEntries,
        getSessionName: () => sessionName,
      } as never,
      modelRegistry: {
        getAvailable: () => [model],
        refresh: async () => undefined,
        isUsingOAuth: () => false,
      } as never,
      model: model as never,
      scopedModels: [],
      thinkingLevel: thinkingLevel as never,
      isIdle: () => agent.status === 'idle',
      isProjectTrusted: () => true,
      signal,
      abort: () => agent.cancel({ kind: 'user' }),
      hasPendingMessages: () => agent.inbox.hasPending,
      shutdown: () => agent.cancel({ kind: 'user' }),
      getContextUsage: () => undefined,
      compact: options => {
        const compaction = ctx.get('compaction' as never) as {
          compactNow(target: Agent, operationSignal: AbortSignal): Promise<unknown>
        } | undefined
        if (compaction === undefined) {
          options?.onError?.(new Error('DSH compaction service is unavailable'))
          return
        }
        void compaction.compactNow(agent, signal ?? new AbortController().signal)
          .then(result => { options?.onComplete?.(result as never) })
          .catch(error => { options?.onError?.(error instanceof Error ? error : new Error(String(error))) })
      },
      getSystemPrompt: () => '',
      ui: {
        notify(message: string) { sink.push(message) },
        setStatus(key: string, value: string | undefined) {
          if (value === undefined) status.delete(key)
          else status.set(key, value)
        },
        setWidget() {},
        setWorkingMessage() {},
        setTitle() {},
        setEditorText() {},
        getEditorText: () => '',
        theme,
        async confirm(title: string, message: string) {
          const answer = await ask(`${title}\n\n${message}`, ['Yes', 'No'], signal)
          return answer.selected.includes('Yes')
        },
        async input(title: string, placeholder?: string) {
          const answer = await ask(placeholder === undefined ? title : `${title}\n${placeholder}`, undefined, signal)
          return answer.custom ?? answer.selected[0]
        },
        async editor(title: string, prefill?: string) {
          const answer = await ask(prefill === undefined ? title : `${title}\n${prefill}`, undefined, signal)
          return answer.custom ?? answer.selected[0]
        },
        async select(title: string, choices: Array<string | { value: string; label: string }>) {
          const labels = choices.map(choice => typeof choice === 'string' ? choice : choice.label)
          const answer = await ask(title, labels, signal)
          const selected = answer.selected[0]
          const choice = choices.find(item => (typeof item === 'string' ? item : item.label) === selected)
          return typeof choice === 'string' ? choice : choice?.value
        },
        onTerminalInput() { return () => undefined },
        get themeColor() { return undefined },
      } as never,
    }
  }

  async function dispatch(type: string, event: Readonly<Record<string, unknown>>): Promise<unknown[]> {
    const results: unknown[] = []
    for (const extension of extensions) {
      for (const handler of extension.handlers.get(type) ?? []) {
        results.push(await handler(event as never, extensionContext()))
      }
    }
    return results
  }

  function registeredTools(): Array<{ definition: PiToolDefinition; extension: Extension }> {
    const seen = new Set<string>()
    const result: Array<{ definition: PiToolDefinition; extension: Extension }> = []
    for (const extension of extensions) {
      for (const [name, registered] of extension.tools) {
        if (seen.has(name)) continue
        seen.add(name)
        result.push({ definition: registered.definition, extension })
      }
    }
    return result
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
          candidate => candidate === 'run_code' || ctx.tools.get(candidate, agent) !== undefined,
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
            const result = await definition.execute(
              String(exec.callId),
              value as never,
              exec.signal,
              partial => void dispatch('tool_execution_update', {
                type: 'tool_execution_update',
                toolCallId: String(exec.callId),
                toolName: definition.name,
                args,
                partialResult: partial,
              }),
              extensionContext(exec.signal),
            )
            return canonicalToolResult(result)
          },
        }
        toolDisposers.set(definition.name, capabilityCtx.tools.register(dshTool))
      }
    }
  }

  for (const extension of extensions) {
    for (const [commandName, command] of extension.commands) {
      const dshCommandName = availableName(
        commandName,
        candidate => ctx.commands.find(agent, candidate) !== undefined,
      )
      disposers.push(capabilityCtx.commands.register({
        name: dshCommandName,
        description: command.description ?? `Run Pi extension command /${commandName}`,
        input: { hint: '[arguments]' },
        async handler(invocation) {
          const commandNotices: string[] = []
          try {
            await command.handler(
              invocation.rawInput.trimStart(),
              {
                ...extensionContext(invocation.signal, commandNotices),
                waitForIdle: () => agent.whenIdle(),
                getSystemPromptOptions: () => ({}),
                newSession: async () => ({ cancelled: true }),
                fork: async () => ({ cancelled: true }),
                navigateTree: async () => ({ cancelled: true }),
                switchSession: async () => ({ cancelled: true }),
                reload: async () => undefined,
              } as never,
            )
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
  }

  activeTools = new Set(registeredTools().map(item => item.definition.name))
  runtime.refreshTools = syncTools
  runtime.getActiveTools = () => [...activeTools].sort()
  runtime.getAllTools = () => registeredTools().map(({ definition, extension }) => ({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    promptGuidelines: definition.promptGuidelines,
    sourceInfo: extension.sourceInfo,
  })) as never
  runtime.setActiveTools = toolNames => {
    activeTools = new Set(toolNames)
    syncTools()
  }
  runtime.getCommands = () => extensions.flatMap(extension => [...extension.commands.values()].map(command => ({
    name: command.name,
    description: command.description,
    source: 'extension',
    sourceInfo: command.sourceInfo,
  }))) as never
  runtime.getThinkingLevel = () => thinkingLevel as never
  runtime.setThinkingLevel = level => {
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
    void dispatch('thinking_level_select', { type: 'thinking_level_select', thinkingLevel: level })
  }
  runtime.setModel = async model => {
    const reasoningEffort = selection.current?.reasoningEffort
    selection.current = {
      provider: model.provider,
      model: model.id,
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
    }
    await dispatch('model_select', { type: 'model_select', model, source: 'extension' })
    return true
  }
  runtime.sendUserMessage = (content, options) => {
    const message = createUserMessage({ content: textFromInput(content), source: { kind: 'user' } })
    if (options?.deliverAs === 'followUp') agent.followup(message)
    else agent.steer(message)
  }
  runtime.sendMessage = (message, options) => {
    const userMessage = createUserMessage({ content: textFromInput(message.content), source: { kind: 'user' } })
    if (options?.deliverAs === 'followUp' || options?.deliverAs === 'nextTurn') agent.followup(userMessage)
    else if (options?.triggerTurn === false) agent.inject(userMessage)
    else agent.steer(userMessage)
  }
  runtime.appendEntry = (customType, data) => {
    customEntries.push({ type: 'custom', customType, data, id: `dsh-pi-${customEntries.length + 1}` })
  }
  runtime.setSessionName = value => { sessionName = value }
  runtime.getSessionName = () => sessionName
  runtime.setLabel = () => undefined
  runtime.registerProvider = () => undefined
  runtime.registerNativeProvider = () => undefined
  runtime.unregisterProvider = () => undefined
  syncTools()

  return {
    dispatch,
    async dispose() {
      await dispatch('session_shutdown', { type: 'session_shutdown' })
      runtime.invalidate(`${pluginName} was disabled or unloaded from DSH`)
      for (const dispose of [...toolDisposers.values()].reverse()) dispose()
      toolDisposers.clear()
      for (const dispose of disposers.reverse()) await dispose()
      await capabilityScope.dispose()
    },
  }
}

export const name = 'plugin-bridge-pi-extension-host'
export const inject = ['agents', 'commands', 'tools']

export function apply(ctx: Context, config: PiExtensionHostConfig): void {
  const agents = ctx.agents
  const mounted = new Map<Agent, Promise<MountedPiExtension>>()
  const activeMessages = new Set<Agent>()
  const ensure = (agent: Agent): Promise<MountedPiExtension> => {
    const current = mounted.get(agent)
    if (current !== undefined) return current
    const created = mountPiExtensionForAgent(ctx, agent, config).then(async runtime => {
      await runtime.dispatch('session_start', { type: 'session_start', source: 'dsh' })
      return runtime
    })
    mounted.set(agent, created)
    return created
  }
  const dispatch = (agent: Agent, type: string, event: Record<string, unknown>): void => {
    void ensure(agent).then(runtime => runtime.dispatch(type, event)).catch(error => {
      ctx.logger.warn(`${config.pluginName}: Pi ${type} hook failed: ${String(error)}`)
    })
  }

  for (const agent of agents.list()) void ensure(agent)
  ctx.on('agent/created', ({ agent }) => { void ensure(agent) })
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const runtime = await ensure(agent)
    const prompt = messages.flatMap(message => message.content)
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const results = await runtime.dispatch('before_agent_start', {
      type: 'before_agent_start',
      prompt,
      images: undefined,
      systemPrompt: '',
    })
    const additions = results.flatMap(result => {
      if (typeof result !== 'object' || result === null) return []
      const systemPrompt = (result as { systemPrompt?: unknown }).systemPrompt
      if (typeof systemPrompt !== 'string' || systemPrompt.length === 0) return []
      return [createUserMessage({
        content: [{ type: 'text', text: systemPrompt }],
        source: { kind: 'plugin', plugin: `pi:${config.pluginName}` },
      })]
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
    if (runtime !== undefined) void runtime.then(value => value.dispose())
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
    for (const runtime of mounted.values()) void runtime.then(value => value.dispose())
    mounted.clear()
  }, 'pi-extension-host')
}
