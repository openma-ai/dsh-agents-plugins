import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export interface Config {
    readonly dialect: 'claude-code' | 'pi';
    readonly pluginName: string;
    readonly pluginRoot: string;
    readonly componentPath?: string;
    readonly entries?: readonly string[];
    readonly pluginData?: string;
}
export declare function expandPrompt(body: string, rawInput: string, config: Config, agent: Agent): string;
export declare const name = "plugin-bridge-prompt-commands";
export declare const inject: string[];
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=prompt-commands.d.ts.map