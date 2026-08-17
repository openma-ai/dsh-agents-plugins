/** DSH Web contribution for Agent Plugins bridge settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginBridgeSettingsTab } from './PluginBridgeSettingsTab.tsx'
import { en, zh } from './locales.ts'
import { registerPluginBridgeUi } from './register.ts'
import TYPERT_REMOTE from './remote.ts'

export { PluginBridgeSettingsTab, type PluginBridgeSettingsTabProps } from './PluginBridgeSettingsTab.tsx'
export type { PluginBridgeSettingsTabInjected } from './register.ts'

/** Base client services; the Remote namespace is mounted by this plugin. */
export const inject = ['slots', 'locale', 'remote']

/** Mount the Bridge Remote contribution before registering the settings tab. */
export function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return registerPluginBridgeUi(ctx as never, TYPERT_REMOTE, PluginBridgeSettingsTab, { zh, en })
}
