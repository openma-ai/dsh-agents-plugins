import type { PluginBridgeRemoteApi } from '../types.ts'
import type { PluginBridgeView } from '../types.ts'
import {
  loadPluginBridgeDiscoveries,
  loadPluginBridgeView,
  unwrapPluginBridgeMutation,
} from './view-model.ts'

export const PLUGIN_BRIDGE_LOCALE = 'settings.pluginBridge'

interface RemoteContribution {
  readonly package: string
  readonly descriptors: readonly unknown[]
}

interface RegistrationContext {
  readonly remote: {
    $mount(contribution: RemoteContribution): Promise<() => Promise<void>>
    readonly agentPluginsBridge: PluginBridgeRemoteApi
  }
  readonly locale: {
    register(namespace: string, dictionaries: unknown): unknown
    bind(namespace: string): (key: string) => string
  }
  readonly slots: {
    inject(name: string, factory: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  effect(factory: () => unknown, label?: string): unknown
  inject(services: readonly string[], callback: (scope: RegistrationContext) => void): unknown
}

/** Data injected into the Bridge-owned Plugins settings tab. */
export interface PluginBridgeSettingsTabInjected {
  readonly load: () => Promise<PluginBridgeView>
  readonly rescan: () => Promise<PluginBridgeView>
  readonly addMarketplace: (location: string) => Promise<PluginBridgeView>
  readonly importMarketplace: (ref: string) => Promise<PluginBridgeView>
  readonly importLocal: (ref: string) => Promise<PluginBridgeView>
  readonly install: (name: string, marketplace: string) => Promise<PluginBridgeView>
  readonly setEnabled: (name: string, enabled: boolean) => Promise<PluginBridgeView>
}

/** Project the Remote namespace into callback-only component injection. */
export function createPluginBridgeSettingsFace(api: PluginBridgeRemoteApi): PluginBridgeSettingsTabInjected {
  const load = (): Promise<PluginBridgeView> => loadPluginBridgeView(api)
  const mutate = async (
    endpoint: string,
    operation: () => ReturnType<PluginBridgeRemoteApi['snapshot']>,
  ): Promise<PluginBridgeView> => {
    const snapshot = unwrapPluginBridgeMutation(endpoint, await operation())
    return await loadPluginBridgeDiscoveries(api, snapshot)
  }
  return {
    load,
    rescan: load,
    addMarketplace: location => mutate('addMarketplace', () => api.addMarketplace(location)),
    importMarketplace: ref => mutate('importMarketplace', () => api.importMarketplace(ref)),
    importLocal: ref => mutate('importLocal', () => api.importLocal(ref)),
    install: (name, marketplace) => mutate('installPlugin', () => api.installPlugin(name, marketplace)),
    setEnabled: (name, enabled) => mutate('setEnabled', () => api.setEnabled(name, enabled)),
  }
}

/** Mount the external Remote descriptor, then contribute the settings tab. */
export async function registerPluginBridgeUi(
  ctx: RegistrationContext,
  contribution: RemoteContribution,
  component: unknown,
  dictionaries: unknown,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  ctx.inject(['remote.agentPluginsBridge'], (scope) => {
    // Cordis service getters are scoped to this injection callback. Capture
    // the generated face now; the slot calls its `inject` option later while
    // rendering, after this service scope has closed.
    const api = scope.remote.agentPluginsBridge
    scope.effect(
      () => scope.locale.register(PLUGIN_BRIDGE_LOCALE, dictionaries),
      'plugin-bridge-ui: dictionaries',
    )
    const t = scope.locale.bind(PLUGIN_BRIDGE_LOCALE)
    scope.slots.inject('settings.plugins.tab', () => scope.slots.register({
      name: 'settings.plugins.tab',
      id: 'agent-plugins',
      order: 5,
      label: () => t('tab'),
      locale: PLUGIN_BRIDGE_LOCALE,
      inject: (): PluginBridgeSettingsTabInjected => createPluginBridgeSettingsFace(api),
    }, component))
  })
  return disposeRemote
}
