import type { Context } from '@deepseek-ai/cordis';
import { type ToolRestriction } from '@deepseek-ai/dsh-tools';
export interface Config {
    readonly pluginName: string;
    readonly pluginRoot: string;
    readonly componentPath: string;
    readonly provider: string;
}
export interface ClaudeAgentDefinition {
    readonly source: string;
    readonly name: string;
    readonly description: string;
    readonly persona: string;
    readonly toolName: string;
    readonly toolFilter?: ToolRestriction;
}
export interface ClaudeAgentInspection {
    readonly agents: readonly ClaudeAgentDefinition[];
    readonly diagnostics: readonly string[];
}
/** Inspect an explicitly imported Claude agents component without activating any capability. */
export declare function inspectClaudeAgents(config: Config): ClaudeAgentInspection;
export declare const name = "plugin-bridge-claude-agents";
export declare const inject: string[];
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=claude-agents.d.ts.map