import type { Context } from '@deepseek-ai/cordis';
import type { InstalledPluginLocator } from '../kernel.js';
export declare const name = "plugin-bridge-discovery-pi";
export declare const inject: string[];
export interface Config {
    /** Pi settings file to inspect. Defaults to the user-scoped registry. */
    readonly settingsPath?: string;
    /** Scope label attached to candidates from this settings file. */
    readonly scope?: 'user' | 'project';
}
/** Reads Pi's explicit settings registry; Pi has no marketplace catalog registry. */
export declare function createPiInstalledPluginLocator(config?: Config): InstalledPluginLocator;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=pi.d.ts.map