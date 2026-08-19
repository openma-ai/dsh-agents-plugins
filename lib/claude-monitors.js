import { applyClaudeMonitorsRuntime, } from './adapters/dsh-claude-monitors.js';
export const name = 'plugin-bridge-claude-monitors';
export const inject = ['agents', 'subprocess'];
export function apply(ctx, config) {
    applyClaudeMonitorsRuntime(ctx, config);
}
//# sourceMappingURL=claude-monitors.js.map