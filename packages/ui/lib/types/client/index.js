/** DSH Web contribution for Agent Plugins bridge settings. */
import { PluginBridgeSettingsTab } from "./PluginBridgeSettingsTab.js";
import { en, zh } from "./locales.js";
import { registerPluginBridgeUi } from "./register.js";
import TYPERT_REMOTE from "./remote.js";
export { PluginBridgeSettingsTab } from "./PluginBridgeSettingsTab.js";
/** Base client services; the Remote namespace is mounted by this plugin. */
export const inject = ['slots', 'locale', 'remote'];
/** Mount the Bridge Remote contribution before registering the settings tab. */
export function apply(ctx) {
    return registerPluginBridgeUi(ctx, TYPERT_REMOTE, PluginBridgeSettingsTab, { zh, en });
}
//# sourceMappingURL=index.js.map