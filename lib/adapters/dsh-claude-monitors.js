import { StringDecoder } from 'node:string_decoder';
import { createUserMessage, CONTEXT_SUMMARY_MAX_CHARS } from '@deepseek-ai/dsh-llm';
import { isSkillName } from '@deepseek-ai/dsh-skill';
import { componentJson, insidePlugin, packageName, record, slug } from './utils.js';
const MONITOR_RUNTIME = '@openma/dsh-agents-plugins-bridge/claude-monitors';
const MONITOR_GRACE_MS = 3000;
const MONITOR_KEYS = ['name', 'command', 'description', 'when'];
function nonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${label} must be a non-empty string`);
    }
    return value;
}
function normalizeMonitor(value, index) {
    const label = `claude-code-legacy: monitors[${index}]`;
    const monitor = record(value, label);
    const unknown = Object.keys(monitor).find(key => !MONITOR_KEYS.includes(key));
    if (unknown !== undefined)
        throw new TypeError(`${label}.${unknown} is not supported`);
    const name = nonEmptyString(monitor.name, `${label}.name`);
    const command = nonEmptyString(monitor.command, `${label}.command`);
    const description = nonEmptyString(monitor.description, `${label}.description`);
    if (command.includes('${user_config.')) {
        throw new TypeError(`${label}.command uses user_config, which DSH does not expose to this runtime`);
    }
    const when = monitor.when === undefined ? 'always' : monitor.when;
    if (when === 'always')
        return { name, command, description, when };
    if (typeof when !== 'string' || !when.startsWith('on-skill-invoke:')) {
        throw new TypeError('when must be "always" or "on-skill-invoke:<skill-name>"');
    }
    const skill = when.slice('on-skill-invoke:'.length);
    if (!isSkillName(skill)) {
        throw new TypeError('when must name a DSH-compatible skill after "on-skill-invoke:"');
    }
    return { name, command, description, when: `on-skill-invoke:${skill}` };
}
function monitorMaterialization(input) {
    if (input.detected.provider !== 'claude-code-legacy') {
        throw new TypeError(`${input.detected.provider}: monitor components require the Claude Code adapter`);
    }
    const raw = componentJson(input);
    if (!Array.isArray(raw)) {
        return {
            rows: [],
            diagnostics: [`claude-code-legacy: ${input.component.path} is unsupported: monitors must be a JSON array`],
        };
    }
    const monitors = [];
    const diagnostics = [];
    const names = new Set();
    for (const [index, value] of raw.entries()) {
        try {
            const monitor = normalizeMonitor(value, index);
            if (monitor.command.includes('${CLAUDE_PLUGIN_DATA}') && input.pluginDataRoot === undefined) {
                throw new TypeError('command requires CLAUDE_PLUGIN_DATA, but this installation has no plugin data root');
            }
            if (names.has(monitor.name)) {
                throw new TypeError(`duplicate monitor name "${monitor.name}"`);
            }
            names.add(monitor.name);
            monitors.push(monitor);
        }
        catch (error) {
            let identity = `monitors[${index}]`;
            if (typeof value === 'object' && value !== null && !Array.isArray(value)
                && typeof value.name === 'string') {
                identity = `monitor "${value.name}"`;
            }
            diagnostics.push(`claude-code-legacy: ${identity} is unsupported: ${error instanceof Error ? error.message.replace(/^claude-code-legacy: monitors\[\d+\]\./u, '') : String(error)}`);
        }
    }
    if (monitors.length === 0)
        return { rows: [], ...diagnostics.length === 0 ? {} : { diagnostics } };
    const pluginName = packageName(input);
    const plugin = slug(pluginName);
    const monitorComponents = input.detected.components.filter(component => component.type === 'monitor');
    const suffix = monitorComponents.length > 1 ? `-${slug(input.component.path)}` : '';
    const rowId = `plugin-bridge-${plugin}-claude-monitors${suffix}`;
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
    };
}
/** Map verified Claude monitor events onto the DSH agent/session and subprocess seams. */
export const dshClaudeMonitorsAdapter = {
    name: 'dsh-claude-monitors',
    componentTypes: ['monitor'],
    materialize: monitorMaterialization,
};
function runtimeConfig(value) {
    const config = record(value, 'claude monitors runtime config');
    const pluginName = nonEmptyString(config.pluginName, 'claude monitors runtime config.pluginName');
    const pluginRoot = nonEmptyString(config.pluginRoot, 'claude monitors runtime config.pluginRoot');
    const pluginData = config.pluginData === undefined
        ? undefined
        : nonEmptyString(config.pluginData, 'claude monitors runtime config.pluginData');
    if (!Array.isArray(config.monitors)) {
        throw new TypeError('claude monitors runtime config.monitors must be an array');
    }
    const monitors = config.monitors.map((monitor, index) => normalizeMonitor(monitor, index));
    return { pluginName, pluginRoot, ...pluginData === undefined ? {} : { pluginData }, monitors };
}
function shellCommand(command) {
    return process.platform === 'win32'
        ? ['cmd.exe', '/d', '/s', '/c', command]
        : ['sh', '-lc', command];
}
function xmlAttribute(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
function summary(name, line) {
    const account = `${name}: ${line.replace(/\s+/gu, ' ').trim()}`;
    return account.length <= CONTEXT_SUMMARY_MAX_CHARS
        ? account
        : account.slice(0, CONTEXT_SUMMARY_MAX_CHARS);
}
function skillInvocation(event) {
    if (event.type === 'tool/call' && event.data.name === 'skill') {
        try {
            const args = JSON.parse(event.data.arguments);
            if (typeof args === 'object' && args !== null && !Array.isArray(args)
                && typeof args.name === 'string') {
                return args.name;
            }
        }
        catch {
            return undefined;
        }
    }
    if (event.type === 'user/message' && event.data.source.kind === 'skill-invocation') {
        return event.data.source.name;
    }
    return undefined;
}
class AgentMonitorRuntime {
    ctx;
    agent;
    config;
    started = new Set();
    running = new Map();
    closing = false;
    constructor(ctx, agent, config) {
        this.ctx = ctx;
        this.agent = agent;
        this.config = config;
    }
    startAlways() {
        for (const monitor of this.config.monitors) {
            if (monitor.when === 'always')
                this.start(monitor);
        }
    }
    observe(event) {
        const skill = skillInvocation(event);
        if (skill === undefined)
            return;
        for (const monitor of this.config.monitors) {
            if (monitor.when === `on-skill-invoke:${skill}`)
                this.start(monitor);
        }
    }
    start(monitor) {
        if (this.closing || this.started.has(monitor.name))
            return;
        const cwd = this.agent.session.header.cwd;
        if (cwd === undefined) {
            this.ctx.logger.warn(`claude monitor "${this.config.pluginName}/${monitor.name}" was not started: the DSH session has no cwd`);
            return;
        }
        if (monitor.command.includes('${CLAUDE_PLUGIN_DATA}') && this.config.pluginData === undefined) {
            this.ctx.logger.warn(`claude monitor "${this.config.pluginName}/${monitor.name}" was not started: CLAUDE_PLUGIN_DATA is unavailable`);
            return;
        }
        let handle;
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
            });
            if (handle.stdout === undefined) {
                handle.terminate();
                throw new Error('DSH subprocess provider did not expose piped stdout');
            }
        }
        catch (error) {
            this.ctx.logger.warn(`claude monitor "${this.config.pluginName}/${monitor.name}" failed to start: ${String(error)}`);
            return;
        }
        this.started.add(monitor.name);
        const pump = this.pump(monitor, handle);
        this.running.set(monitor.name, { handle, pump });
        void pump.finally(() => {
            if (this.running.get(monitor.name)?.handle === handle)
                this.running.delete(monitor.name);
        });
    }
    async pump(monitor, handle) {
        const stream = handle.stdout;
        if (stream === undefined)
            return;
        const decoder = new StringDecoder('utf8');
        let pending = '';
        try {
            for await (const chunk of stream) {
                pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
                let newline = pending.indexOf('\n');
                while (newline >= 0) {
                    const line = pending.slice(0, newline).replace(/\r$/u, '');
                    pending = pending.slice(newline + 1);
                    this.deliver(monitor, line);
                    newline = pending.indexOf('\n');
                }
            }
            pending += decoder.end();
            if (pending.length > 0)
                this.deliver(monitor, pending.replace(/\r$/u, ''));
            const outcome = await handle.done;
            if (!this.closing && (outcome.exitCode !== 0 || outcome.signal !== null)) {
                this.ctx.logger.warn(`claude monitor "${this.config.pluginName}/${monitor.name}" exited: code=${String(outcome.exitCode)} signal=${String(outcome.signal)}`);
            }
        }
        catch (error) {
            if (!this.closing) {
                this.ctx.logger.warn(`claude monitor "${this.config.pluginName}/${monitor.name}" output failed: ${String(error)}`);
            }
        }
    }
    deliver(monitor, line) {
        if (this.closing)
            return;
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
        });
        if (this.agent.status === 'idle')
            this.agent.followup(message);
        else
            this.agent.steer(message);
    }
    async dispose() {
        if (this.closing)
            return;
        this.closing = true;
        const running = [...this.running.values()];
        for (const { handle } of running)
            handle.terminate();
        await Promise.allSettled(running.map(async ({ handle, pump }) => {
            await handle.waitForExit();
            await pump;
        }));
        this.running.clear();
    }
}
/** Runtime half exported for a dedicated package export wrapper. */
export function applyClaudeMonitorsRuntime(ctx, rawConfig) {
    const config = runtimeConfig(rawConfig);
    const runtimeCtx = ctx;
    const cleanups = new Map();
    let stopping = false;
    const mount = (agent, alreadyStarted) => {
        if (stopping || cleanups.has(agent))
            return;
        const runtime = new AgentMonitorRuntime(runtimeCtx, agent, config);
        let cleanup;
        cleanup = agent.ctx.effect(() => {
            const stopStart = agent.ctx.on('agent/session-start', () => { runtime.startAlways(); });
            const stopEvents = agent.ctx.on('session/event', (session, event) => {
                if (session === agent.session)
                    runtime.observe(event);
            });
            if (alreadyStarted)
                runtime.startAlways();
            return async () => {
                stopEvents();
                stopStart();
                try {
                    await runtime.dispose();
                }
                finally {
                    if (cleanups.get(agent) === cleanup)
                        cleanups.delete(agent);
                }
            };
        }, `claude-monitors.runtime(${config.pluginName})`);
        cleanups.set(agent, cleanup);
    };
    ctx.effect(() => {
        for (const agent of ctx.agents.list())
            mount(agent, true);
        const stopCreated = ctx.on('agent/created', ({ agent }) => { mount(agent, false); });
        const stopDisposed = ctx.on('agent/disposed', ({ agent }) => {
            const cleanup = cleanups.get(agent);
            if (cleanup !== undefined)
                void Promise.resolve(cleanup());
        });
        return async () => {
            stopping = true;
            stopDisposed();
            stopCreated();
            const owned = [...cleanups.values()];
            cleanups.clear();
            await Promise.allSettled(owned.map(cleanup => Promise.resolve(cleanup())));
        };
    }, `claude-monitors.lifecycle(${config.pluginName})`);
}
export const name = 'plugin-bridge-adapter-dsh-claude-monitors';
export const inject = ['pluginBridge'];
export function apply(ctx) {
    ctx.pluginBridge.registerComponentAdapter(dshClaudeMonitorsAdapter);
}
//# sourceMappingURL=dsh-claude-monitors.js.map