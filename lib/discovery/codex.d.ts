import type { Context } from '@deepseek-ai/cordis';
import type { InstalledPluginLocator } from '../kernel.js';
export declare const name = "plugin-bridge-discovery-codex";
export declare const inject: string[];
export interface Config {
    /** Override for tests or a non-default CODEX_HOME. */
    readonly cacheDir?: string;
    /** Codex config containing the authoritative `[plugins.<id>]` registrations. */
    readonly configPath?: string;
}
/**
 * Observes Codex's versioned plugin cache. Codex does not expose a local
 * installed-plugin registry here, so every result is explicitly cache evidence.
 */
export declare function createCodexInstalledPluginLocator(config?: Config): InstalledPluginLocator;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=codex.d.ts.map