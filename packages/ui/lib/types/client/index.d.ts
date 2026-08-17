/** DSH Web contribution for Agent Plugins bridge settings. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export { PluginBridgeSettingsTab, type PluginBridgeSettingsTabProps } from './PluginBridgeSettingsTab.tsx';
export type { PluginBridgeSettingsTabInjected } from './register.ts';
/** Base client services; the Remote namespace is mounted by this plugin. */
export declare const inject: string[];
/** Mount the Bridge Remote contribution before registering the settings tab. */
export declare function apply(ctx: ClientContext): Promise<() => Promise<void>>;
//# sourceMappingURL=index.d.ts.map