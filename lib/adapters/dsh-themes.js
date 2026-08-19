import { loadThemeDefinitions } from '../theme-definitions.js';
import { insidePlugin, packageName, slug } from './utils.js';
function entries(value) {
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
        throw new TypeError('pi-package: theme component entries must be an array of strings');
    }
    return value;
}
/** Compile foreign theme JSON into browser-safe DSH ThemeDefinition values. */
export const dshThemesAdapter = {
    name: 'dsh-themes',
    componentTypes: ['theme', 'pi-theme-set'],
    materialize(input) {
        const pluginName = packageName(input);
        const dialect = input.detected.provider === 'pi-package'
            ? 'pi'
            : input.detected.provider === 'claude-code-legacy'
                ? 'claude-code'
                : undefined;
        if (dialect === undefined)
            throw new TypeError(`${input.detected.provider}: theme component has no DSH adapter`);
        const componentEntries = dialect === 'pi'
            ? entries(input.component.metadata?.entries)
            : [input.component.path];
        for (const entry of componentEntries) {
            if (!entry.startsWith('!'))
                insidePlugin(input, entry);
        }
        const loaded = loadThemeDefinitions(dialect, pluginName, input.source.root, componentEntries);
        return {
            rows: [{
                    id: `plugin-bridge-${slug(pluginName)}-themes`,
                    name: '@openma/dsh-agents-plugins-bridge/theme',
                    config: { themes: loaded.themes },
                }],
            ...loaded.diagnostics.length === 0 ? {} : { diagnostics: loaded.diagnostics },
        };
    },
};
export const name = 'plugin-bridge-adapter-dsh-themes';
export const inject = ['pluginBridge'];
export function apply(ctx) {
    ctx.pluginBridge.registerComponentAdapter(dshThemesAdapter);
}
//# sourceMappingURL=dsh-themes.js.map