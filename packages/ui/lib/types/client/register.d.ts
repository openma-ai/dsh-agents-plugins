import type { PluginBridgeRemoteApi } from '../types.ts';
import type { PluginBridgeView } from '../types.ts';
export declare const PLUGIN_BRIDGE_LOCALE = "settings.pluginBridge";
interface RemoteContribution {
    readonly package: string;
    readonly descriptors: readonly unknown[];
}
interface RegistrationContext {
    readonly remote: {
        $mount(contribution: RemoteContribution): Promise<() => Promise<void>>;
        readonly agentPluginsBridge: PluginBridgeRemoteApi;
    };
    readonly locale: {
        register(namespace: string, dictionaries: unknown): unknown;
        bind(namespace: string): (key: string) => string;
    };
    readonly slots: {
        inject(name: string, factory: () => unknown): unknown;
        register(options: Record<string, unknown>, component: unknown): unknown;
    };
    effect(factory: () => unknown, label?: string): unknown;
    inject(services: readonly string[], callback: (scope: RegistrationContext) => void): unknown;
}
/** Data injected into the Bridge-owned Plugins settings tab. */
export interface PluginBridgeSettingsTabInjected {
    readonly load: () => Promise<PluginBridgeView>;
    readonly rescan: () => Promise<PluginBridgeView>;
    readonly addMarketplace: (location: string) => Promise<PluginBridgeView>;
    readonly importMarketplace: (ref: string) => Promise<PluginBridgeView>;
    readonly importLocal: (ref: string) => Promise<PluginBridgeView>;
    readonly install: (name: string, marketplace: string) => Promise<PluginBridgeView>;
    readonly setEnabled: (name: string, enabled: boolean) => Promise<PluginBridgeView>;
}
/** Project the Remote namespace into callback-only component injection. */
export declare function createPluginBridgeSettingsFace(api: PluginBridgeRemoteApi): PluginBridgeSettingsTabInjected;
/** Mount the external Remote descriptor, then contribute the settings tab. */
export declare function registerPluginBridgeUi(ctx: RegistrationContext, contribution: RemoteContribution, component: unknown, dictionaries: unknown): Promise<() => Promise<void>>;
export {};
//# sourceMappingURL=register.d.ts.map