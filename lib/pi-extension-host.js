import { assembleContextFor, installModelSelection } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import { createEventBus, createExtensionRuntime, ExtensionRunner, } from '@earendil-works/pi-coding-agent';
import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { boundedName } from './adapters/utils.js';
import { resolvePiExtensionFiles } from './pi-extension-files.js';
export async function renderPiSystemPrompt(agent, signal) {
    return renderPrompt(await agent.ctx.systemPrompt.assemble(assembleContextFor(agent, signal)));
}
function nonEmpty(value, name) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`pi-extension-host: ${name} must be a non-empty string`);
    }
    return value;
}
function configEntries(value) {
    if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== 'string')) {
        throw new TypeError('pi-extension-host: entries must be a non-empty string array');
    }
    return value;
}
function json(value) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined)
        return null;
    return JSON.parse(encoded);
}
const JSON_SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
/** Project TypeBox's wider vocabulary onto the JSON Schema subset DSH enforces. */
function dshParameterSchema(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return {};
    const source = value;
    const schema = {};
    if (typeof source.type === 'string' && JSON_SCHEMA_TYPES.has(source.type))
        schema.type = source.type;
    if (Array.isArray(source.type)) {
        const branches = source.type
            .filter((type) => typeof type === 'string' && JSON_SCHEMA_TYPES.has(type))
            .map(type => ({ type }));
        if (branches.length > 0)
            schema.oneOf = branches;
    }
    if (typeof source.properties === 'object' && source.properties !== null && !Array.isArray(source.properties)) {
        schema.properties = Object.fromEntries(Object.entries(source.properties)
            .map(([name, child]) => [name, dshParameterSchema(child)]));
    }
    if (Array.isArray(source.required) && source.required.every(item => typeof item === 'string')) {
        schema.required = [...source.required];
    }
    if (typeof source.additionalProperties === 'boolean')
        schema.additionalProperties = source.additionalProperties;
    if (source.items !== undefined)
        schema.items = dshParameterSchema(source.items);
    const alternatives = Array.isArray(source.oneOf) ? source.oneOf : source.anyOf;
    if (Array.isArray(alternatives) && alternatives.length >= 2) {
        schema.oneOf = alternatives.map(dshParameterSchema);
    }
    if (Array.isArray(source.enum))
        schema.enum = source.enum.map(json);
    if (source.const !== undefined)
        schema.const = json(source.const);
    if (typeof source.description === 'string')
        schema.description = source.description;
    if (typeof source.title === 'string')
        schema.title = source.title;
    if (source.default !== undefined)
        schema.default = json(source.default);
    if (source.examples !== undefined)
        schema.examples = json(source.examples);
    return schema;
}
function canonicalToolResult(value) {
    const record = typeof value === 'object' && value !== null
        ? value
        : {};
    const content = Array.isArray(record.content) ? record.content.map(json) : [];
    return {
        content,
        ...record.details === undefined ? {} : { details: json(record.details) },
    };
}
function dshContent(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [{ type: 'text', text: String(value) }];
    }
    const content = value;
    if (content.type === 'text' && typeof content.text === 'string') {
        return [{ type: 'text', text: content.text }];
    }
    if (content.type === 'image'
        && typeof content.data === 'string'
        && typeof content.mimeType === 'string') {
        return [{ type: 'text', text: `[Pi image: ${content.mimeType}]` }];
    }
    return [{ type: 'text', text: JSON.stringify(value) }];
}
function renderPiResult(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return dshContent(value);
    }
    const content = value.content;
    return Array.isArray(content) ? content.flatMap(dshContent) : dshContent(value);
}
function textFromInput(content) {
    if (typeof content === 'string')
        return [{ type: 'text', text: content }];
    if (!Array.isArray(content))
        return [{ type: 'text', text: String(content) }];
    return content.flatMap(item => dshContent(json(item)));
}
function messageText(message) {
    if (typeof message.content === 'string')
        return message.content;
    if (!Array.isArray(message.content))
        return '';
    return message.content
        .filter((block) => (typeof block === 'object' && block !== null
        && block.type === 'text'
        && typeof block.text === 'string'))
        .map(block => block.text)
        .join('\n');
}
function relativePath(root, file) {
    return relative(root, file).split(sep).join('/');
}
async function piLoader() {
    const packageEntry = import.meta.resolve('@earendil-works/pi-coding-agent');
    const loaderUrl = new URL('./core/extensions/loader.js', packageEntry);
    return import(loaderUrl.href);
}
function questionService(ctx) {
    return ctx.get('userQuestions');
}
function modelFor(agent, selection) {
    const selected = selection.current ?? {
        provider: agent.options.provider ?? 'unknown',
        model: agent.options.model ?? 'unknown',
    };
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
    };
}
/** Load one copied Pi package into the exact DSH agent scope that consumes it. */
export async function mountPiExtensionForAgent(ctx, agent, rawConfig) {
    const pluginName = nonEmpty(rawConfig.pluginName, 'pluginName');
    const commandNamespace = boundedName(pluginName, 40);
    const pluginRoot = realpathSync(nonEmpty(rawConfig.pluginRoot, 'pluginRoot'));
    const entries = configEntries(rawConfig.entries);
    const files = resolvePiExtensionFiles(pluginRoot, entries);
    if (files.length === 0)
        throw new Error(`${pluginName}: no loadable Pi extension entrypoints`);
    const cwd = agent.session.header.cwd ?? process.cwd();
    const capabilityCtx = ctx;
    const runtime = createExtensionRuntime();
    const bus = createEventBus();
    const loader = await piLoader();
    const loaded = await loader.loadExtensions(files, cwd, bus, runtime);
    if (loaded.errors.length > 0) {
        throw new Error(loaded.errors.map(error => `${relativePath(pluginRoot, error.path)}: ${error.error}`).join('\n'));
    }
    const disposers = [];
    const notices = [];
    const customEntries = [];
    const status = new Map();
    const toolNames = new Map();
    const requestConfig = agent.session.requestHeader()?.config;
    const selection = {
        current: {
            provider: requestConfig?.provider ?? agent.options.provider ?? 'unknown',
            model: requestConfig?.model ?? agent.options.model ?? 'unknown',
            ...requestConfig?.reasoningEffort === undefined ? {} : { reasoningEffort: requestConfig.reasoningEffort },
        },
        assembled: undefined,
    };
    disposers.push(installModelSelection(agent.ctx, selection));
    let thinkingLevel = requestConfig?.reasoningEffort ?? 'off';
    let sessionName;
    let activeTools = new Set();
    const toolDisposers = new Map();
    const execution = new AsyncLocalStorage();
    const promptOverrides = new WeakMap();
    let effectiveSystemPrompt = '';
    const disposePromptAssembly = capabilityCtx.on('system-prompt/assemble', async (assembly, context, next) => {
        const assembled = await next();
        if (context.signal === undefined || !promptOverrides.has(context.signal))
            return assembled;
        const override = promptOverrides.get(context.signal);
        effectiveSystemPrompt = override;
        return {
            ...assembled,
            sections: [{ name: `pi:${pluginName}`, text: override }],
        };
    });
    disposers.push(() => { disposePromptAssembly(); });
    function availableName(foreignName, occupied) {
        if (!occupied(foreignName))
            return foreignName;
        for (let suffix = 1;; suffix += 1) {
            const candidate = boundedName(`pi-${commandNamespace}-${foreignName}${suffix === 1 ? '' : `-${suffix}`}`, 64);
            if (!occupied(candidate))
                return candidate;
        }
    }
    const theme = new Proxy({}, {
        get: () => (...args) => String(args.at(-1) ?? ''),
    });
    async function ask(prompt, options) {
        const service = questionService(agent.ctx);
        if (service === undefined)
            throw new Error('Pi extension UI requires a DSH user-questions provider');
        const answer = await service.ask({
            questions: [{
                    id: 'pi-extension-answer',
                    question: prompt,
                    ...options === undefined ? {} : { options: options.map(label => ({ label })) },
                }],
            agent,
            signal: execution.getStore()?.signal,
        });
        return answer.answers[0] ?? { selected: [] };
    }
    const sessionEntries = () => [
        ...agent.session.events.map(event => ({ ...event, id: `dsh-${event.seq}` })),
        ...customEntries,
    ];
    const sessionManager = {
        getCwd: () => cwd,
        getSessionDir: () => rawConfig.pluginData ?? pluginRoot,
        getSessionId: () => String(agent.id),
        getSessionFile: () => undefined,
        getLeafId: () => sessionEntries().at(-1)?.id ?? null,
        getLeafEntry: () => sessionEntries().at(-1),
        getEntry: (id) => sessionEntries().find(entry => entry.id === id),
        getLabel: () => undefined,
        getBranch: () => sessionEntries(),
        buildContextEntries: () => sessionEntries(),
        getHeader: () => null,
        getEntries: () => sessionEntries(),
        getTree: () => [],
        getSessionName: () => sessionName,
    };
    const modelRegistry = {
        getAvailable: () => [modelFor(agent, selection)],
        find: (provider, modelId) => {
            const model = modelFor(agent, selection);
            return model.provider === provider && model.id === modelId ? model : undefined;
        },
        refresh: async () => undefined,
        isUsingOAuth: () => false,
        registerProvider: () => {
            throw new Error('pi-extension-host: Pi provider registration has no exact DSH mapping');
        },
        unregisterProvider: () => {
            throw new Error('pi-extension-host: Pi provider unregistration has no exact DSH mapping');
        },
    };
    const ui = {
        async select(title, options) {
            const answer = await ask(title, options);
            return answer.selected[0];
        },
        async confirm(title, message) {
            const answer = await ask(`${title}\n\n${message}`, ['Yes', 'No']);
            return answer.selected.includes('Yes');
        },
        async input(title, placeholder) {
            const answer = await ask(placeholder === undefined ? title : `${title}\n${placeholder}`, undefined);
            return answer.custom ?? answer.selected[0];
        },
        async editor(title, prefill) {
            const answer = await ask(prefill === undefined ? title : `${title}\n${prefill}`, undefined);
            return answer.custom ?? answer.selected[0];
        },
        notify(message) { (execution.getStore()?.sink ?? notices).push(message); },
        setStatus(key, value) {
            if (value === undefined)
                status.delete(key);
            else
                status.set(key, value);
        },
        onTerminalInput: () => () => undefined,
        setWorkingMessage() { },
        setWorkingVisible() { },
        setWorkingIndicator() { },
        setHiddenThinkingLabel() { },
        setWidget() { },
        setFooter() { },
        setHeader() { },
        setTitle() { },
        custom: async () => {
            throw new Error('pi-extension-host: custom Pi TUI components are not supported by the DSH host');
        },
        pasteToEditor() { },
        setEditorText() { },
        getEditorText: () => '',
        addAutocompleteProvider() { },
        setEditorComponent() { },
        getEditorComponent: () => undefined,
        get theme() { return theme; },
        getAllThemes: () => [],
        getTheme: () => undefined,
        setTheme: () => ({ success: false, error: 'Pi themes are owned by the DSH host' }),
        getToolsExpanded: () => false,
        setToolsExpanded() { },
    };
    const runner = new ExtensionRunner(loaded.extensions, runtime, cwd, sessionManager, modelRegistry);
    runner.setUIContext(ui, 'tui');
    runner.onError(error => {
        ctx.logger.warn(`${pluginName}: Pi ${error.event} hook failed in ${relativePath(pluginRoot, error.extensionPath)}: ${error.error}`);
    });
    function registeredTools() {
        return runner.getAllRegisteredTools();
    }
    function syncTools() {
        for (const { definition } of registeredTools()) {
            const enabled = activeTools.has(definition.name);
            const dispose = toolDisposers.get(definition.name);
            if (!enabled && dispose !== undefined) {
                dispose();
                toolDisposers.delete(definition.name);
            }
            else if (enabled && dispose === undefined) {
                const dshName = toolNames.get(definition.name) ?? availableName(definition.name, candidate => candidate === 'run_code' || capabilityCtx.tools.get(candidate, agent) !== undefined);
                toolNames.set(definition.name, dshName);
                const dshTool = {
                    name: dshName,
                    description: definition.description,
                    parameters: dshParameterSchema(definition.parameters),
                    output: {
                        schema: {},
                        render: (_args, value) => renderPiResult(value),
                    },
                    ...definition.executionMode === 'parallel' ? { isConcurrencySafe: () => true } : {},
                    async execute(args, exec) {
                        const value = definition.prepareArguments?.(args) ?? args;
                        const result = await execution.run({ signal: exec.signal, sink: notices }, () => definition.execute(String(exec.callId), value, exec.signal, partial => void runner.emit({
                            type: 'tool_execution_update',
                            toolCallId: String(exec.callId),
                            toolName: definition.name,
                            args,
                            partialResult: partial,
                        }), runner.createContext()));
                        return canonicalToolResult(result);
                    },
                };
                toolDisposers.set(definition.name, capabilityCtx.tools.register(dshTool));
            }
        }
    }
    const extensionActions = {
        sendUserMessage(content, options) {
            const message = createUserMessage({ content: textFromInput(content), source: { kind: 'user' } });
            if (options?.deliverAs === 'followUp')
                agent.followup(message);
            else
                agent.steer(message);
        },
        sendMessage(message, options) {
            const userMessage = createUserMessage({ content: textFromInput(message.content), source: { kind: 'user' } });
            if (options?.deliverAs === 'followUp' || options?.deliverAs === 'nextTurn')
                agent.followup(userMessage);
            else if (options?.triggerTurn === false)
                agent.inject(userMessage);
            else
                agent.steer(userMessage);
        },
        appendEntry(customType, data) {
            customEntries.push({ type: 'custom', customType, data, id: `dsh-pi-${customEntries.length + 1}` });
        },
        setSessionName(value) { sessionName = value; },
        getSessionName: () => sessionName,
        setLabel() { },
        getActiveTools: () => [...activeTools].sort(),
        getAllTools: () => registeredTools().map(({ definition, sourceInfo }) => ({
            name: definition.name,
            description: definition.description,
            parameters: definition.parameters,
            promptGuidelines: definition.promptGuidelines,
            sourceInfo,
        })),
        setActiveTools(toolNameList) {
            activeTools = new Set(toolNameList);
            syncTools();
        },
        refreshTools: syncTools,
        getCommands: () => runner.getRegisteredCommands().map(command => ({
            name: command.invocationName,
            description: command.description,
            source: 'extension',
            sourceInfo: command.sourceInfo,
        })),
        async setModel(model) {
            const previousModel = modelFor(agent, selection);
            const reasoningEffort = selection.current?.reasoningEffort;
            selection.current = {
                provider: model.provider,
                model: model.id,
                ...reasoningEffort === undefined ? {} : { reasoningEffort },
            };
            await runner.emit({ type: 'model_select', model, previousModel, source: 'set' });
            return true;
        },
        getThinkingLevel: () => thinkingLevel,
        setThinkingLevel(level) {
            const previousLevel = thinkingLevel;
            thinkingLevel = level;
            const selected = selection.current ?? {
                provider: agent.options.provider ?? 'unknown',
                model: agent.options.model ?? 'unknown',
            };
            selection.current = {
                provider: selected.provider,
                model: selected.model,
                ...level === 'off' ? {} : { reasoningEffort: level },
            };
            void runner.emit({ type: 'thinking_level_select', level, previousLevel });
        },
    };
    const contextActions = {
        getModel: () => modelFor(agent, selection),
        getScopedModels: () => [],
        isIdle: () => agent.status === 'idle',
        isProjectTrusted: () => true,
        getSignal: () => execution.getStore()?.signal,
        abort: () => agent.cancel({ kind: 'user' }),
        hasPendingMessages: () => agent.inbox.hasPending,
        shutdown: () => agent.cancel({ kind: 'user' }),
        getContextUsage: () => undefined,
        compact(options) {
            const compaction = ctx.get('compaction');
            if (compaction === undefined) {
                options?.onError?.(new Error('DSH compaction service is unavailable'));
                return;
            }
            void compaction.compactNow(agent, execution.getStore()?.signal ?? new AbortController().signal)
                .then(result => { options?.onComplete?.(result); })
                .catch(error => { options?.onError?.(error instanceof Error ? error : new Error(String(error))); });
        },
        getSystemPrompt: () => execution.getStore()?.systemPrompt ?? effectiveSystemPrompt,
        getSystemPromptOptions: () => ({ cwd }),
    };
    const unsupportedSessionOperation = async (operation) => {
        throw new Error(`pi-extension-host: Pi ${operation} has no exact DSH mapping`);
    };
    const commandContextActions = {
        waitForIdle: () => agent.whenIdle(),
        newSession: () => unsupportedSessionOperation('newSession'),
        fork: () => unsupportedSessionOperation('fork'),
        navigateTree: () => unsupportedSessionOperation('navigateTree'),
        switchSession: () => unsupportedSessionOperation('switchSession'),
        reload: async () => {
            throw new Error('pi-extension-host: Pi reload has no exact DSH mapping');
        },
    };
    runner.bindCore(extensionActions, contextActions);
    runner.bindCommandContext(commandContextActions);
    for (const command of runner.getRegisteredCommands()) {
        const commandName = command.invocationName;
        const dshCommandName = availableName(commandName, candidate => capabilityCtx.commands.find(agent, candidate) !== undefined);
        disposers.push(capabilityCtx.commands.register({
            name: dshCommandName,
            description: command.description ?? `Run Pi extension command /${commandName}`,
            input: { hint: '[arguments]' },
            async handler(invocation) {
                const commandNotices = [];
                try {
                    await execution.run({ signal: invocation.signal, sink: commandNotices }, () => command.handler(invocation.rawInput.trimStart(), runner.createCommandContext()));
                    return {
                        kind: 'success',
                        text: commandNotices.join('\n') || `Executed /${commandName}.`,
                    };
                }
                catch (error) {
                    return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
                }
            },
        }));
    }
    activeTools = new Set(registeredTools().map(item => item.definition.name));
    syncTools();
    async function emit(type, event) {
        if (type === 'before_agent_start') {
            const result = await runner.emitBeforeAgentStart(String(event.prompt ?? ''), event.images, String(event.systemPrompt ?? ''), { cwd });
            if (event.signal instanceof AbortSignal
                && result !== undefined
                && Object.prototype.hasOwnProperty.call(result, 'systemPrompt')) {
                promptOverrides.set(event.signal, result.systemPrompt ?? '');
            }
            return result === undefined ? [] : [result];
        }
        if (type === 'input') {
            const result = await runner.emitInput(String(event.text ?? ''), event.images, event.source, event.streamingBehavior);
            return [result];
        }
        if (type === 'message_end') {
            const result = await runner.emitMessageEnd(event);
            return result === undefined ? [] : [result];
        }
        const result = await runner.emit(event);
        return result === undefined ? [] : [result];
    }
    let eventTail = Promise.resolve();
    const dispatch = (type, event) => {
        const task = eventTail.then(() => execution.run({
            sink: notices,
            ...event.signal instanceof AbortSignal ? { signal: event.signal } : {},
            ...typeof event.systemPrompt === 'string' ? { systemPrompt: event.systemPrompt } : {},
        }, () => emit(type, event)));
        eventTail = task.then(() => undefined, () => undefined);
        return task;
    };
    return {
        dispatch,
        async dispose() {
            await dispatch('session_shutdown', { type: 'session_shutdown' });
            runner.invalidate(`${pluginName} was disabled or unloaded from DSH`);
            for (const dispose of [...toolDisposers.values()].reverse())
                dispose();
            toolDisposers.clear();
            for (const dispose of disposers.reverse())
                await dispose();
        },
    };
}
export const name = 'plugin-bridge-pi-extension-host';
export const inject = ['agents'];
export function apply(ctx, config) {
    const agents = ctx.agents;
    const mounted = new Map();
    const activeMessages = new Set();
    const ensure = (agent) => {
        const current = mounted.get(agent);
        if (current !== undefined)
            return current.ready;
        let resolveReady;
        let rejectReady;
        const ready = new Promise((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        let disposed = false;
        const fiber = agent.ctx.inject(['commands', 'tools'], async (capabilityCtx) => {
            let runtime;
            try {
                runtime = await mountPiExtensionForAgent(capabilityCtx, agent, config);
                if (disposed) {
                    await runtime.dispose();
                    throw new Error(`${config.pluginName}: Agent was disposed while its Pi extension was loading`);
                }
                await runtime.dispatch('session_start', { type: 'session_start', source: 'dsh' });
                resolveReady(runtime);
                return () => runtime?.dispose();
            }
            catch (error) {
                rejectReady(error);
                throw error;
            }
        });
        const created = {
            ready,
            async dispose() {
                if (disposed)
                    return;
                disposed = true;
                rejectReady(new Error(`${config.pluginName}: Agent was disposed before its Pi extension became ready`));
                await fiber.dispose();
            },
        };
        mounted.set(agent, created);
        return ready;
    };
    const dispatch = (agent, type, event) => {
        void ensure(agent).then(runtime => runtime.dispatch(type, event)).catch(error => {
            ctx.logger.warn(`${config.pluginName}: Pi ${type} hook failed: ${String(error)}`);
        });
    };
    const prepare = (agent) => {
        void ensure(agent).catch(error => {
            ctx.logger.warn(`${config.pluginName}: Pi extension failed to mount: ${String(error)}`);
        });
    };
    for (const agent of agents.list())
        prepare(agent);
    ctx.on('agent/created', ({ agent }) => { prepare(agent); });
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
        const decision = await next();
        if (decision.kind === 'reject')
            return decision;
        const runtime = await ensure(agent);
        const systemPrompt = await renderPiSystemPrompt(agent, signal);
        const prompt = messages.flatMap(message => message.content)
            .filter((block) => block.type === 'text')
            .map(block => block.text)
            .join('\n');
        const results = await runtime.dispatch('before_agent_start', {
            type: 'before_agent_start',
            prompt,
            images: undefined,
            systemPrompt,
            signal,
        });
        const additions = results.flatMap(result => {
            if (typeof result !== 'object' || result === null)
                return [];
            const extensionMessages = result.messages;
            if (!Array.isArray(extensionMessages))
                return [];
            return extensionMessages.map(message => createUserMessage({
                content: textFromInput(typeof message === 'object' && message !== null && 'content' in message
                    ? message.content
                    : message),
                source: { kind: 'plugin', plugin: `pi:${config.pluginName}` },
            }));
        });
        if (signal.aborted)
            return { kind: 'reject' };
        return { kind: 'enter', messages: [...decision.messages, ...additions] };
    });
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
        dispatch(agent, 'input', {
            type: 'input',
            text: messageText(message),
            images: undefined,
            source: 'interactive',
        });
    });
    ctx.on('agent/status', ({ agent, status: agentStatus }) => {
        if (agentStatus === 'idle')
            dispatch(agent, 'agent_settled', { type: 'agent_settled', messages: [] });
    });
    ctx.on('agent/disposed', ({ agent }) => {
        const runtime = mounted.get(agent);
        mounted.delete(agent);
        if (runtime !== undefined)
            void runtime.dispose();
    });
    ctx.on('tools/execute', async (exec, next) => {
        if (exec.agent !== undefined) {
            dispatch(exec.agent, 'tool_execution_start', {
                type: 'tool_execution_start',
                toolCallId: String(exec.callId),
                toolName: exec.name,
                args: exec.arguments,
            });
        }
        return next();
    });
    ctx.on('tools/result', (exec, result) => {
        if (exec.agent !== undefined) {
            dispatch(exec.agent, 'tool_execution_end', {
                type: 'tool_execution_end',
                toolCallId: String(exec.callId),
                toolName: exec.name,
                result,
                isError: result.isError,
            });
        }
    });
    ctx.on('session/event', (session, event) => {
        const agent = agents.list().find(candidate => candidate.session === session);
        if (agent === undefined)
            return;
        if (event.type === 'turn/start')
            dispatch(agent, 'agent_start', { type: 'agent_start' });
        if (event.type === 'assistant/chunk') {
            if (!activeMessages.has(agent)) {
                activeMessages.add(agent);
                dispatch(agent, 'message_start', { type: 'message_start', message: undefined });
            }
            dispatch(agent, 'message_update', {
                type: 'message_update',
                message: undefined,
                assistantMessageEvent: event.data.chunk,
            });
        }
        if (event.type === 'assistant/message') {
            if (!activeMessages.has(agent)) {
                activeMessages.add(agent);
                dispatch(agent, 'message_start', { type: 'message_start', message: event.data.message });
            }
            dispatch(agent, 'message_update', { type: 'message_update', message: event.data.message });
            dispatch(agent, 'message_end', { type: 'message_end', message: event.data.message });
            activeMessages.delete(agent);
        }
        if (event.type === 'turn/end') {
            dispatch(agent, 'agent_end', { type: 'agent_end', messages: session.deriveMessages() });
        }
    });
    ctx.effect(() => () => {
        for (const runtime of mounted.values())
            void runtime.dispose();
        mounted.clear();
    }, 'pi-extension-host');
}
//# sourceMappingURL=pi-extension-host.js.map