import { type ReactNode } from 'react';
import type { PluginBridgeView } from '../types.ts';
export interface PluginBridgeContentProps {
    readonly view: PluginBridgeView;
    readonly busyAction: string | null;
    readonly marketplaceLocation: string;
    readonly t: (key: string) => string;
    readonly onMarketplaceLocationChange: (value: string) => void;
    readonly onRescan: () => Promise<void>;
    readonly onAddMarketplace: () => Promise<void>;
    readonly onImportMarketplace: (ref: string) => Promise<void>;
    readonly onImportLocal: (ref: string) => Promise<void>;
    readonly onInstall: (name: string, marketplace: string) => Promise<void>;
    readonly onSetEnabled: (name: string, enabled: boolean) => Promise<void>;
}
/** Four-section Agent Plugins management surface for DSH Web settings. */
export declare function PluginBridgeContent({ view, busyAction, marketplaceLocation, t, onMarketplaceLocationChange, onRescan, onAddMarketplace, onImportMarketplace, onImportLocal, onInstall, onSetEnabled, }: PluginBridgeContentProps): ReactNode;
//# sourceMappingURL=PluginBridgeContent.d.ts.map