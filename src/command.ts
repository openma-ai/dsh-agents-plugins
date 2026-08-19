import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { PluginBridgeKernel } from './kernel.js'
import type { PluginBridgeManagement } from './manager.js'

export const name = 'plugin-bridge-command'
export const inject = ['commands', 'pluginBridge', 'pluginBridgeRuntime']

const USAGE = [
  'Usage:',
  '/plugin-bridge marketplace add <path-or-url>',
  '/plugin-bridge marketplace discover',
  '/plugin-bridge marketplace import <locator:key>',
  '/plugin-bridge marketplace list',
  '/plugin-bridge install <plugin>@<marketplace>',
  '/plugin-bridge discover',
  '/plugin-bridge import <locator:key>',
  '/plugin-bridge enable <plugin>',
  '/plugin-bridge disable <plugin>',
  '/plugin-bridge uninstall <plugin>',
].join('\n')

function names(values: readonly { readonly name: string }[]): string {
  return values.length === 0 ? '(none)' : values.map(value => value.name).join(', ')
}

function withDiagnostics(lines: readonly string[], diagnostics: readonly string[]): string {
  const output = [...lines]
  if (diagnostics.length > 0) output.push('Diagnostics:', ...diagnostics.map(item => `- ${item}`))
  return output.join('\n')
}

function installationText(action: string, plugin: Awaited<ReturnType<PluginBridgeManagement['install']>>): string {
  const unsupported = plugin.unsupported.length === 0
    ? ''
    : ` Unsupported components: ${plugin.unsupported.map(item => `${item.type}:${item.path}`).join(', ')}`
  const diagnostics = plugin.diagnostics === undefined || plugin.diagnostics.length === 0
    ? ''
    : ` Diagnostics: ${plugin.diagnostics.join(' | ')}`
  return `${action} as ${plugin.rows.length} dsh row(s).${unsupported}${diagnostics}`
}

/** Execute one human-facing bridge management command without a model turn. */
export function executePluginBridgeCommand(
  kernel: PluginBridgeKernel,
  rawInput: string,
  runtime?: PluginBridgeManagement,
): CommandResult | Promise<CommandResult> {
  const input = rawInput.trim().replace(/\s+/gu, ' ')
  if (input.length === 0) {
    return {
      kind: 'success',
      text: [
        'Plugin Bridge',
        `Marketplaces: ${names(kernel.listMarketplaceProviders())}`,
        `Package formats: ${names(kernel.listPackageFormatProviders())}`,
        `Component adapters: ${names(kernel.listComponentAdapters())}`,
        `Installed discovery: ${names(kernel.listInstalledPluginLocators())}`,
        `Marketplace discovery: ${names(kernel.listMarketplaceRegistrationLocators())}`,
        `Activation policies: ${names(kernel.listActivationPolicies())}`,
        '',
        USAGE,
      ].join('\n'),
    }
  }
  if (input === 'marketplace list') {
    if (runtime !== undefined) {
      const marketplaces = runtime.listMarketplaces()
      return marketplaces.length === 0
        ? { kind: 'success', text: 'No marketplaces are configured.' }
        : {
            kind: 'success',
            text: marketplaces
              .map(marketplace => `${marketplace.name}\t${marketplace.provider}\t${marketplace.root}`)
              .join('\n'),
          }
    }
    const marketplaces = kernel.listMarketplaceProviders()
    return marketplaces.length === 0
      ? { kind: 'success', text: 'No marketplace providers are registered.' }
      : { kind: 'success', text: marketplaces.map(provider => provider.name).join('\n') }
  }
  const addMarketplace = /^marketplace add (.+)$/u.exec(input)
  if (addMarketplace?.[1] !== undefined) {
    if (runtime === undefined) return unavailable()
    return runtime.addMarketplace(addMarketplace[1]).then(marketplace => ({
      kind: 'success',
      text: `Added marketplace ${marketplace.name} (${marketplace.provider}).`,
    }))
  }
  if (input === 'marketplace discover') {
    if (runtime === undefined) return unavailable()
    return runtime.discoverRegisteredMarketplaces().then(result => {
      const lines = result.candidates.map(candidate => [
        candidate.ref,
        candidate.name,
        candidate.sourceType,
        candidate.location,
      ].join('\t'))
      if (lines.length === 0 && result.diagnostics.length === 0) {
        return { kind: 'success', text: 'No registered marketplaces were discovered.' }
      }
      return { kind: 'success', text: withDiagnostics(lines, result.diagnostics) }
    })
  }
  const importMarketplace = /^marketplace import (\S+)$/u.exec(input)
  if (importMarketplace?.[1] !== undefined) {
    if (runtime === undefined) return unavailable()
    return runtime.importRegisteredMarketplace(importMarketplace[1]).then(marketplace => ({
      kind: 'success',
      text: `Imported marketplace ${marketplace.name} (${marketplace.provider}).`,
    }))
  }
  const install = /^install (\S+)$/u.exec(input)
  if (install?.[1] !== undefined) {
    if (runtime === undefined) return unavailable()
    return runtime.install(install[1]).then((plugin) => {
      return {
        kind: 'success',
        text: installationText(`Installed ${plugin.name} from ${plugin.marketplace}`, plugin),
      }
    })
  }
  if (input === 'discover') {
    if (runtime === undefined) return unavailable()
    return runtime.discoverLocalPlugins().then(result => {
      const lines = result.candidates.map(candidate => [
        candidate.ref,
        candidate.name,
        candidate.version ?? '-',
        candidate.evidence,
        candidate.enabled === undefined ? 'unknown' : candidate.enabled ? 'enabled' : 'disabled',
        candidate.root,
      ].join('\t'))
      if (lines.length === 0 && result.diagnostics.length === 0) {
        return { kind: 'success', text: 'No local plugins were discovered.' }
      }
      return { kind: 'success', text: withDiagnostics(lines, result.diagnostics) }
    })
  }
  const importPlugin = /^import (\S+)$/u.exec(input)
  if (importPlugin?.[1] !== undefined) {
    if (runtime === undefined) return unavailable()
    return runtime.importLocalPlugin(importPlugin[1]).then(plugin => ({
      kind: 'success',
      text: installationText(
        `Imported ${plugin.name} from ${plugin.marketplace.replace(/^import:/u, '')}`,
        plugin,
      ),
    }))
  }
  const disable = /^disable (\S+)$/u.exec(input)
  if (disable?.[1] !== undefined) {
    if (runtime === undefined) return unavailable()
    return runtime.disable(disable[1]).then(() => ({ kind: 'success', text: `Disabled ${disable[1]}.` }))
  }
  const enable = /^enable (\S+)$/u.exec(input)
  if (enable?.[1] !== undefined) {
    if (runtime === undefined) return unavailable()
    return runtime.enable(enable[1]).then(() => ({ kind: 'success', text: `Enabled ${enable[1]}.` }))
  }
  const uninstall = /^uninstall (\S+)$/u.exec(input)
  if (uninstall?.[1] !== undefined) {
    if (runtime === undefined) return unavailable()
    return runtime.uninstall(uninstall[1]).then(() => ({ kind: 'success', text: `Uninstalled ${uninstall[1]}.` }))
  }
  return {
    kind: 'error',
    text: `Unsupported plugin bridge command.\n${USAGE}`,
  }
}

function unavailable(): CommandResult {
  return { kind: 'error', text: 'Plugin Bridge runtime is unavailable.' }
}

/** Register `/plugin-bridge` on every composed dsh command adapter. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'plugin-bridge',
    description: 'manage portable agent plugin marketplaces and installations',
    input: { hint: '[marketplace|install|discover|import|enable|disable|uninstall] ...' },
    handler: invocation => executePluginBridgeCommand(
      ctx.pluginBridge,
      invocation.rawInput,
      ctx.pluginBridgeRuntime,
    ),
  })
}
