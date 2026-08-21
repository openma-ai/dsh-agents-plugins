import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DefaultPackageManager, SettingsManager, getAgentDir, } from '@earendil-works/pi-coding-agent';
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
/** Build the same package manager Pi uses for its own interactive lifecycle. */
export function createPiNativePackageManager(cwd) {
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir);
    return new DefaultPackageManager({ cwd, agentDir, settingsManager });
}
function packageId(source, scope) {
    return createHash('sha256').update(scope).update('\0').update(source).digest('hex').slice(0, 32);
}
function isUpdateMode(value) {
    return value === 'notify' || value === 'auto' || value === 'off';
}
function cloneStatus(status) {
    return structuredClone(status);
}
/**
 * Coordinates Pi-native checks/updates with Bridge reconciliation.
 *
 * Native package sources remain private to this Host-side controller. Durable
 * policy stores only their one-way identifiers, and all operations serialize so
 * scheduled checks cannot race explicit UI updates.
 */
export class PiUpdateController {
    options;
    statePath;
    now;
    checkIntervalMs;
    mode = 'notify';
    excludedPackageIds = new Set();
    lastCheckedAt;
    available = new Map();
    operationTail = Promise.resolve();
    constructor(options) {
        this.options = options;
        this.statePath = join(options.storageDir, 'pi-updates.json');
        this.now = options.now ?? Date.now;
        this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
        if (!Number.isFinite(this.checkIntervalMs) || this.checkIntervalMs <= 0) {
            throw new TypeError('Pi update check interval must be a positive finite number');
        }
    }
    async start() {
        await this.serialize(async () => {
            let raw;
            try {
                raw = JSON.parse(await readFile(this.statePath, 'utf8'));
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return;
                throw error;
            }
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
                throw new TypeError('Pi update state must be an object');
            }
            const state = raw;
            if (state.schemaVersion !== 1 || !isUpdateMode(state.mode)) {
                throw new TypeError('unsupported Pi update state');
            }
            if (!Array.isArray(state.excludedPackageIds)
                || state.excludedPackageIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/u.test(id))) {
                throw new TypeError('Pi update exclusions must be opaque package IDs');
            }
            this.mode = state.mode;
            this.excludedPackageIds.clear();
            for (const id of state.excludedPackageIds)
                this.excludedPackageIds.add(id);
            if (typeof state.lastCheckedAt === 'number' && Number.isFinite(state.lastCheckedAt)) {
                this.lastCheckedAt = state.lastCheckedAt;
            }
        });
    }
    status() {
        const updates = [...this.available.entries()]
            .map(([id, update]) => ({
            id,
            displayName: update.displayName,
            type: update.type,
            scope: update.scope,
            autoUpdate: !this.excludedPackageIds.has(id),
        }))
            .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));
        const status = {
            mode: this.mode,
            updates,
            ...(this.lastCheckedAt === undefined ? {} : {
                lastCheckedAt: this.lastCheckedAt,
                nextCheckAt: this.lastCheckedAt + this.checkIntervalMs,
            }),
        };
        return cloneStatus(status);
    }
    setMode(mode) {
        if (!isUpdateMode(mode))
            return Promise.reject(new TypeError(`invalid Pi update mode: ${String(mode)}`));
        return this.serialize(async () => {
            this.mode = mode;
            await this.writeState();
            return this.status();
        });
    }
    setPackageAutoUpdate(id, enabled) {
        return this.serialize(async () => {
            if (!/^[a-f0-9]{32}$/u.test(id))
                throw new TypeError('invalid Pi package update ID');
            if (enabled)
                this.excludedPackageIds.delete(id);
            else
                this.excludedPackageIds.add(id);
            await this.writeState();
            return this.status();
        });
    }
    checkNow() {
        return this.serialize(() => this.checkNowUnserialized());
    }
    updatePackage(id) {
        return this.serialize(async () => {
            const update = this.available.get(id);
            if (update === undefined)
                throw new Error('Pi package update is no longer available; check again');
            await this.options.nativeManager.update(update.source);
            await this.options.reconcile();
            return this.checkNowUnserialized();
        });
    }
    updateAll() {
        return this.serialize(async () => {
            const updates = [...this.available.values()];
            const failures = [];
            let succeeded = 0;
            for (const update of updates) {
                try {
                    await this.options.nativeManager.update(update.source);
                    succeeded += 1;
                }
                catch (error) {
                    failures.push(error);
                }
            }
            if (succeeded > 0)
                await this.options.reconcile();
            const status = await this.checkNowUnserialized();
            if (failures.length > 0)
                throw new Error('one or more Pi package updates failed');
            return status;
        });
    }
    runScheduledCheck() {
        return this.serialize(async () => {
            if (this.mode === 'off')
                return this.status();
            if (this.lastCheckedAt !== undefined && this.now() < this.lastCheckedAt + this.checkIntervalMs) {
                return this.status();
            }
            await this.checkNowUnserialized();
            if (this.mode !== 'auto')
                return this.status();
            const eligible = [...this.available.entries()]
                .filter(([id]) => !this.excludedPackageIds.has(id))
                .map(([, update]) => update);
            const failures = [];
            let succeeded = 0;
            for (const update of eligible) {
                try {
                    await this.options.nativeManager.update(update.source);
                    succeeded += 1;
                }
                catch (error) {
                    failures.push(error);
                }
            }
            if (succeeded > 0) {
                await this.options.reconcile();
                await this.checkNowUnserialized();
            }
            if (failures.length > 0)
                throw new Error('one or more automatic Pi package updates failed');
            return this.status();
        });
    }
    async checkNowUnserialized() {
        const imported = new Set(this.options.listImportedPackages().map(({ source, scope }) => `${scope}\0${source}`));
        const updates = await this.options.nativeManager.checkForAvailableUpdates();
        const available = new Map();
        for (const update of updates) {
            if (!imported.has(`${update.scope}\0${update.source}`))
                continue;
            available.set(packageId(update.source, update.scope), structuredClone(update));
        }
        this.available = available;
        this.lastCheckedAt = this.now();
        await this.writeState();
        return this.status();
    }
    serialize(operation) {
        const result = this.operationTail.then(operation);
        this.operationTail = result.then(() => undefined, () => undefined);
        return result;
    }
    async writeState() {
        const state = {
            schemaVersion: 1,
            mode: this.mode,
            excludedPackageIds: [...this.excludedPackageIds].sort(),
            ...(this.lastCheckedAt === undefined ? {} : { lastCheckedAt: this.lastCheckedAt }),
        };
        await mkdir(this.options.storageDir, { recursive: true, mode: 0o700 });
        const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 });
        await rename(temporaryPath, this.statePath);
    }
}
//# sourceMappingURL=pi-updates.js.map