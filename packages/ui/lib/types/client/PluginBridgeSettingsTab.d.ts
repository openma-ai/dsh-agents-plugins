import { type ReactNode } from 'react';
import type { PluginBridgeSettingsTabInjected } from './register.ts';
export interface PluginBridgeSettingsTabProps extends PluginBridgeSettingsTabInjected {
    readonly t: (key: string) => string;
}
/** Mounted settings tab that owns async loading, retry, and mutation state. */
export declare function PluginBridgeSettingsTab(props: PluginBridgeSettingsTabProps): ReactNode;
//# sourceMappingURL=PluginBridgeSettingsTab.d.ts.map