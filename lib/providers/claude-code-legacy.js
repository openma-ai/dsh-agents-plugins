import { declaredComponents, dedupeComponents, fixedComponent, manifestObject, } from './legacy-utils.js';
const MANIFEST_PATH = '.claude-plugin/plugin.json';
const FORMAT = 'claude-code-legacy';
function declaredOrFixed(source, manifest, field, type, path) {
    return manifest[field] === undefined
        ? fixedComponent(source, type, path)
        : declaredComponents(source, MANIFEST_PATH, manifest, field, type, FORMAT);
}
/** Claude Code plugin layout rooted at `.claude-plugin/plugin.json`. */
export const claudeCodeLegacyProvider = {
    name: FORMAT,
    probe(source) {
        if (!source.has(MANIFEST_PATH))
            return undefined;
        const manifest = manifestObject(source.readJson(MANIFEST_PATH), FORMAT);
        const experimental = typeof manifest.experimental === 'object'
            && manifest.experimental !== null
            && !Array.isArray(manifest.experimental)
            ? manifest.experimental
            : {};
        const components = dedupeComponents([
            ...fixedComponent(source, 'skill', 'skills/'),
            ...declaredComponents(source, MANIFEST_PATH, manifest, 'skills', 'skill', FORMAT),
            ...declaredOrFixed(source, manifest, 'commands', 'command', 'commands/'),
            ...declaredOrFixed(source, manifest, 'agents', 'agent', 'agents/'),
            ...declaredOrFixed(source, manifest, 'hooks', 'hook', 'hooks/hooks.json'),
            ...declaredOrFixed(source, manifest, 'mcpServers', 'mcp-server', '.mcp.json'),
            ...declaredOrFixed(source, manifest, 'outputStyles', 'output-style', 'output-styles/'),
            ...declaredOrFixed(source, manifest, 'lspServers', 'lsp-server', '.lsp.json'),
            ...declaredComponents(source, MANIFEST_PATH, experimental, 'themes', 'theme', FORMAT),
            ...declaredComponents(source, MANIFEST_PATH, experimental, 'monitors', 'monitor', FORMAT),
            ...experimental.monitors === undefined
                ? fixedComponent(source, 'monitor', 'monitors/monitors.json')
                : [],
        ]);
        return {
            manifestPath: MANIFEST_PATH,
            manifest: Object.freeze({ ...manifest }),
            components,
        };
    },
};
export const name = 'plugin-bridge-format-claude-code-legacy';
export const inject = ['pluginBridge'];
export function apply(ctx) {
    ctx.pluginBridge.registerPackageFormatProvider(claudeCodeLegacyProvider);
}
//# sourceMappingURL=claude-code-legacy.js.map