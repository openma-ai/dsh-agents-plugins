import { validateHeaderName, validateHeaderValue } from 'node:http'
import { isIP } from 'node:net'
import { resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ComponentAdapter,
  ComponentAdapterMaterialization,
  DshPluginRow,
} from '../kernel.js'
import { AGENT_PLUGINS_V1_MCP_SCHEMA } from '../providers/agent-plugins-v1.js'
import {
  boundedName,
  componentJson,
  packageName,
  record,
  slug,
} from './utils.js'

interface PortableRoots {
  readonly plugin: string
  readonly data: string
}

function contained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown !== undefined) throw new TypeError(`${label}.${unknown} is not supported`)
}

function portableRoots(input: Parameters<ComponentAdapter['materialize']>[0]): PortableRoots {
  if (input.pluginDataRoot === undefined) {
    throw new TypeError('agent-plugins-v1: MCP materialization requires a persistent pluginDataRoot')
  }
  return {
    plugin: resolve(input.source.root),
    data: resolve(input.pluginDataRoot),
  }
}

function expandPortable(value: string, roots: PortableRoots): string {
  return value.replace(/\$\{PLUGIN_(ROOT|DATA)\}/gu, (_placeholder, kind: string) =>
    kind === 'ROOT' ? roots.plugin : roots.data)
}

function portableStrings(value: unknown, label: string, roots: PortableRoots): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${label} must be an array of strings`)
  }
  return value.map(item => expandPortable(item as string, roots))
}

function portableEnv(
  value: unknown,
  label: string,
  roots: PortableRoots,
): Record<string, string> {
  const env = value === undefined ? {} : record(value, label)
  for (const [key, item] of Object.entries(env)) {
    if (typeof item !== 'string') throw new TypeError(`${label}.${key} must be a string`)
    if (key.toUpperCase() === 'PLUGIN_ROOT' || key.toUpperCase() === 'PLUGIN_DATA') {
      throw new TypeError(`${label}.${key} is reserved by Agent Plugins`)
    }
  }
  return {
    ...Object.fromEntries(Object.entries(env)
      .map(([key, item]) => [key, expandPortable(item as string, roots)])),
    PLUGIN_ROOT: roots.plugin,
    PLUGIN_DATA: roots.data,
  }
}

function portableCommand(value: unknown, label: string, roots: PortableRoots): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty executable token`)
  }
  if (value.startsWith('./')) {
    if (value.includes('\\')) throw new TypeError(`${label} must use a portable plugin-relative path`)
    const target = resolve(roots.plugin, value)
    if (!contained(roots.plugin, target)) throw new TypeError(`${label} escapes PLUGIN_ROOT`)
    return target
  }
  if (value.includes('/') || value.includes('\\') || value.startsWith('.')) {
    throw new TypeError(`${label} must be a bare executable name or begin with "./"`)
  }
  return value
}

function portableCwd(value: unknown, label: string, roots: PortableRoots): string {
  if (value === undefined) return roots.plugin
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  let root: string
  if (value.startsWith('./')) {
    root = roots.plugin
  } else if (value === '${PLUGIN_ROOT}' || value.startsWith('${PLUGIN_ROOT}/')) {
    root = roots.plugin
  } else if (value === '${PLUGIN_DATA}' || value.startsWith('${PLUGIN_DATA}/')) {
    root = roots.data
  } else {
    throw new TypeError(`${label} must be plugin-relative or rooted at a standard plugin placeholder`)
  }
  const target = resolve(root, expandPortable(value, roots))
  if (!contained(root, target)) throw new TypeError(`${label} escapes its declared plugin root`)
  return target
}

function portableUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty absolute URL`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`${label} must be a valid absolute URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`${label} must use HTTP or HTTPS`)
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new TypeError(`${label} must not contain user information or a fragment`)
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new TypeError(`${label} must use HTTPS outside loopback hosts`)
  }
  return value
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  if (host === 'localhost' || host === '::1') return true
  return isIP(host) === 4 && host.split('.')[0] === '127'
}

function portableHeaders(value: unknown, label: string): Record<string, string> {
  const headers = value === undefined ? {} : record(value, label)
  const normalized = new Set<string>()
  for (const [key, item] of Object.entries(headers)) {
    if (typeof item !== 'string') throw new TypeError(`${label}.${key} must be a string`)
    validateHeaderName(key)
    validateHeaderValue(key, item)
    const lower = key.toLowerCase()
    if (normalized.has(lower)) throw new TypeError(`${label} repeats header "${key}" with different casing`)
    normalized.add(lower)
  }
  return headers as Record<string, string>
}

function portableServerRow(
  input: Parameters<ComponentAdapter['materialize']>[0],
  server: string,
  value: unknown,
  roots: PortableRoots,
): DshPluginRow | undefined {
  const label = `agent-plugins-v1: mcpServers.${server}`
  const config = record(value, label)
  const rowId = `plugin-bridge-${slug(packageName(input))}-mcp-${slug(server)}`
  const serverName = boundedName(`${packageName(input)}-${server}`, 32)
  if (config.type === 'stdio') {
    requireExactKeys(config, ['type', 'command', 'args', 'env', 'cwd'], label)
    return {
      id: rowId,
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        transport: 'stdio',
        serverName,
        command: portableCommand(config.command, `${label}.command`, roots),
        args: portableStrings(config.args, `${label}.args`, roots),
        cwd: portableCwd(config.cwd, `${label}.cwd`, roots),
        env: portableEnv(config.env, `${label}.env`, roots),
        failOnStartupError: false,
      },
    }
  }
  if (config.type === 'streamable-http') {
    requireExactKeys(config, ['type', 'url', 'headers'], label)
    return {
      id: rowId,
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        transport: 'streamable-http',
        serverName,
        url: portableUrl(config.url, `${label}.url`),
        headers: portableHeaders(config.headers, `${label}.headers`),
        failOnStartupError: false,
      },
    }
  }
  if (config.type === 'sse') return undefined
  throw new TypeError(`${label}.type is not a supported Agent Plugins transport`)
}

function materializePortableMcp(
  input: Parameters<ComponentAdapter['materialize']>[0],
): ComponentAdapterMaterialization {
  const raw = record(componentJson(input), 'agent-plugins-v1: mcp.json')
  requireExactKeys(raw, ['$schema', 'mcpServers'], 'agent-plugins-v1: mcp.json')
  if (raw.$schema !== AGENT_PLUGINS_V1_MCP_SCHEMA) return { rows: [] }
  const servers = record(raw.mcpServers, 'agent-plugins-v1: mcpServers')
  const roots = portableRoots(input)
  const rows: DshPluginRow[] = []
  const diagnostics: string[] = []
  for (const server of Object.keys(servers).sort()) {
    try {
      const row = portableServerRow(input, server, servers[server], roots)
      if (row === undefined) {
        diagnostics.push(
          `agent-plugins-v1: skipped MCP server "${server}": transport "sse" is not supported by dsh-mcp-client`,
        )
      } else {
        rows.push(row)
      }
    } catch (error: unknown) {
      diagnostics.push(
        `agent-plugins-v1: skipped MCP server "${server}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return {
    rows,
    ...diagnostics.length === 0 ? {} : { diagnostics },
  }
}

/** Agent Plugins v1 MCP mapper, isolated from Codex and Claude legacy dialects. */
export const dshAgentPluginsMcpAdapter: ComponentAdapter = {
  name: 'dsh-agent-plugins-mcp',
  componentTypes: ['agent-plugin-mcp-server'],
  materialize: materializePortableMcp,
}

export const name = 'plugin-bridge-adapter-dsh-agent-plugins-mcp'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshAgentPluginsMcpAdapter)
}
