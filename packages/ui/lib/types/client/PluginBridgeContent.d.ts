import { type ReactNode } from 'react';
import type { PluginBridgePiUpdateMode, PluginBridgeView } from '../types.ts';
export interface PluginBridgeContentProps {
    readonly view: PluginBridgeView;
    readonly mutationFeedback?: Readonly<Record<string, PluginBridgeMutationFeedback>>;
    readonly marketplaceLocation: string;
    readonly t: (key: string) => string;
    readonly onMarketplaceLocationChange: (value: string) => void;
    readonly onRescan: () => Promise<void>;
    readonly onAddMarketplace: () => Promise<void>;
    readonly onImportMarketplace: (ref: string) => Promise<void>;
    readonly onImportLocal: (ref: string) => Promise<void>;
    readonly onInstall: (name: string, marketplace: string) => Promise<void>;
    readonly onSetEnabled: (name: string, enabled: boolean) => Promise<void>;
    readonly onCheckPiUpdates: () => Promise<void>;
    readonly onSetPiUpdateMode: (mode: PluginBridgePiUpdateMode) => Promise<void>;
    readonly onSetPiPackageAutoUpdate: (id: string, enabled: boolean) => Promise<void>;
    readonly onUpdatePiPackage: (id: string) => Promise<void>;
    readonly onUpdateAllPiPackages: () => Promise<void>;
}
export type PluginBridgeMutationFeedback = {
    readonly status: 'pending';
} | {
    readonly status: 'error';
    readonly messageKey: string;
};
/** Agent Plugins management surface for DSH Web settings. */
export declare function PluginBridgeContent({ view, mutationFeedback, marketplaceLocation, t, onMarketplaceLocationChange, onRescan, onAddMarketplace, onImportMarketplace, onImportLocal, onInstall, onSetEnabled, onCheckPiUpdates, onSetPiUpdateMode, onSetPiPackageAutoUpdate, onUpdatePiPackage, onUpdateAllPiPackages, }: PluginBridgeContentProps): ReactNode;
//# sourceMappingURL=PluginBridgeContent.d.ts.map