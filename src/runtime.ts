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
  type RegisteredMarketplace,
  type RegisteredMarketplaceDiscovery,
} from './manager.js'

export const name = 'plugin-bridge-runtime'
export const inject = ['pluginBridge', 'loader']

/** Optional profile-local storage override. */
export interface Config {
  readonly storageDir?: string
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
  }

  start(): Promise<void> {
    return this.manager.start()
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
  ctx.effect(() => () => runtime.dispose(), 'plugin-bridge-runtime rows')
}
