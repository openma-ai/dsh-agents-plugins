import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ComponentAdapter,
  ComponentAdapterMaterialization,
  DshPluginRow,
  RuntimeRequirement,
} from '../kernel.js'
import {
  boundedName,
  componentJson,
  insidePlugin,
  packageName,
  record,
  slug,
} from './utils.js'

const RELAY_CLI = fileURLToPath(new URL('../codex-host-relay-cli.js', import.meta.url))

function bundledMcpServerNames(
  input: Parameters<ComponentAdapter['materialize']>[0],
): ReadonlySet<string> {
  const names = new Set<string>()
  for (const component of input.detected.components) {
    if (component.type !== 'mcp-server') continue
    const raw = record(componentJson({ ...input, component }), `${input.detected.provider}: ${component.path}`)
    const servers = record(
      raw.mcpServers ?? raw.mcp_servers ?? raw,
      `${input.detected.provider}: mcpServers`,
    )
    for (const server of Object.keys(servers)) names.add(server)
  }
  return names
}

function appMaterialization(
  input: Parameters<ComponentAdapter['materialize']>[0],
): ComponentAdapterMaterialization {
  if (input.detected.provider !== 'codex-legacy') {
    throw new TypeError(`${input.detected.provider}: registered App connections require the Codex adapter`)
  }
  const document = record(componentJson(input), 'codex-legacy: .app.json')
  const apps = record(document.apps, 'codex-legacy: .app.json apps')
  const bundledServers = bundledMcpServerNames(input)
  const rows: DshPluginRow[] = []
  const requirements: RuntimeRequirement[] = []
  const plugin = slug(packageName(input))
  const cwd = insidePlugin(input, '.')
  for (const app of Object.keys(apps).sort()) {
    const definition = record(apps[app], `codex-legacy: .app.json apps.${app}`)
    if (typeof definition.id !== 'string' || definition.id.trim().length === 0) {
      throw new TypeError(`codex-legacy: .app.json apps.${app}.id must be a non-empty string`)
    }
    if (definition.required !== undefined && typeof definition.required !== 'boolean') {
      throw new TypeError(`codex-legacy: .app.json apps.${app}.required must be a boolean`)
    }
    if (bundledServers.has(app)) continue
    const connectionId = definition.id.trim()
    const serverName = boundedName(`${plugin}-codex-${app}`, 32)
    const rowId = `plugin-bridge-${plugin}-codex-app-${slug(app)}`
    const relay = {
      appName: app,
      connectionId,
      cwd,
    }
    rows.push({
      id: rowId,
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        transport: 'stdio',
        serverName,
        command: process.execPath,
        args: [
          RELAY_CLI,
          '--app-name', app,
          '--connection-id', connectionId,
          '--cwd', cwd,
        ],
        env: {},
        cwd,
        failOnStartupError: false,
      },
    }, {
      id: `${rowId}-approval`,
      name: '@openma/dsh-agents-plugins-bridge/policies/codex-app-tool-approval',
      config: { ...relay, serverName },
    })
    requirements.push({
      kind: 'foreign-host',
      host: 'codex',
      capability: 'registered-app-connection',
      componentPath: input.component.path,
      metadata: {
        app,
        connectionId,
        required: definition.required === true,
      },
    })
  }
  return { rows, requirements }
}

/** Recognize Codex registered connections without treating opaque IDs as MCP configuration. */
export const dshCodexAppsAdapter: ComponentAdapter = {
  name: 'dsh-codex-apps',
  componentTypes: ['app'],
  materialize: appMaterialization,
}

export const name = 'plugin-bridge-adapter-dsh-codex-apps'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshCodexAppsAdapter)
}
