import { createScope } from '@deepseek-ai/dsh-scope';
import { PERSONA_ORDER, PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt';
import { slug } from './utils.js';
function string(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`output-style-host: ${field} must be a non-empty string`);
    }
    return value;
}
function config(value) {
    return {
        pluginName: string(value.pluginName, 'pluginName'),
        styleName: string(value.styleName, 'styleName'),
        description: string(value.description, 'description'),
        sourcePath: string(value.sourcePath, 'sourcePath'),
        instructions: string(value.instructions, 'instructions'),
        keepCodingInstructions: value.keepCodingInstructions === true,
        forceForPlugin: value.forceForPlugin === true,
    };
}
export const name = 'plugin-bridge-output-style-host';
export const inject = ['agents', 'commands', 'systemPrompt'];
const activeStyles = new WeakMap();
function clearStyle(agent, owner) {
    const active = activeStyles.get(agent);
    if (active === undefined || (owner !== undefined && active.owner !== owner))
        return;
    activeStyles.delete(agent);
    active.disposeSection();
    void active.scope.dispose();
}
function selectStyle(ctx, agent, style, owner) {
    const current = activeStyles.get(agent);
    if (current?.forced === true && current.owner !== owner)
        return false;
    clearStyle(agent);
    const scope = createScope(ctx, agent);
    const disposeSection = style.keepCodingInstructions
        ? scope.ctx.systemPrompt.section({
            name: `plugin-bridge:output-style:${slug(style.pluginName)}:${slug(style.sourcePath)}`,
            order: 1_000,
            text: style.instructions,
        })
        : scope.ctx.systemPrompt.section({
            name: PERSONA_SECTION,
            order: PERSONA_ORDER,
            text: style.instructions,
        });
    activeStyles.set(agent, { owner, forced: style.forceForPlugin, disposeSection, scope });
    return true;
}
/** Apply one forced Claude output style in every live Agent's own prompt scope. */
export function apply(ctx, rawConfig) {
    const style = config(rawConfig);
    const owner = Symbol(`${style.pluginName}:${style.sourcePath}`);
    const selectedAgents = new Set();
    const attach = (agent) => {
        if (!style.forceForPlugin || selectedAgents.has(agent))
            return;
        selectedAgents.add(agent);
        selectStyle(ctx, agent, style, owner);
    };
    const detach = (agent) => {
        selectedAgents.delete(agent);
        clearStyle(agent, owner);
    };
    const commandName = `output-style-${slug(style.pluginName)}-${slug(style.styleName)}`;
    ctx.commands.register({
        name: commandName,
        description: style.description,
        handler: ({ agent }) => {
            selectedAgents.add(agent);
            if (!selectStyle(ctx, agent, style, owner)) {
                return { kind: 'error', text: 'A force-for-plugin output style is already active for this Agent.' };
            }
            return { kind: 'success', text: `Selected output style "${style.styleName}".` };
        },
    });
    for (const agent of ctx.agents.list())
        attach(agent);
    ctx.on('agent/created', ({ agent }) => { attach(agent); });
    ctx.on('agent/disposed', ({ agent }) => { detach(agent); });
    ctx.effect(() => () => {
        for (const agent of [...selectedAgents])
            detach(agent);
    }, 'outputStyleHost.sections()');
}
//# sourceMappingURL=dsh-output-style-host.js.map