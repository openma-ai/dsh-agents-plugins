import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export interface PiExtensionHostConfig {
    readonly pluginName: string;
    readonly pluginRoot: string;
    readonly entries: readonly string[];
    readonly pluginData?: string;
}
export interface MountedPiExtension {
    dispatch(type: string, event: Readonly<Record<string, unknown>>): Promise<unknown[]>;
    dispose(): Promise<void>;
}
/** Load one copied Pi package into the exact DSH agent scope that consumes it. */
export declare function mountPiExtensionForAgent(ctx: Context, agent: Agent, rawConfig: PiExtensionHostConfig): Promise<MountedPiExtension>;
export declare const name = "plugin-bridge-pi-extension-host";
export declare const inject: string[];
export declare function apply(ctx: Context, config: PiExtensionHostConfig): void;
//# sourceMappingURL=pi-extension-host.d.ts.map