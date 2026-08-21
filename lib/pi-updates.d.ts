export type PiUpdateMode = 'notify' | 'auto' | 'off';
export type PiPackageScope = 'user' | 'project';
/** Native update record returned by Pi's package manager. */
export interface PiNativePackageUpdate {
    readonly source: string;
    readonly displayName: string;
    readonly type: 'npm' | 'git';
    readonly scope: PiPackageScope;
}
/** Small seam around Pi's public package-manager API. */
export interface PiNativePackageManager {
    checkForAvailableUpdates(): Promise<readonly PiNativePackageUpdate[]>;
    update(source: string): Promise<void>;
}
/** Imported Pi package identity retained only on the Host. */
export interface ImportedPiPackage {
    readonly source: string;
    readonly scope: PiPackageScope;
}
/** One update safe to send to a browser. The native source never crosses this boundary. */
export interface PiPackageUpdateView {
    readonly id: string;
    readonly displayName: string;
    readonly type: 'npm' | 'git';
    readonly scope: PiPackageScope;
    readonly autoUpdate: boolean;
}
/** Current persisted policy and latest in-memory Pi update check. */
export interface PiUpdateStatus {
    readonly mode: PiUpdateMode;
    readonly updates: readonly PiPackageUpdateView[];
    readonly lastCheckedAt?: number;
    readonly nextCheckAt?: number;
}
interface PiUpdateControllerOptions {
    readonly storageDir: string;
    readonly nativeManager: PiNativePackageManager;
    readonly listImportedPackages: () => readonly ImportedPiPackage[];
    readonly reconcile: () => Promise<void>;
    readonly now?: () => number;
    readonly checkIntervalMs?: number;
}
/** Build the same package manager Pi uses for its own interactive lifecycle. */
export declare function createPiNativePackageManager(cwd: string): PiNativePackageManager;
/**
 * Coordinates Pi-native checks/updates with Bridge reconciliation.
 *
 * Native package sources remain private to this Host-side controller. Durable
 * policy stores only their one-way identifiers, and all operations serialize so
 * scheduled checks cannot race explicit UI updates.
 */
export declare class PiUpdateController {
    private readonly options;
    private readonly statePath;
    private readonly now;
    private readonly checkIntervalMs;
    private mode;
    private readonly excludedPackageIds;
    private lastCheckedAt;
    private available;
    private operationTail;
    constructor(options: PiUpdateControllerOptions);
    start(): Promise<void>;
    status(): PiUpdateStatus;
    setMode(mode: PiUpdateMode): Promise<PiUpdateStatus>;
    setPackageAutoUpdate(id: string, enabled: boolean): Promise<PiUpdateStatus>;
    checkNow(): Promise<PiUpdateStatus>;
    updatePackage(id: string): Promise<PiUpdateStatus>;
    updateAll(): Promise<PiUpdateStatus>;
    runScheduledCheck(): Promise<PiUpdateStatus>;
    private checkNowUnserialized;
    private serialize;
    private writeState;
}
export {};
//# sourceMappingURL=pi-updates.d.ts.map