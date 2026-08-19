import type { Context } from '@deepseek-ai/cordis'
import type { ComponentAdapter, DshPluginRow } from '../kernel.js'
import { insidePlugin, packageName, slug } from './utils.js'

function dialect(provider: string): 'claude-code' | 'pi' {
  if (provider === 'claude-code-legacy') return 'claude-code'
  if (provider === 'pi-package') return 'pi'
  throw new TypeError(`${provider}: prompt command components have no dsh dialect bridge`)
}

/** Materialize foreign prompt-command declarations as one disposable DSH command producer. */
export const dshPromptCommandsAdapter: ComponentAdapter = {
  name: 'dsh-prompt-commands',
  componentTypes: ['command', 'pi-prompt-set'],
  materialize(input): readonly DshPluginRow[] {
    const plugin = slug(packageName(input))
    const kind = input.component.type === 'command' ? 'command' : 'prompt'
    const component = input.component.type === 'command'
      ? slug(input.component.path.replace(/\/$/u, ''))
      : 'prompts'
    const componentEntries = input.component.type === 'command'
      ? undefined
      : entries(input.component.metadata?.entries)
    // Resolve once at materialization time so an escaping path fails before a row exists.
    for (const entry of componentEntries ?? [input.component.path]) {
      if (!entry.startsWith('!')) insidePlugin(input, entry)
    }
    return [{
      id: `plugin-bridge-${plugin}-${kind}-${component}`,
      name: '@openma/dsh-agents-plugins-bridge/prompt-commands',
      config: {
        dialect: dialect(input.detected.provider),
        pluginName: packageName(input),
        pluginRoot: input.source.root,
        ...componentEntries === undefined
          ? { componentPath: input.component.path }
          : { entries: componentEntries },
        ...input.pluginDataRoot === undefined ? {} : { pluginData: input.pluginDataRoot },
      },
    }]
  },
}

function entries(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new TypeError('pi-package: prompt component entries must be an array of strings')
  }
  return value as readonly string[]
}

export const name = 'plugin-bridge-adapter-dsh-prompt-commands'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshPromptCommandsAdapter)
}
