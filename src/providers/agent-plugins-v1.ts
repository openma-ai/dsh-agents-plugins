import type { Context } from '@deepseek-ai/cordis'
import type {
  PackageComponent,
  PackageFormatObservation,
  PackageFormatProvider,
  PluginPackageSource,
} from '../kernel.js'

export const AGENT_PLUGINS_V1_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
export const AGENT_PLUGINS_V1_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'

const MANIFEST_FIELDS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateOptionalString(manifest: Record<string, unknown>, field: string): void {
  const value = manifest[field]
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`agent-plugins-v1: plugin.json field "${field}" must be a string`)
  }
}

function validateManifest(value: unknown): {
  readonly manifest: Readonly<Record<string, unknown>>
  readonly diagnostics: readonly string[]
} {
  if (!record(value)) {
    throw new TypeError('agent-plugins-v1: plugin.json must contain an object')
  }
  if (value.$schema !== AGENT_PLUGINS_V1_SCHEMA) {
    throw new TypeError(`agent-plugins-v1: unsupported $schema "${String(value.$schema)}"`)
  }
  if (typeof value.name !== 'string'
    || value.name.length > 64
    || !/^[a-z0-9](?!.*(?:--|\.\.))[a-z0-9.-]*[a-z0-9]$|^[a-z0-9]$/u.test(value.name)) {
    throw new TypeError('agent-plugins-v1: plugin.json field "name" violates Agent Plugins v1 naming constraints')
  }
  for (const field of ['version', 'description', 'homepage', 'repository', 'license']) {
    validateOptionalString(value, field)
  }
  if (value.author !== undefined) {
    if (!record(value.author)
      || Object.keys(value.author).some(field => !['name', 'email', 'url'].includes(field))
      || Object.values(value.author).some(field => typeof field !== 'string')) {
      throw new TypeError('agent-plugins-v1: plugin.json field "author" must be a closed string-valued object')
    }
  }
  if (value.keywords !== undefined
    && (!Array.isArray(value.keywords) || value.keywords.some(keyword => typeof keyword !== 'string'))) {
    throw new TypeError('agent-plugins-v1: plugin.json field "keywords" must be an array of strings')
  }

  const diagnostics = Object.keys(value)
    .filter(field => !MANIFEST_FIELDS.has(field))
    .sort()
    .map(field => `plugin.json: ignored unknown field "${field}"`)
  if (value.extensions !== undefined && !record(value.extensions)) {
    diagnostics.push('plugin.json: ignored non-object "extensions" field')
  }
  return { manifest: Object.freeze({ ...value }), diagnostics: Object.freeze(diagnostics) }
}

function discoverMcp(source: PluginPackageSource): {
  readonly components: readonly PackageComponent[]
  readonly diagnostics: readonly string[]
} {
  if (!source.has('mcp.json')) return { components: [], diagnostics: [] }
  if (source.kind('mcp.json') !== 'file') {
    return {
      components: [],
      diagnostics: ['mcp.json: must be a regular file; MCP disabled'],
    }
  }
  try {
    const value = source.readJson('mcp.json')
    if (!record(value)
      || value.$schema !== AGENT_PLUGINS_V1_MCP_SCHEMA
      || !record(value.mcpServers)
      || Object.keys(value).some(field => field !== '$schema' && field !== 'mcpServers')) {
      return {
        components: [],
        diagnostics: ['mcp.json: unsupported schema or invalid closed top-level object; MCP disabled'],
      }
    }
    return { components: [{ type: 'agent-plugin-mcp-server', path: 'mcp.json' }], diagnostics: [] }
  } catch (error: unknown) {
    return {
      components: [],
      diagnostics: [`mcp.json: ${error instanceof Error ? error.message : String(error)}; MCP disabled`],
    }
  }
}

/** Portable Agent Plugins 1.0 package format. */
export const agentPluginsV1Provider: PackageFormatProvider = {
  name: 'agent-plugins-v1',
  probe(source: PluginPackageSource): PackageFormatObservation | undefined {
    if (!source.has('plugin.json')) return undefined
    const candidate = source.readJson('plugin.json')
    if (!record(candidate) || candidate.$schema !== AGENT_PLUGINS_V1_SCHEMA) return undefined
    const { manifest, diagnostics } = validateManifest(candidate)
    const allDiagnostics = [...diagnostics]
    const components = []
    if (source.has('skills/')) {
      if (source.kind('skills/') === 'directory') {
        components.push({ type: 'skill', path: 'skills/' })
      } else {
        allDiagnostics.push('skills/: must be a directory; skills disabled')
      }
    }
    const mcp = discoverMcp(source)
    components.push(...mcp.components)
    allDiagnostics.push(...mcp.diagnostics)
    return {
      manifestPath: 'plugin.json',
      manifest,
      components: Object.freeze(components),
      ...allDiagnostics.length === 0 ? {} : { diagnostics: Object.freeze(allDiagnostics) },
    }
  },
}

export const name = 'plugin-bridge-format-agent-plugins-v1'
export const inject = ['pluginBridge']

/** Register the portable standard format on the shared bridge kernel. */
export function apply(ctx: Context): void {
  ctx.pluginBridge.registerPackageFormatProvider(agentPluginsV1Provider)
}
