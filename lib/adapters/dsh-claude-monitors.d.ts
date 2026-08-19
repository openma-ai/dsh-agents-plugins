import type { Context } from '@deepseek-ai/cordis';
import type { ComponentAdapter } from '../kernel.js';
export interface ClaudeMonitorDefinition {
    readonly name: string;
    readonly command: string;
    readonly description: string;
    readonly when: 'always' | `on-skill-invoke:${string}`;
}
export interface ClaudeMonitorsRuntimeConfig {
    readonly pluginName: string;
    readonly pluginRoot: string;
    readonly pluginData?: string;
    readonly monitors: readonly ClaudeMonitorDefinition[];
}
/** Map verified Claude monitor events onto the DSH agent/session and subprocess seams. */
export declare const dshClaudeMonitorsAdapter: ComponentAdapter;
/** Runtime half exported for a dedicated package export wrapper. */
export declare function applyClaudeMonitorsRuntime(ctx: Context, rawConfig: ClaudeMonitorsRuntimeConfig): void;
export declare const name = "plugin-bridge-adapter-dsh-claude-monitors";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=dsh-claude-monitors.d.ts.map