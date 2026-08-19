import { resolve } from 'node:path';
import { insidePlugin, packageName, slug } from './utils.js';
/** Materialize Codex and Claude Code hook files through dsh's native dialect bridges. */
export const dshHooksAdapter = {
    name: 'dsh-hooks',
    componentTypes: ['hook'],
    materialize(input) {
        const plugin = slug(packageName(input));
        const configPath = insidePlugin(input, input.component.path);
        const pluginRoot = insidePlugin(input, '.');
        const pluginData = input.pluginDataRoot === undefined ? undefined : resolve(input.pluginDataRoot);
        const siblingHooks = input.detected.components.filter(component => component.type === 'hook');
        const componentSuffix = siblingHooks.length > 1 ? `-${slug(input.component.path)}` : '';
        if (input.detected.provider === 'codex-legacy') {
            const row = {
                id: `plugin-bridge-${plugin}-hook-codex${componentSuffix}`,
                name: '@openma/dsh-agents-plugins-bridge/hooks-codex',
                config: {
                    configPath,
                    pluginRoot,
                    ...pluginData === undefined ? {} : { pluginData },
                },
            };
            return { rows: [row], activations: [] };
        }
        if (input.detected.provider === 'claude-code-legacy') {
            const row = {
                id: `plugin-bridge-${plugin}-hook-claude-code${componentSuffix}`,
                name: '@openma/dsh-agents-plugins-bridge/hooks-claude-code',
                config: {
                    configPath,
                    pluginRoot,
                    ...pluginData === undefined ? {} : { pluginData },
                },
            };
            return { rows: [row], activations: [] };
        }
        throw new TypeError(`${input.detected.provider}: hook components have no dsh dialect bridge`);
    },
};
export const name = 'plugin-bridge-adapter-dsh-hooks';
export const inject = ['pluginBridge'];
export function apply(ctx) {
    ctx.pluginBridge.registerComponentAdapter(dshHooksAdapter);
}
//# sourceMappingURL=dsh-hooks.js.map