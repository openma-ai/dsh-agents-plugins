import type { Context } from '@deepseek-ai/cordis';
export interface Config {
    readonly pluginName: string;
    readonly styleName: string;
    readonly description: string;
    readonly sourcePath: string;
    readonly instructions: string;
    readonly keepCodingInstructions: boolean;
    readonly forceForPlugin: boolean;
}
export declare const name = "plugin-bridge-output-style-host";
export declare const inject: string[];
/** Apply one forced Claude output style in every live Agent's own prompt scope. */
export declare function apply(ctx: Context, rawConfig: Config): void;
//# sourceMappingURL=dsh-output-style-host.d.ts.map