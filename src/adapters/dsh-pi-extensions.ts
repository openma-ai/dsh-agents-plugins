import type { Context } from '@deepseek-ai/cordis'
import type { ComponentAdapter } from '../kernel.js'
import { resolvePiExtensionFiles } from '../pi-extension-files.js'
import { insidePlugin, packageName, slug } from './utils.js'

function entries(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new TypeError('pi-package: extension component entries must be an array of strings')
  }
  return value as readonly string[]
}

/** Materialize executable Pi modules behind one independently disableable compatibility-host row. */
export const dshPiExtensionsAdapter: ComponentAdapter = {
  name: 'dsh-pi-extensions',
  componentTypes: ['pi-extension-set'],
  materialize(input) {
    if (input.detected.provider !== 'pi-package') {
      throw new TypeError(`${input.detected.provider}: Pi extensions require the Pi adapter`)
    }
    const pluginName = packageName(input)
    const pluginRoot = insidePlugin(input, '.')
    const componentEntries = entries(input.component.metadata?.entries)
    for (const entry of componentEntries) {
      if (!entry.startsWith('!')) insidePlugin(input, entry)
    }
    const files = resolvePiExtensionFiles(pluginRoot, componentEntries)
    if (files.length === 0) {
      return {
        rows: [],
        diagnostics: [`pi-package: no loadable .ts or .js extension files matched ${componentEntries.join(', ')}`],
      }
    }
    return {
      rows: [{
        id: `plugin-bridge-${slug(pluginName)}-pi-extensions`,
        name: '@openma/dsh-agents-plugins-bridge/pi-extension-host',
        config: {
          pluginName,
          pluginRoot,
          entries: componentEntries,
          ...input.pluginDataRoot === undefined ? {} : { pluginData: input.pluginDataRoot },
        },
      }],
    }
  },
}

export const name = 'plugin-bridge-adapter-dsh-pi-extensions'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshPiExtensionsAdapter)
}
