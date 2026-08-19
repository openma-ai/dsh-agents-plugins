import type { Context } from '@deepseek-ai/cordis';
export interface Config {
    readonly providerName: string;
    readonly pluginRoot: string;
    readonly entries: readonly string[];
}
export declare const name = "plugin-bridge-pi-skills";
export declare const inject: string[];
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=pi-skills.d.ts.map