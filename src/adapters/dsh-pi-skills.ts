import type { Context } from '@deepseek-ai/cordis'
import type { ComponentAdapter } from '../kernel.js'
import { packageName, slug } from './utils.js'

function entries(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new TypeError('pi-package: skill component entries must be an array of strings')
  }
  return value as readonly string[]
}

/** Preserve Pi's exact recursive/path-expression semantics behind a dedicated DSH skill producer. */
export const dshPiSkillsAdapter: ComponentAdapter = {
  name: 'dsh-pi-skills',
  componentTypes: ['pi-skill-set'],
  materialize(input) {
    if (input.detected.provider !== 'pi-package') {
      throw new TypeError(`${input.detected.provider}: pi skill components require the Pi adapter`)
    }
    const plugin = slug(packageName(input))
    return [{
      id: `plugin-bridge-${plugin}-pi-skills`,
      name: '@openma/dsh-agents-plugins-bridge/pi-skills',
      config: {
        providerName: `plugin-bridge-${plugin}-pi-skills`,
        pluginRoot: input.source.root,
        entries: entries(input.component.metadata?.entries),
      },
    }]
  },
}

export const name = 'plugin-bridge-adapter-dsh-pi-skills'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshPiSkillsAdapter)
}
