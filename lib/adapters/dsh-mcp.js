import { boundedName, componentJson, insidePlugin, packageName, record, slug, } from './utils.js';
function deferredString(value, pluginRoot) {
    const rooted = value
        .replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot)
        .replaceAll('${CODEX_PLUGIN_ROOT}', pluginRoot);
    const unsupported = [...rooted.matchAll(/\$\{([^}]+)\}/gu)]
        .find(match => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(match[1] ?? ''));
    if (unsupported !== undefined) {
        throw new TypeError(`unsupported MCP config placeholder "${unsupported[0]}"`);
    }
    const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu;
    const matches = [...rooted.matchAll(pattern)];
    if (matches.length === 0)
        return rooted;
    const terms = [];
    let offset = 0;
    for (const match of matches) {
        const index = match.index;
        const variable = match[1];
        if (index > offset)
            terms.push(JSON.stringify(rooted.slice(offset, index)));
        terms.push(`(process.env[${JSON.stringify(variable)}] ?? "")`);
        offset = index + match[0].length;
    }
    if (offset < rooted.length)
        terms.push(JSON.stringify(rooted.slice(offset)));
    const expression = terms.length === 1 && matches.length === 1 && matches[0]?.[0] === rooted
        ? terms[0]?.slice(1, -1) ?? ''
        : terms.join(' + ');
    return { __jsExpr: expression };
}
function strings(value, label, pluginRoot) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new TypeError(`${label} must be an array of strings`);
    }
    return value.map(item => deferredString(item, pluginRoot));
}
function stringRecord(value, label, pluginRoot) {
    if (value === undefined)
        return {};
    const object = record(value, label);
    for (const [key, item] of Object.entries(object)) {
        if (typeof item !== 'string')
            throw new TypeError(`${label}.${key} must be a string`);
    }
    return Object.fromEntries(Object.entries(object)
        .map(([key, item]) => [key, deferredString(item, pluginRoot)]));
}
function legacyServerRows(input) {
    const raw = record(componentJson(input), `${input.detected.provider}: ${input.component.path}`);
    const servers = record(raw.mcpServers ?? raw.mcp_servers ?? raw, `${input.detected.provider}: mcpServers`);
    const plugin = slug(packageName(input));
    const pluginRoot = insidePlugin(input, '.');
    return Object.keys(servers).sort().map((server) => {
        const config = record(servers[server], `${input.detected.provider}: mcpServers.${server}`);
        const rowId = `plugin-bridge-${plugin}-mcp-${slug(server)}`;
        const serverName = boundedName(`${plugin}-${server}`, 32);
        if (typeof config.command === 'string' && config.command.length > 0) {
            if (config.cwd !== undefined && typeof config.cwd !== 'string') {
                throw new TypeError(`${input.detected.provider}: mcpServers.${server}.cwd must be a string`);
            }
            const configuredCwd = deferredString(config.cwd ?? '.', pluginRoot);
            if (typeof configuredCwd !== 'string') {
                throw new TypeError(`${input.detected.provider}: mcpServers.${server}.cwd cannot depend on an environment variable`);
            }
            const cwd = insidePlugin(input, configuredCwd);
            return {
                id: rowId,
                name: '@deepseek-ai/dsh-mcp-client',
                config: {
                    transport: 'stdio',
                    serverName,
                    command: deferredString(config.command, pluginRoot),
                    args: strings(config.args, `${input.detected.provider}: mcpServers.${server}.args`, pluginRoot),
                    env: stringRecord(config.env, `${input.detected.provider}: mcpServers.${server}.env`, pluginRoot),
                    cwd,
                    failOnStartupError: false,
                },
            };
        }
        const url = config.url ?? config.httpUrl;
        if (typeof url !== 'string' || url.length === 0) {
            throw new TypeError(`${input.detected.provider}: mcpServers.${server} requires command or url`);
        }
        return {
            id: rowId,
            name: '@deepseek-ai/dsh-mcp-client',
            config: {
                transport: 'streamable-http',
                serverName,
                url: deferredString(url, pluginRoot),
                headers: stringRecord(config.headers ?? config.http_headers, `${input.detected.provider}: mcpServers.${server}.headers`, pluginRoot),
                failOnStartupError: false,
            },
        };
    });
}
/** Materialize every server in one foreign MCP manifest as its own dsh row. */
export const dshMcpAdapter = {
    name: 'dsh-mcp',
    componentTypes: ['mcp-server'],
    materialize: legacyServerRows,
};
export const name = 'plugin-bridge-adapter-dsh-mcp';
export const inject = ['pluginBridge'];
export function apply(ctx) {
    ctx.pluginBridge.registerComponentAdapter(dshMcpAdapter);
}
//# sourceMappingURL=dsh-mcp.js.map