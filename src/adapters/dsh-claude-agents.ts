import type { Context } from '@deepseek-ai/cordis'
import type { ComponentAdapter, DshPluginRow } from '../kernel.js'
import { insidePlugin, packageName, slug } from './utils.js'

/** Materialize one explicitly imported Claude Code agents directory as a DSH capability producer. */
export const dshClaudeAgentsAdapter: ComponentAdapter = {
  name: 'dsh-claude-agents',
  componentTypes: ['agent'],
  materialize(input): readonly DshPluginRow[] {
    if (input.detected.provider !== 'claude-code-legacy') {
      throw new TypeError(`${input.detected.provider}: agent components have no Claude Code agents bridge`)
    }
    insidePlugin(input, input.component.path)
    const plugin = slug(packageName(input))
    const component = slug(input.component.path.replace(/\/$/u, ''))
    return [{
      id: `plugin-bridge-${plugin}-agent-${component}`,
      name: '@openma/dsh-agents-plugins-bridge/claude-agents',
      config: {
        pluginName: packageName(input),
        pluginRoot: input.source.root,
        componentPath: input.component.path,
        provider: 'spawn',
      },
    }]
  },
}

export const name = 'plugin-bridge-adapter-dsh-claude-agents'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshClaudeAgentsAdapter)
}
