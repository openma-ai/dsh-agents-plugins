import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { DshPluginRow } from './kernel.js'
import {
  PluginBridgeManager,
  type BridgeLoader,
  type ActivationReview,
  type InstalledPlugin,
  type LocalPluginDiscovery,
  type PluginAutoUpdateReport,
  type RegisteredMarketplace,
  type RegisteredMarketplaceDiscovery,
} from './manager.js'
import {
  PiUpdateController,
  createPiNativePackageManager,
  type ImportedPiPackage,
  type PiUpdateMode,
  type PiUpdateStatus,
} from './pi-updates.js'

interface ImportedInstallationSourceView {
  readonly source?: {
    readonly locator: string
    readonly upstreamSource?: string
  }
}

/** Select native Pi package identities from durable Bridge imports. */
export function listImportedPiPackages(
  installations: readonly ImportedInstallationSourceView[],
): readonly ImportedPiPackage[] {
  const imported: ImportedPiPackage[] = []
  for (const installation of installations) {
    const source = installation.source
    if (source?.upstreamSource === undefined) continue
    if (source.locator === 'pi-installed-user') {
      imported.push({ source: source.upstreamSource, scope: 'user' })
    } else if (source.locator === 'pi-installed-project') {
      imported.push({ source: source.upstreamSource, scope: 'project' })
    }
  }
  return imported
}

export const name = 'plugin-bridge-runtime'
export const inject = ['pluginBridge', 'loader']

/** Optional profile-local storage override. */
export interface Config {
  readonly storageDir?: string
  /** Poll supported hosts' installed package state; zero disables automatic reconciliation. */
  readonly autoUpdateIntervalMs?: number
  /** Ask Pi for native package updates at this interval; zero disables background checks. */
  readonly piUpdateCheckIntervalMs?: number
  /** Project directory used for Pi's project-scoped package settings. */
  readonly piCwd?: string
}

/** Start best-effort reconciliation and return its lifecycle cleanup. */
export function startPluginAutoUpdates(
  sync: () => Promise<void>,
  intervalMs: number,
): () => Promise<void> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError('plugin auto-update interval must be a positive finite number')
  }
  let stopped = false
  let inFlight: Promise<void> | undefined
  const tick = (): void => {
    if (stopped || inFlight !== undefined) return
    const task = Promise.resolve().then(sync).catch(() => {
      // The runtime callback owns diagnostics; the scheduler only prevents an unhandled rejection.
    })
    inFlight = task
    void task.then(() => {
      if (inFlight === task) inFlight = undefined
    })
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}

interface LoaderService {
  create(options: DshPluginRow): Promise<string>
  remove(id: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginBridgeRuntime: PluginBridgeRuntime
  }
}

/** Cordis service facade over the persistent marketplace and installation manager. */
export class PluginBridgeRuntime extends Service {
  private readonly manager: PluginBridgeManager
  private readonly piUpdates: PiUpdateController

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pluginBridgeRuntime')
    const loader = ctx.get('loader') as unknown as LoaderService | undefined
    if (loader === undefined) throw new Error('plugin-bridge-runtime: Loader service is unavailable')
    const bridgeLoader: BridgeLoader = {
      create: row => loader.create(row),
      remove: id => loader.remove(id),
    }
    const storageDir = config.storageDir
      ?? fileURLToPath(new URL('.plugin-bridge/', ctx.baseUrl ?? new URL('.', import.meta.url).href))
    this.manager = new PluginBridgeManager(ctx.pluginBridge, bridgeLoader, storageDir)
    const piCheckInterval = config.piUpdateCheckIntervalMs === undefined || config.piUpdateCheckIntervalMs === 0
      ? 6 * 60 * 60 * 1_000
      : config.piUpdateCheckIntervalMs
    this.piUpdates = new PiUpdateController({
      storageDir,
      nativeManager: createPiNativePackageManager(config.piCwd ?? process.cwd()),
      listImportedPackages: () => listImportedPiPackages(this.manager.listInstallations()),
      reconcile: async () => { await this.manager.syncImportedPlugins() },
      checkIntervalMs: piCheckInterval,
    })
  }

  async start(): Promise<void> {
    await this.manager.start()
    try {
      // Reconcile first so legacy imports acquire their native source identity
      // before Pi's initial update check filters the imported package set.
      await this.manager.syncImportedPlugins()
      await this.piUpdates.start()
    } catch (error: unknown) {
      await this.manager.dispose()
      throw error
    }
  }

  listMarketplaces(): readonly RegisteredMarketplace[] {
    return this.manager.listMarketplaces()
  }

  listInstallations(): readonly InstalledPlugin[] {
    return this.manager.listInstallations()
  }

  addMarketplace(location: string): Promise<RegisteredMarketplace> {
    return this.manager.addMarketplace(location)
  }

  install(spec: string): Promise<InstalledPlugin> {
    return this.manager.install(spec)
  }

  discoverLocalPlugins(): Promise<LocalPluginDiscovery> {
    return this.manager.discoverLocalPlugins()
  }

  importLocalPlugin(ref: string): Promise<InstalledPlugin> {
    return this.manager.importLocalPlugin(ref)
  }

  syncImportedPlugins(): Promise<PluginAutoUpdateReport> {
    return this.manager.syncImportedPlugins()
  }

  piUpdateStatus(): PiUpdateStatus {
    return this.piUpdates.status()
  }

  checkPiUpdates(): Promise<PiUpdateStatus> {
    return this.piUpdates.checkNow()
  }

  runScheduledPiUpdateCheck(): Promise<PiUpdateStatus> {
    return this.piUpdates.runScheduledCheck()
  }

  setPiUpdateMode(mode: PiUpdateMode): Promise<PiUpdateStatus> {
    return this.piUpdates.setMode(mode)
  }

  setPiPackageAutoUpdate(id: string, enabled: boolean): Promise<PiUpdateStatus> {
    return this.piUpdates.setPackageAutoUpdate(id, enabled)
  }

  updatePiPackage(id: string): Promise<PiUpdateStatus> {
    return this.piUpdates.updatePackage(id)
  }

  updateAllPiPackages(): Promise<PiUpdateStatus> {
    return this.piUpdates.updateAll()
  }

  discoverRegisteredMarketplaces(): Promise<RegisteredMarketplaceDiscovery> {
    return this.manager.discoverRegisteredMarketplaces()
  }

  importRegisteredMarketplace(ref: string): Promise<RegisteredMarketplace> {
    return this.manager.importRegisteredMarketplace(ref)
  }

  reviewActivations(policy: string, plugin?: string): Promise<readonly ActivationReview[]> {
    return this.manager.reviewActivations(policy, plugin)
  }

  approveActivation(policy: string, plugin: string, digest: string): Promise<void> {
    return this.manager.approveActivation(policy, plugin, digest)
  }

  disable(pluginName: string): Promise<void> {
    return this.manager.disable(pluginName)
  }

  enable(pluginName: string): Promise<void> {
    return this.manager.enable(pluginName)
  }

  uninstall(pluginName: string): Promise<void> {
    return this.manager.uninstall(pluginName)
  }

  dispose(): Promise<void> {
    return this.manager.dispose()
  }
}

/** Publish the runtime only after all persisted rows activate successfully. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const runtime = new PluginBridgeRuntime(ctx, config)
  await runtime.start()
  const intervalMs = config.autoUpdateIntervalMs ?? 300_000
  const stopAutoUpdates = intervalMs === 0
    ? async () => undefined
    : startPluginAutoUpdates(async () => {
        try {
          const report = await runtime.syncImportedPlugins()
          for (const update of report.updated) {
            ctx.logger.info(
              `plugin bridge updated ${update.name} from ${update.fromVersion ?? 'unknown'} to ${update.toVersion ?? 'unknown'}`,
            )
          }
          for (const diagnostic of report.diagnostics) ctx.logger.warn(`plugin bridge auto-update: ${diagnostic}`)
        } catch (error: unknown) {
          ctx.logger.warn(`plugin bridge auto-update failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }, intervalMs)
  const piUpdateCheckIntervalMs = config.piUpdateCheckIntervalMs ?? 6 * 60 * 60 * 1_000
  const stopPiUpdateChecks = piUpdateCheckIntervalMs === 0
    ? async () => undefined
    : startPluginAutoUpdates(async () => {
        try {
          const status = await runtime.runScheduledPiUpdateCheck()
          if (status.updates.length > 0) {
            ctx.logger.info(`plugin bridge found ${status.updates.length} Pi package update(s)`)
          }
        } catch (error: unknown) {
          ctx.logger.warn(`plugin bridge Pi update check failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }, piUpdateCheckIntervalMs)
  ctx.effect(() => async () => {
    await stopAutoUpdates()
    await stopPiUpdateChecks()
    await runtime.dispose()
  }, 'plugin-bridge-runtime rows, reconciliation, and Pi update checks')
}
