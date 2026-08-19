import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ComponentAdapter, DshPluginRow } from '../kernel.js'
import { boundedName, componentJson, insidePlugin, packageName, record, slug } from './utils.js'

function strings(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${label} must be an array of strings`)
  }
  return value as string[]
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {}
  const object = record(value, label)
  for (const [key, item] of Object.entries(object)) {
    if (typeof item !== 'string') throw new TypeError(`${label}.${key} must be a string`)
  }
  return object as Record<string, string>
}

function expand(value: string, pluginRoot: string, pluginData: string | undefined): string {
  return value
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot)
    .replaceAll('${CLAUDE_PLUGIN_DATA}', pluginData ?? '${CLAUDE_PLUGIN_DATA}')
}

/** Map Claude's declarative stdio LSP table onto DSH's generic LSP provider seam. */
export const dshLspAdapter: ComponentAdapter = {
  name: 'dsh-lsp',
  componentTypes: ['lsp-server'],
  materialize(input) {
    if (input.detected.provider !== 'claude-code-legacy') {
      throw new TypeError(`${input.detected.provider}: LSP components require the Claude Code adapter`)
    }
    const raw = record(componentJson(input), `claude-code-legacy: ${input.component.path}`)
    const servers = record(raw.lspServers ?? raw, 'claude-code-legacy: lspServers')
    const pluginRoot = insidePlugin(input, '.')
    const plugin = slug(packageName(input))
    const rows: DshPluginRow[] = []
    const diagnostics: string[] = []
    for (const serverName of Object.keys(servers).sort()) {
      try {
        const label = `claude-code-legacy: lspServers.${serverName}`
        const server = record(servers[serverName], label)
        if (typeof server.command !== 'string' || server.command.trim().length === 0) {
          throw new TypeError(`${label}.command must be a non-empty string`)
        }
        const extensionToLanguage = stringRecord(server.extensionToLanguage, `${label}.extensionToLanguage`)
        if (Object.keys(extensionToLanguage).length === 0) {
          throw new TypeError(`${label}.extensionToLanguage must contain at least one mapping`)
        }
        if (server.workspaceFolder !== undefined) {
          if (typeof server.workspaceFolder !== 'string') throw new TypeError(`${label}.workspaceFolder must be a string`)
          diagnostics.push(`${label}.workspaceFolder is handled by DSH per query`)
        }
        if (server.startupTimeout !== undefined) {
          diagnostics.push(`${label}.startupTimeout has no DSH provider setting and was ignored`)
        }
        const commandValue = expand(server.command, pluginRoot, input.pluginDataRoot)
        const command = commandValue.startsWith('./') && !isAbsolute(commandValue)
          ? resolve(pluginRoot, commandValue)
          : commandValue
        const args = strings(server.args, `${label}.args`)
          .map(value => expand(value, pluginRoot, input.pluginDataRoot))
        if (args.some(value => value.includes('${CLAUDE_PROJECT_DIR}'))) {
          throw new TypeError(`${label}.args cannot embed CLAUDE_PROJECT_DIR; DSH selects workspace per query`)
        }
        const env = Object.fromEntries(Object.entries(stringRecord(server.env, `${label}.env`))
          .map(([key, value]) => [key, expand(value, pluginRoot, input.pluginDataRoot)]))
        const providerId = boundedName(`plugin-bridge-${plugin}-${serverName}`, 64)
        const config: Record<string, unknown> = {
          command,
          args,
          env,
          extensionToLanguage,
        }
        if (server.initializationOptions !== undefined) config.initializationOptions = server.initializationOptions
        if (server.configuration !== undefined) config.configuration = server.configuration
        if (server.shutdownTimeout !== undefined) {
          if (typeof server.shutdownTimeout !== 'number') throw new TypeError(`${label}.shutdownTimeout must be a number`)
          config.shutdownTimeoutMs = server.shutdownTimeout
        }
        rows.push({
          id: `plugin-bridge-${plugin}-lsp-${slug(serverName)}`,
          name: '@deepseek-ai/dsh-lsp-stdio',
          config: { servers: { [providerId]: config } },
        })
      } catch (error: unknown) {
        diagnostics.push(`claude-code-legacy: skipped LSP server "${serverName}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return {
      rows,
      ...diagnostics.length === 0 ? {} : { diagnostics },
    }
  },
}

export const name = 'plugin-bridge-adapter-dsh-lsp'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshLspAdapter)
}
