import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { ComponentAdapter } from '../kernel.js'
import { insidePlugin, packageName, slug } from './utils.js'

/** Materialize Codex and Claude Code hook files through dsh's native dialect bridges. */
export const dshHooksAdapter: ComponentAdapter = {
  name: 'dsh-hooks',
  componentTypes: ['hook'],
  materialize(input) {
    const plugin = slug(packageName(input))
    const configPath = insidePlugin(input, input.component.path)
    const pluginRoot = insidePlugin(input, '.')
    const pluginData = input.pluginDataRoot === undefined ? undefined : resolve(input.pluginDataRoot)
    const siblingHooks = input.detected.components.filter(component => component.type === 'hook')
    const componentSuffix = siblingHooks.length > 1 ? `-${slug(input.component.path)}` : ''
    const definition = input.component.manifestField === undefined
      ? input.source.readText?.(input.component.path)
        ?? JSON.stringify(input.source.readJson(input.component.path))
      : JSON.stringify(
        (input.source.readJson(input.component.path) as Record<string, unknown>)[input.component.manifestField],
      )
    const digest = createHash('sha256').update(definition).digest('hex')
    const activation = (rowId: string) => ({
      policy: 'hook-user-approval',
      rowId,
      digest,
      metadata: {
        configPath,
        componentPath: input.component.path,
        pluginName: packageName(input),
        ...input.component.manifestField === undefined
          ? {}
          : { manifestField: input.component.manifestField },
      },
    })
    if (input.detected.provider === 'codex-legacy') {
      const row = {
        id: `plugin-bridge-${plugin}-hook-codex${componentSuffix}`,
        name: '@deepseek-ai/dsh-hooks-codex',
        config: {
          configPath,
          pluginRoot,
          ...pluginData === undefined ? {} : { pluginData },
        },
      }
      return { rows: [row], activations: [activation(row.id)] }
    }
    if (input.detected.provider === 'claude-code-legacy') {
      const row = {
        id: `plugin-bridge-${plugin}-hook-claude-code${componentSuffix}`,
        name: '@deepseek-ai/dsh-hooks-claude-code',
        config: {
          configPath,
          pluginRoot,
          ...pluginData === undefined ? {} : { pluginData },
        },
      }
      return { rows: [row], activations: [activation(row.id)] }
    }
    throw new TypeError(`${input.detected.provider}: hook components have no dsh dialect bridge`)
  },
}

export const name = 'plugin-bridge-adapter-dsh-hooks'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshHooksAdapter)
}
