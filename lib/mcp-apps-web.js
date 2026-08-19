import { mountMcpAppsDependency } from './mcp-apps-dependency.js';
export const name = 'plugin-bridge-mcp-apps-web';
export const inject = ['loader'];
export function apply(ctx, config) {
    return mountMcpAppsDependency(ctx, '@openma/dsh-mcp-apps-web', config);
}
//# sourceMappingURL=mcp-apps-web.js.map