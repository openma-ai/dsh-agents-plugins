import { mountMcpAppsDependency } from './mcp-apps-dependency.js';
export const name = 'plugin-bridge-mcp-apps-host';
export const inject = ['loader'];
export function apply(ctx, config) {
    return mountMcpAppsDependency(ctx, '@openma/dsh-mcp-apps-host', config);
}
//# sourceMappingURL=mcp-apps-host.js.map