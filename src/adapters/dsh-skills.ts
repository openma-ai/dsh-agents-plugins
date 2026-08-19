import type { Context } from '@deepseek-ai/cordis'
import type { ComponentAdapter } from '../kernel.js'
import { insidePlugin, packageName, slug } from './utils.js'

/** Materialize one foreign skill root as an isolated dsh filesystem provider row. */
export const dshSkillsAdapter: ComponentAdapter = {
  name: 'dsh-skills',
  componentTypes: ['skill'],
  materialize(input) {
    const plugin = slug(packageName(input))
    const component = slug(input.component.path.replace(/\/$/u, ''))
    return [{
      id: `plugin-bridge-${plugin}-skill-${component}`,
      name: '@deepseek-ai/dsh-skill-filesystem',
      config: {
        providerName: `plugin-bridge-${plugin}-${component}`,
        includeDefaultRoots: false,
        bundledSkillDir: insidePlugin(input, input.component.path),
      },
    }]
  },
}

export const name = 'plugin-bridge-adapter-dsh-skills'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshSkillsAdapter)
}
