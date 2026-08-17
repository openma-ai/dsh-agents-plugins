import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile, } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DirectoryPackageSource } from './package-source.js';
const STATE_VERSION = 1;
const CATALOG_PATHS = [
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json',
    'marketplace.json',
];
const execFileAsync = promisify(execFile);
function emptyState() {
    return { version: STATE_VERSION, marketplaces: [], installations: [], approvals: [] };
}
function localPath(location) {
    return location.startsWith('file:') ? fileURLToPath(location) : resolve(location);
}
function githubLocation(location) {
    const qualified = /^(?:https:\/\/github\.com\/|github:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:#(.+))?$/u.exec(location);
    if (qualified?.[1] !== undefined) {
        return {
            repo: qualified[1],
            ...qualified[2] === undefined ? {} : { ref: qualified[2] },
        };
    }
    const shorthand = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:@(.+))?$/u.exec(location);
    if (shorthand?.[1] === undefined)
        return undefined;
    return {
        repo: shorthand[1],
        ...shorthand[2] === undefined ? {} : { ref: shorthand[2] },
    };
}
const defaultGitAcquirer = {
    async clone(repo, destination, revision) {
        const url = `https://github.com/${repo}.git`;
        const cloneArgs = ['clone', '--filter=blob:none'];
        if (revision.ref !== undefined && revision.sha === undefined) {
            cloneArgs.push('--depth=1', '--branch', revision.ref);
        }
        cloneArgs.push('--', url, destination);
        await execFileAsync('git', cloneArgs);
        const target = revision.sha ?? revision.ref;
        if (target !== undefined) {
            await execFileAsync('git', ['-C', destination, 'checkout', '--detach', target]);
        }
    },
    async cloneUrl(url, destination, revision) {
        const cloneArgs = ['clone', '--filter=blob:none'];
        if (revision.ref !== undefined && revision.sha === undefined) {
            cloneArgs.push('--depth=1', '--branch', revision.ref);
        }
        cloneArgs.push('--', url, destination);
        await execFileAsync('git', cloneArgs);
        const target = revision.sha ?? revision.ref;
        if (target !== undefined) {
            await execFileAsync('git', ['-C', destination, 'checkout', '--detach', target]);
        }
    },
};
function catalogFile(location) {
    const manifestPath = CATALOG_PATHS.find(path => location.endsWith(path));
    if (manifestPath === undefined)
        return undefined;
    let root = location;
    for (const _segment of manifestPath.split('/'))
        root = dirname(root);
    return { root, manifestPath };
}
function cloneMarketplace(value) {
    return structuredClone(value);
}
function cloneInstallation(value) {
    return structuredClone(value);
}
function compareCodePoints(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function storageSlug(value) {
    const slug = value.toLowerCase()
        .replace(/[^a-z0-9_-]+/gu, '-')
        .replace(/^-+|-+$/gu, '');
    return slug.length === 0 ? 'plugin' : slug.slice(0, 48);
}
function stateRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('plugin bridge state must contain an object');
    }
    const candidate = value;
    if (candidate.version !== STATE_VERSION) {
        throw new TypeError(`unsupported plugin bridge state version "${String(candidate.version)}"`);
    }
    if (!Array.isArray(candidate.marketplaces) || !Array.isArray(candidate.installations)) {
        throw new TypeError('plugin bridge state marketplaces and installations must be arrays');
    }
    const state = structuredClone(candidate);
    return {
        version: STATE_VERSION,
        marketplaces: state.marketplaces,
        installations: state.installations.map(installation => ({
            ...installation,
            activations: Array.isArray(installation.activations) ? installation.activations : [],
        })),
        approvals: Array.isArray(state.approvals) ? state.approvals : [],
    };
}
async function rejectSymlinks(root, current = root) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
        if (entry.name === '.git')
            continue;
        const path = join(current, entry.name);
        const stats = await lstat(path);
        if (stats.isSymbolicLink()) {
            throw new TypeError(`plugin package contains unsupported symlink "${path.slice(root.length + 1)}"`);
        }
        if (stats.isDirectory())
            await rejectSymlinks(root, path);
    }
}
/** Owns marketplace state, package copies, Loader transactions, and restart restoration. */
export class PluginBridgeManager {
    kernel;
    loader;
    storageDir;
    options;
    state = emptyState();
    activeRowIds = [];
    started = false;
    constructor(kernel, loader, storageDir, options = {}) {
        this.kernel = kernel;
        this.loader = loader;
        this.storageDir = storageDir;
        this.options = options;
    }
    listMarketplaces() {
        return this.state.marketplaces.map(cloneMarketplace);
    }
    listInstallations() {
        return this.state.installations.map(cloneInstallation);
    }
    /** Scan every foreign-agent locator without activating or modifying any package. */
    async discoverLocalPlugins() {
        const candidates = [];
        const diagnostics = [];
        const roots = new Map();
        const refs = new Set();
        for (const locator of this.kernel.listInstalledPluginLocators()) {
            let observation;
            try {
                observation = await locator.discover();
            }
            catch (error) {
                diagnostics.push(`${locator.name}: discovery failed: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
            if (observation.diagnostics !== undefined)
                diagnostics.push(...observation.diagnostics);
            for (const candidate of observation.candidates) {
                if (candidate.key.length === 0 || /\s/u.test(candidate.key)) {
                    diagnostics.push(`${locator.name}: skipped candidate with invalid key "${candidate.key}"`);
                    continue;
                }
                if (candidate.name.trim().length === 0) {
                    diagnostics.push(`${locator.name}:${candidate.key}: skipped candidate with an empty name`);
                    continue;
                }
                const ref = `${locator.name}:${candidate.key}`;
                if (refs.has(ref)) {
                    diagnostics.push(`${ref}: skipped duplicate discovery ref`);
                    continue;
                }
                let canonicalRoot;
                try {
                    if (!(await lstat(candidate.root)).isDirectory()) {
                        diagnostics.push(`${ref}: skipped because its root is not a directory`);
                        continue;
                    }
                    canonicalRoot = await realpath(candidate.root);
                }
                catch (error) {
                    diagnostics.push(`${ref}: cannot inspect plugin root: ${error instanceof Error ? error.message : String(error)}`);
                    continue;
                }
                const owner = roots.get(canonicalRoot);
                if (owner !== undefined) {
                    diagnostics.push(`${ref}: skipped duplicate with the same root as ${owner}`);
                    continue;
                }
                roots.set(canonicalRoot, ref);
                refs.add(ref);
                candidates.push(structuredClone({ ...candidate, root: canonicalRoot, ref, locator: locator.name }));
            }
        }
        candidates.sort((left, right) => compareCodePoints(left.ref, right.ref));
        return { candidates, diagnostics };
    }
    /** Aggregate explicit foreign marketplace registrations without changing bridge state. */
    async discoverRegisteredMarketplaces() {
        const candidates = [];
        const diagnostics = [];
        const refs = new Set();
        const locations = new Map();
        for (const locator of this.kernel.listMarketplaceRegistrationLocators()) {
            let observation;
            try {
                observation = await locator.discover();
            }
            catch (error) {
                diagnostics.push(`${locator.name}: discovery failed: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
            if (observation.diagnostics !== undefined)
                diagnostics.push(...observation.diagnostics);
            for (const candidate of observation.candidates) {
                if (candidate.key.length === 0 || /\s/u.test(candidate.key)) {
                    diagnostics.push(`${locator.name}: skipped marketplace with invalid key "${candidate.key}"`);
                    continue;
                }
                const ref = `${locator.name}:${candidate.key}`;
                if (refs.has(ref)) {
                    diagnostics.push(`${ref}: skipped duplicate discovery ref`);
                    continue;
                }
                let location = candidate.location;
                if (candidate.sourceType !== 'git') {
                    try {
                        if (!(await lstat(location)).isDirectory()) {
                            diagnostics.push(`${ref}: skipped because its location is not a directory`);
                            continue;
                        }
                        location = await realpath(location);
                    }
                    catch (error) {
                        diagnostics.push(`${ref}: cannot inspect marketplace location: ${error instanceof Error ? error.message : String(error)}`);
                        continue;
                    }
                }
                const locationKey = candidate.sourceType === 'git'
                    ? `git:${location}#${candidate.revision ?? ''}`
                    : `local:${location}`;
                const owner = locations.get(locationKey);
                if (owner !== undefined) {
                    diagnostics.push(`${ref}: skipped duplicate with the same location as ${owner}`);
                    continue;
                }
                refs.add(ref);
                locations.set(locationKey, ref);
                candidates.push(structuredClone({ ...candidate, location, ref, locator: locator.name }));
            }
        }
        candidates.sort((left, right) => compareCodePoints(left.ref, right.ref));
        return { candidates, diagnostics };
    }
    /** Import one selected registered marketplace through the existing catalog manager. */
    async importRegisteredMarketplace(ref) {
        await this.ensureStarted();
        const discovered = await this.discoverRegisteredMarketplaces();
        const candidate = discovered.candidates.find(item => item.ref === ref);
        if (candidate === undefined)
            throw new Error(`registered marketplace "${ref}" was not discovered`);
        if (candidate.sourceType === 'git') {
            if (candidate.location.includes('#')) {
                throw new TypeError(`registered marketplace Git source must not contain a fragment`);
            }
            const location = candidate.revision === undefined
                ? candidate.location
                : `${candidate.location}#${candidate.revision}`;
            return this.addMarketplace(location);
        }
        if (!(await lstat(candidate.location)).isDirectory()) {
            throw new TypeError(`registered marketplace root "${candidate.location}" is not a directory`);
        }
        await rejectSymlinks(candidate.location);
        const digest = createHash('sha256').update(ref).digest('hex').slice(0, 16);
        const destination = join(this.storageDir, 'marketplaces', 'imports', `${storageSlug(candidate.name)}-${digest}`);
        try {
            await lstat(destination);
            throw new Error(`marketplace destination already exists at "${destination}"`);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        const stage = `${destination}.stage-${randomUUID()}`;
        let promoted = false;
        try {
            await cp(candidate.location, stage, {
                recursive: true,
                errorOnExist: true,
                filter: path => basename(path) !== '.git',
            });
            await rejectSymlinks(stage);
            await rename(stage, destination);
            promoted = true;
            return await this.addMarketplace(destination);
        }
        catch (error) {
            if (promoted)
                await this.moveToTrash(destination);
            else
                await rm(stage, { recursive: true, force: true });
            throw error;
        }
    }
    /** Copy one explicitly selected foreign package, then activate only its copied row plan. */
    async importLocalPlugin(ref) {
        await this.ensureStarted();
        const discovered = await this.discoverLocalPlugins();
        const candidate = discovered.candidates.find(item => item.ref === ref);
        if (candidate === undefined)
            throw new Error(`local plugin "${ref}" was not discovered`);
        if (this.state.installations.some(item => item.name === candidate.name)) {
            throw new Error(`plugin "${candidate.name}" is already installed`);
        }
        if (!(await lstat(candidate.root)).isDirectory()) {
            throw new TypeError(`local plugin root "${candidate.root}" is not a directory`);
        }
        await rejectSymlinks(candidate.root);
        const digest = createHash('sha256').update(ref).digest('hex').slice(0, 16);
        const destination = join(this.storageDir, 'plugins', 'imports', `${storageSlug(candidate.name)}-${digest}`);
        try {
            await lstat(destination);
            throw new Error(`plugin destination already exists at "${destination}"`);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        const stage = `${destination}.stage-${randomUUID()}`;
        let promoted = false;
        let created = [];
        try {
            await cp(candidate.root, stage, {
                recursive: true,
                errorOnExist: true,
                filter: path => basename(path) !== '.git',
            });
            await rejectSymlinks(stage);
            await rename(stage, destination);
            promoted = true;
            const packageSource = new DirectoryPackageSource(destination);
            const detected = this.kernel.detectPackageFormat(packageSource);
            const pluginDataRoot = join(this.storageDir, 'data', 'imports', digest);
            await mkdir(pluginDataRoot, { recursive: true, mode: 0o700 });
            const materialized = this.kernel.materializePackage(packageSource, detected, { pluginDataRoot });
            if (materialized.rows.length === 0) {
                throw new Error(`plugin "${candidate.name}" has no components supported by the active dsh bridge`);
            }
            for (const row of this.rowsAllowedByPolicy(materialized.rows, materialized.activations)) {
                try {
                    await this.loader.create(row);
                    created.push(row.id);
                }
                catch (error) {
                    try {
                        await this.loader.remove(row.id);
                    }
                    catch { /* failed Loader create owns its rollback */ }
                    throw error;
                }
            }
            const combinedDiagnostics = [
                ...(candidate.diagnostics ?? []),
                ...(materialized.diagnostics ?? []),
            ];
            const installation = {
                name: candidate.name,
                marketplace: `import:${candidate.locator}`,
                format: detected.provider,
                root: destination,
                rows: structuredClone(materialized.rows),
                activations: structuredClone(materialized.activations),
                unsupported: structuredClone(materialized.unsupported),
                ...combinedDiagnostics.length === 0 ? {} : { diagnostics: structuredClone(combinedDiagnostics) },
                enabled: true,
            };
            this.state.installations.push(installation);
            try {
                await this.writeState();
            }
            catch (error) {
                this.state.installations.pop();
                throw error;
            }
            this.activeRowIds.push(...created);
            return cloneInstallation(installation);
        }
        catch (error) {
            await this.removeRows(created);
            if (promoted)
                await this.moveToTrash(destination);
            else
                await rm(stage, { recursive: true, force: true });
            throw error;
        }
    }
    /** Restore the exact stored row plans before accepting management commands. */
    async start() {
        if (this.started)
            return;
        await mkdir(this.storageDir, { recursive: true, mode: 0o700 });
        try {
            this.state = stateRecord(JSON.parse(await readFile(this.statePath(), 'utf8')));
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        const originalState = structuredClone(this.state);
        const created = [];
        try {
            for (let index = 0; index < this.state.installations.length; index += 1) {
                await this.refreshInstallationActivations(index, false, false);
            }
            for (const installation of this.state.installations) {
                if (!installation.enabled)
                    continue;
                for (const row of this.rowsAllowedByPolicy(installation.rows, installation.activations)) {
                    await this.loader.create(row);
                    created.push(row.id);
                }
            }
            if (JSON.stringify(this.state) !== JSON.stringify(originalState))
                await this.writeState();
        }
        catch (error) {
            this.state = originalState;
            await this.removeRows(created);
            throw error;
        }
        this.activeRowIds.push(...created);
        this.started = true;
    }
    /** Register one local Codex or Claude marketplace directory. */
    async addMarketplace(location) {
        await this.ensureStarted();
        const github = githubLocation(location);
        let remoteStage;
        let target;
        let root;
        let requestedPath;
        if (github !== undefined) {
            const marketplaceStages = join(this.storageDir, 'marketplaces');
            await mkdir(marketplaceStages, { recursive: true, mode: 0o700 });
            remoteStage = join(marketplaceStages, `.stage-${randomUUID()}`);
            try {
                await (this.options.git ?? defaultGitAcquirer).clone(github.repo, remoteStage, {
                    ...github.ref === undefined ? {} : { ref: github.ref },
                });
            }
            catch (error) {
                try {
                    await this.moveToTrash(remoteStage);
                }
                catch { /* clone may not have created its destination */ }
                throw error;
            }
            target = location;
            root = remoteStage;
        }
        else {
            target = localPath(location);
            const stats = await lstat(target);
            const file = stats.isDirectory() ? undefined : catalogFile(target);
            root = stats.isDirectory() ? target : file?.root ?? dirname(target);
            requestedPath = stats.isDirectory() ? undefined : file?.manifestPath ?? 'marketplace.json';
        }
        const detections = [];
        const catalogSource = new DirectoryPackageSource(root);
        for (const manifestPath of CATALOG_PATHS) {
            if (requestedPath !== undefined && requestedPath !== manifestPath)
                continue;
            try {
                if (!catalogSource.has(manifestPath))
                    continue;
                const manifest = catalogSource.readJson(manifestPath);
                detections.push(this.kernel.detectMarketplaceCatalog({ manifestPath, manifest }));
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    continue;
                if (remoteStage !== undefined)
                    await this.moveToTrash(remoteStage);
                throw error;
            }
        }
        if (detections.length === 0) {
            if (remoteStage !== undefined)
                await this.moveToTrash(remoteStage);
            throw new Error(`no supported marketplace catalog found at "${target}"`);
        }
        if (detections.length > 1) {
            if (remoteStage !== undefined)
                await this.moveToTrash(remoteStage);
            throw new Error(`marketplace directory is ambiguous: ${detections.map(item => item.provider).join(', ')}`);
        }
        const detected = detections[0];
        if (this.state.marketplaces.some(item => item.name === detected.name)) {
            if (remoteStage !== undefined)
                await this.moveToTrash(remoteStage);
            throw new Error(`marketplace "${detected.name}" is already registered`);
        }
        if (remoteStage !== undefined) {
            const destination = join(this.storageDir, 'marketplaces', detected.name);
            try {
                await lstat(destination);
                throw new Error(`marketplace destination already exists at "${destination}"`);
            }
            catch (error) {
                if (error.code !== 'ENOENT') {
                    await this.moveToTrash(remoteStage);
                    throw error;
                }
            }
            await rename(remoteStage, destination);
            root = destination;
            remoteStage = undefined;
        }
        const marketplace = {
            name: detected.name,
            provider: detected.provider,
            root: resolve(root),
            manifestPath: detected.manifestPath,
            plugins: structuredClone(detected.plugins),
        };
        this.state.marketplaces.push(marketplace);
        try {
            await this.writeState();
        }
        catch (error) {
            this.state.marketplaces.pop();
            if (github !== undefined)
                await this.moveToTrash(root);
            throw error;
        }
        return cloneMarketplace(marketplace);
    }
    /** Acquire and activate one `plugin@marketplace` selection transactionally. */
    async install(spec) {
        await this.ensureStarted();
        const separator = spec.lastIndexOf('@');
        if (separator < 1 || separator === spec.length - 1) {
            throw new TypeError('install target must be <plugin>@<marketplace>');
        }
        const name = spec.slice(0, separator);
        const marketplaceName = spec.slice(separator + 1);
        if (this.state.installations.some(item => item.name === name)) {
            throw new Error(`plugin "${name}" is already installed`);
        }
        const marketplace = this.state.marketplaces.find(item => item.name === marketplaceName);
        if (marketplace === undefined)
            throw new Error(`marketplace "${marketplaceName}" is not registered`);
        const entry = marketplace.plugins.find(item => item.name === name);
        if (entry === undefined)
            throw new Error(`plugin "${name}" is not in marketplace "${marketplaceName}"`);
        const destination = join(this.storageDir, 'plugins', marketplaceName, name);
        try {
            await lstat(destination);
            throw new Error(`plugin destination already exists at "${destination}"`);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        const stage = `${destination}.stage-${randomUUID()}`;
        await this.acquireSource(marketplace, entry.source, stage);
        await rejectSymlinks(stage);
        await rename(stage, destination);
        const packageSource = new DirectoryPackageSource(destination);
        let created = [];
        try {
            const detected = this.kernel.detectPackageFormat(packageSource);
            const pluginDataRoot = join(this.storageDir, 'data', marketplaceName, name);
            await mkdir(pluginDataRoot, { recursive: true, mode: 0o700 });
            const materialized = this.kernel.materializePackage(packageSource, detected, { pluginDataRoot });
            if (materialized.rows.length === 0) {
                throw new Error(`plugin "${name}" has no components supported by the active dsh bridge`);
            }
            for (const row of this.rowsAllowedByPolicy(materialized.rows, materialized.activations)) {
                try {
                    await this.loader.create(row);
                    created.push(row.id);
                }
                catch (error) {
                    try {
                        await this.loader.remove(row.id);
                    }
                    catch { /* failed Loader create owns its rollback */ }
                    throw error;
                }
            }
            const installation = {
                name,
                marketplace: marketplaceName,
                format: detected.provider,
                root: destination,
                rows: structuredClone(materialized.rows),
                activations: structuredClone(materialized.activations),
                unsupported: structuredClone(materialized.unsupported),
                ...materialized.diagnostics === undefined
                    ? {}
                    : { diagnostics: structuredClone(materialized.diagnostics) },
                enabled: true,
            };
            this.state.installations.push(installation);
            try {
                await this.writeState();
            }
            catch (error) {
                this.state.installations.pop();
                throw error;
            }
            this.activeRowIds.push(...created);
            return cloneInstallation(installation);
        }
        catch (error) {
            await this.removeRows(created);
            await this.moveToTrash(destination);
            throw error;
        }
    }
    /** Review current gated component definitions without trusting or activating them. */
    async reviewActivations(policyName, pluginName) {
        await this.ensureStarted();
        if (this.kernel.getActivationPolicy(policyName) === undefined) {
            throw new Error(`activation policy "${policyName}" is not registered`);
        }
        const installations = pluginName === undefined
            ? this.state.installations
            : this.state.installations.filter(installation => installation.name === pluginName);
        if (pluginName !== undefined && installations.length === 0) {
            throw new Error(`plugin "${pluginName}" is not installed`);
        }
        const reviews = [];
        for (const installation of installations) {
            const index = this.state.installations.findIndex(item => item.name === installation.name);
            const inspections = await this.refreshInstallationActivations(index, true, true);
            const current = this.state.installations[index];
            for (const requirement of current.activations.filter(item => item.policy === policyName)) {
                const inspection = inspections.get(requirement.rowId)
                    ?? await this.kernel.getActivationPolicy(policyName)
                        .inspect(requirement);
                reviews.push({
                    ...inspection,
                    plugin: current.name,
                    approved: this.isApproved(inspection),
                });
            }
        }
        return reviews.sort((left, right) => compareCodePoints(left.rowId, right.rowId));
    }
    /** Trust and activate the exact current digest; a stale digest is never accepted. */
    async approveActivation(policyName, pluginName, digest) {
        await this.ensureStarted();
        const index = this.state.installations.findIndex(item => item.name === pluginName);
        if (index < 0)
            throw new Error(`plugin "${pluginName}" is not installed`);
        if (this.kernel.getActivationPolicy(policyName) === undefined) {
            throw new Error(`activation policy "${policyName}" is not registered`);
        }
        await this.refreshInstallationActivations(index, true, true);
        const current = this.state.installations[index];
        const matching = current.activations.filter(item => item.policy === policyName && item.digest === digest);
        if (matching.length === 0) {
            throw new Error(`digest "${digest}" does not match the current ${policyName} digest for plugin "${pluginName}"`);
        }
        const previousApprovals = structuredClone(this.state.approvals);
        const created = [];
        try {
            for (const requirement of matching) {
                if (!this.isApproved(requirement)) {
                    this.state.approvals.push({
                        policy: requirement.policy,
                        rowId: requirement.rowId,
                        digest: requirement.digest,
                    });
                }
                if (!current.enabled || this.activeRowIds.includes(requirement.rowId))
                    continue;
                const row = current.rows.find(item => item.id === requirement.rowId);
                if (row === undefined)
                    throw new Error(`gated row "${requirement.rowId}" is not in the installation plan`);
                try {
                    await this.loader.create(row);
                    created.push(row.id);
                }
                catch (error) {
                    try {
                        await this.loader.remove(row.id);
                    }
                    catch { /* failed Loader create owns its rollback */ }
                    throw error;
                }
            }
            await this.writeState();
            this.activeRowIds.push(...created);
        }
        catch (error) {
            this.state.approvals.splice(0, this.state.approvals.length, ...previousApprovals);
            await this.removeRows(created);
            throw error;
        }
    }
    /** Disable one installed plugin while keeping its copied package and row plan. */
    async disable(name) {
        await this.ensureStarted();
        const index = this.state.installations.findIndex(item => item.name === name);
        const current = this.state.installations[index];
        if (current === undefined)
            throw new Error(`plugin "${name}" is not installed`);
        if (!current.enabled)
            return;
        const removed = [];
        try {
            for (const row of [...current.rows].reverse().filter(row => this.activeRowIds.includes(row.id))) {
                await this.loader.remove(row.id);
                removed.push(row.id);
                const activeIndex = this.activeRowIds.indexOf(row.id);
                if (activeIndex >= 0)
                    this.activeRowIds.splice(activeIndex, 1);
            }
            this.state.installations[index] = { ...current, enabled: false };
            await this.writeState();
        }
        catch (error) {
            this.state.installations[index] = current;
            for (const row of current.rows.filter(row => removed.includes(row.id))) {
                await this.loader.create(row);
                this.activeRowIds.push(row.id);
            }
            throw error;
        }
    }
    /** Re-activate the stored row plan for one disabled installation. */
    async enable(name) {
        await this.ensureStarted();
        const index = this.state.installations.findIndex(item => item.name === name);
        const previous = this.state.installations[index];
        if (previous === undefined)
            throw new Error(`plugin "${name}" is not installed`);
        if (previous.enabled)
            return;
        const previousApprovals = structuredClone(this.state.approvals);
        await this.refreshInstallationActivations(index, false, false);
        const current = this.state.installations[index];
        const created = [];
        try {
            for (const row of this.rowsAllowedByPolicy(current.rows, current.activations)) {
                try {
                    await this.loader.create(row);
                    created.push(row.id);
                }
                catch (error) {
                    try {
                        await this.loader.remove(row.id);
                    }
                    catch { /* failed Loader create owns its rollback */ }
                    throw error;
                }
            }
            this.state.installations[index] = { ...current, enabled: true };
            await this.writeState();
            this.activeRowIds.push(...created);
        }
        catch (error) {
            this.state.installations[index] = previous;
            this.state.approvals.splice(0, this.state.approvals.length, ...previousApprovals);
            await this.removeRows(created);
            throw error;
        }
    }
    /** Remove an installation; its package copy moves to the bridge trash directory. */
    async uninstall(name) {
        await this.ensureStarted();
        const index = this.state.installations.findIndex(item => item.name === name);
        if (index < 0)
            throw new Error(`plugin "${name}" is not installed`);
        await this.disable(name);
        const installation = this.state.installations[index];
        const previousApprovals = structuredClone(this.state.approvals);
        const trashed = await this.moveToTrash(installation.root);
        this.state.installations.splice(index, 1);
        const ownedRows = new Set(installation.rows.map(row => row.id));
        const retainedApprovals = this.state.approvals.filter(approval => !ownedRows.has(approval.rowId));
        this.state.approvals.splice(0, this.state.approvals.length, ...retainedApprovals);
        try {
            await this.writeState();
        }
        catch (error) {
            this.state.installations.splice(index, 0, installation);
            this.state.approvals.splice(0, this.state.approvals.length, ...previousApprovals);
            await rename(trashed, installation.root);
            throw error;
        }
    }
    /** Quiesce every row this manager activated without changing durable enablement. */
    async dispose() {
        await this.removeRows([...this.activeRowIds]);
        this.activeRowIds.length = 0;
        this.started = false;
    }
    async ensureStarted() {
        if (!this.started)
            await this.start();
    }
    isApproved(requirement) {
        return this.state.approvals.some(approval => approval.policy === requirement.policy
            && approval.rowId === requirement.rowId
            && approval.digest === requirement.digest);
    }
    rowsAllowedByPolicy(rows, activations) {
        const byRow = new Map(activations.map(requirement => [requirement.rowId, requirement]));
        return rows.filter(row => {
            const requirement = byRow.get(row.id);
            if (requirement === undefined)
                return true;
            return this.kernel.getActivationPolicy(requirement.policy) !== undefined
                && this.isApproved(requirement);
        });
    }
    /** Refresh digests, revoke stale approvals, and quiesce rows whose trust changed. */
    async refreshInstallationActivations(index, reconcileActive, persist) {
        const current = this.state.installations[index];
        if (current === undefined)
            throw new Error('cannot refresh activation policy for a missing installation');
        const previousApprovals = structuredClone(this.state.approvals);
        const inspections = new Map();
        const refreshed = [];
        const failedRows = new Set();
        for (const requirement of current.activations) {
            const policy = this.kernel.getActivationPolicy(requirement.policy);
            if (policy === undefined) {
                refreshed.push(requirement);
                failedRows.add(requirement.rowId);
                continue;
            }
            try {
                const inspection = await policy.inspect(requirement);
                if (inspection.policy !== requirement.policy || inspection.rowId !== requirement.rowId) {
                    throw new Error(`activation policy "${policy.name}" changed requirement identity`);
                }
                inspections.set(requirement.rowId, inspection);
                refreshed.push({
                    policy: requirement.policy,
                    rowId: requirement.rowId,
                    digest: inspection.digest,
                    ...inspection.metadata === undefined ? {} : { metadata: inspection.metadata },
                });
            }
            catch {
                refreshed.push(requirement);
                failedRows.add(requirement.rowId);
            }
        }
        const allowed = new Set(refreshed.map(requirement => `${requirement.policy}\0${requirement.rowId}\0${requirement.digest}`));
        const nextApprovals = previousApprovals.filter(approval => allowed.has(`${approval.policy}\0${approval.rowId}\0${approval.digest}`) && !failedRows.has(approval.rowId));
        const nextInstallation = { ...current, activations: refreshed };
        const nextStateRows = this.rowsAllowedByPolicyWithApprovals(nextInstallation.rows, nextInstallation.activations, nextApprovals);
        const allowedRowIds = new Set(nextStateRows.map(row => row.id));
        const removed = [];
        try {
            if (reconcileActive && current.enabled) {
                for (const row of [...current.rows].reverse()) {
                    if (!this.activeRowIds.includes(row.id) || allowedRowIds.has(row.id))
                        continue;
                    await this.loader.remove(row.id);
                    removed.push(row);
                    const activeIndex = this.activeRowIds.indexOf(row.id);
                    if (activeIndex >= 0)
                        this.activeRowIds.splice(activeIndex, 1);
                }
            }
            this.state.installations[index] = nextInstallation;
            this.state.approvals.splice(0, this.state.approvals.length, ...nextApprovals);
            if (persist)
                await this.writeState();
            return inspections;
        }
        catch (error) {
            this.state.installations[index] = current;
            this.state.approvals.splice(0, this.state.approvals.length, ...previousApprovals);
            for (const row of [...removed].reverse()) {
                await this.loader.create(row);
                this.activeRowIds.push(row.id);
            }
            throw error;
        }
    }
    rowsAllowedByPolicyWithApprovals(rows, activations, approvals) {
        const byRow = new Map(activations.map(requirement => [requirement.rowId, requirement]));
        return rows.filter(row => {
            const requirement = byRow.get(row.id);
            if (requirement === undefined)
                return true;
            return this.kernel.getActivationPolicy(requirement.policy) !== undefined
                && approvals.some(approval => approval.policy === requirement.policy
                    && approval.rowId === requirement.rowId
                    && approval.digest === requirement.digest);
        });
    }
    async acquireSource(marketplace, source, destination) {
        if (source.kind === 'marketplace-relative-directory') {
            const local = resolve(marketplace.root, source.path);
            await rejectSymlinks(local);
            await cp(local, destination, {
                recursive: true,
                errorOnExist: true,
                filter: path => basename(path) !== '.git',
            });
            return;
        }
        const revision = {
            ...source.ref === undefined ? {} : { ref: source.ref },
            ...source.sha === undefined ? {} : { sha: source.sha },
        };
        const acquirer = this.options.git ?? defaultGitAcquirer;
        if (source.kind === 'github-repository') {
            await acquirer.clone(source.repo, destination, revision);
            return;
        }
        const cloneUrl = acquirer.cloneUrl;
        if (cloneUrl === undefined) {
            throw new Error('configured Git acquirer does not support HTTPS URL marketplace sources');
        }
        if (source.subdirectory === undefined) {
            await cloneUrl.call(acquirer, source.url, destination, revision);
            return;
        }
        const repositoryStage = `${destination}.repository-${randomUUID()}`;
        try {
            await cloneUrl.call(acquirer, source.url, repositoryStage, revision);
            const local = resolve(repositoryStage, source.subdirectory);
            if (local !== repositoryStage && !local.startsWith(`${repositoryStage}${sep}`)) {
                throw new TypeError(`Git plugin subdirectory "${source.subdirectory}" escapes its repository`);
            }
            await rejectSymlinks(local);
            await cp(local, destination, {
                recursive: true,
                errorOnExist: true,
                filter: path => basename(path) !== '.git',
            });
        }
        finally {
            await rm(repositoryStage, { recursive: true, force: true });
        }
    }
    async removeRows(ids) {
        const failures = [];
        for (const id of [...ids].reverse()) {
            try {
                await this.loader.remove(id);
            }
            catch (error) {
                failures.push(error);
            }
        }
        if (failures.length === 1)
            throw failures[0];
        if (failures.length > 1)
            throw new AggregateError(failures, 'failed to remove plugin bridge rows');
    }
    statePath() {
        return join(this.storageDir, 'state.json');
    }
    async writeState() {
        await mkdir(this.storageDir, { recursive: true, mode: 0o700 });
        const temporary = join(this.storageDir, `.state-${randomUUID()}.json`);
        await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        await rename(temporary, this.statePath());
    }
    async moveToTrash(path) {
        const trash = join(this.storageDir, 'trash');
        await mkdir(trash, { recursive: true, mode: 0o700 });
        const destination = join(trash, `${basename(path) || 'plugin'}-${randomUUID()}`);
        await rename(path, destination);
        return destination;
    }
}
//# sourceMappingURL=manager.js.map