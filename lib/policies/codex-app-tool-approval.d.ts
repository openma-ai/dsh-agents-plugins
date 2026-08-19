import type { Context } from '@deepseek-ai/cordis';
export declare const name = "plugin-bridge-policy-codex-app-tool-approval";
export declare const inject: string[];
export interface Config {
    readonly appName: string;
    readonly connectionId: string;
    readonly serverName: string;
    readonly cwd: string;
    readonly codexCommand?: string;
}
/** Ask through DSH for every non-read-only Codex App tool; unknown future tools fail closed. */
export declare function apply(ctx: Context, rawConfig: Config): Promise<void>;
//# sourceMappingURL=codex-app-tool-approval.d.ts.map