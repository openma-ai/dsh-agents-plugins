import { createHash } from 'node:crypto'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface CodexAppRpc {
  request<Result>(method: string, params: unknown): Promise<Result>
  close(): Promise<void>
}

export interface CodexHostRelayOptions {
  readonly appName: string
  readonly connectionId: string
  readonly cwd: string
}

export interface CodexMcpTool extends Record<string, unknown> {
  readonly name: string
  readonly description?: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly annotations?: Readonly<Record<string, unknown>>
  readonly _meta?: Readonly<Record<string, unknown>>
}

export interface CodexMcpResource extends Record<string, unknown> {
  readonly uri: string
  readonly name: string
  readonly _meta?: Readonly<Record<string, unknown>>
}

export interface CodexMcpResourceTemplate extends Record<string, unknown> {
  readonly uriTemplate: string
  readonly name: string
  readonly _meta?: Readonly<Record<string, unknown>>
}

export interface CodexMcpCallResult extends Record<string, unknown> {
  readonly content: readonly JsonValue[]
  readonly structuredContent?: JsonValue
  readonly isError?: boolean
  readonly _meta?: JsonValue
}

interface InstalledApp {
  readonly id: string
  readonly runtimeName: string | null
  readonly enabled: boolean
  readonly callable: boolean
}

interface McpServerStatus {
  readonly name: string
  readonly tools: Readonly<Record<string, unknown>>
  readonly resources: readonly unknown[]
  readonly resourceTemplates: readonly unknown[]
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function connectorMetadata(value: unknown): Record<string, unknown> {
  const record = object(value, 'Codex catalog entry')
  const meta = record._meta
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : {}
}

function normalizedNamespace(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '_')
}

function exposedToolName(rawName: string, appName: string, tool: Record<string, unknown>): string {
  const meta = connectorMetadata(tool)
  const connectorName = typeof meta.connector_name === 'string' ? meta.connector_name : undefined
  const prefixes = [appName, connectorName]
    .filter((value): value is string => value !== undefined)
    .flatMap(value => [value, normalizedNamespace(value)])
  for (const prefix of new Set(prefixes)) {
    if (rawName.startsWith(`${prefix}.`)) return rawName.slice(prefix.length + 1)
  }
  return rawName
}

function matchesConnector(value: unknown, options: CodexHostRelayOptions): boolean {
  const record = object(value, 'Codex catalog entry')
  const meta = connectorMetadata(record)
  if (meta.connector_id === options.connectionId) return true
  if (meta.connectorId === options.connectionId) return true
  const pluginName = meta.plugin_name ?? meta.pluginName
  return typeof pluginName === 'string'
    && normalizedNamespace(pluginName) === normalizedNamespace(options.appName)
}

function linkedResourceUris(tool: Record<string, unknown>): string[] {
  const meta = connectorMetadata(tool)
  const ui = typeof meta.ui === 'object' && meta.ui !== null && !Array.isArray(meta.ui)
    ? meta.ui as Record<string, unknown>
    : undefined
  return [ui?.resourceUri, meta['ui/resourceUri'], meta['openai/outputTemplate']]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
}

/** Deterministic public name used by dsh-mcp-client for one server/raw-tool identity. */
export function publicMcpToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(/[^A-Za-z0-9_-]/gu, '_')
  if (normalized === joined && normalized.length <= 64) return normalized
  const digest = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, 12)
  return `${normalized.slice(0, 51)}_${digest}`
}

export interface CodexAppApprovalCatalog {
  requiresApproval(publicToolName: string): boolean
}

/**
 * Classify the exact DSH names contributed by one relay. Unknown names inside
 * its namespace fail closed; tools declared read-only pass through.
 */
export function createCodexAppApprovalCatalog(
  serverName: string,
  tools: readonly CodexMcpTool[],
): CodexAppApprovalCatalog {
  const prefix = `mcp__${serverName}__`
  const readOnly = new Set(tools
    .filter(tool => tool.annotations?.readOnlyHint === true)
    .map(tool => publicMcpToolName(serverName, tool.name)))
  return {
    requiresApproval(publicName) {
      return publicName.startsWith(prefix) && !readOnly.has(publicName)
    },
  }
}

/** One filtered view of Codex's hosted `codex_apps` MCP server. */
export class CodexHostRelay {
  private threadId: string | undefined
  private tools: CodexMcpTool[] = []
  private resources: CodexMcpResource[] = []
  private resourceTemplates: CodexMcpResourceTemplate[] = []
  private readonly rawToolNames = new Map<string, string>()
  private readonly allowedResourceUris = new Set<string>()

  constructor(
    private readonly rpc: CodexAppRpc,
    private readonly options: CodexHostRelayOptions,
  ) {}

  async initialize(): Promise<void> {
    if (this.threadId !== undefined) return
    const installedResponse = object(
      await this.rpc.request('app/installed', { forceRefresh: true }),
      'app/installed response',
    )
    const installed = array(installedResponse.apps, 'app/installed apps')
      .map((value): InstalledApp => {
        const app = object(value, 'installed App')
        return {
          id: nonempty(app.id, 'installed App id'),
          runtimeName: typeof app.runtimeName === 'string' ? app.runtimeName : null,
          enabled: app.enabled === true,
          callable: app.callable === true,
        }
      })
      .find(app => app.id === this.options.connectionId)
    if (installed === undefined) {
      throw new Error(
        `Codex App "${this.options.appName}" is not installed for connection ${this.options.connectionId}`,
      )
    }
    if (!installed.enabled || !installed.callable) {
      throw new Error(
        `Codex App "${this.options.appName}" is not callable (enabled=${installed.enabled}, callable=${installed.callable})`,
      )
    }

    const started = object(await this.rpc.request('thread/start', {
      cwd: this.options.cwd,
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: { features: { apps: true } },
    }), 'thread/start response')
    const thread = object(started.thread, 'thread/start thread')
    const threadId = nonempty(thread.id, 'thread/start thread id')

    const statuses: McpServerStatus[] = []
    let cursor: string | null = null
    do {
      const response = object(await this.rpc.request('mcpServerStatus/list', {
        threadId,
        detail: 'full',
        limit: 100,
        cursor,
      }), 'mcpServerStatus/list response')
      for (const value of array(response.data, 'mcpServerStatus/list data')) {
        const status = object(value, 'MCP server status')
        statuses.push({
          name: nonempty(status.name, 'MCP server name'),
          tools: object(status.tools, 'MCP server tools'),
          resources: array(status.resources, 'MCP server resources'),
          resourceTemplates: array(status.resourceTemplates, 'MCP server resource templates'),
        })
      }
      cursor = response.nextCursor === null || response.nextCursor === undefined
        ? null
        : nonempty(response.nextCursor, 'MCP server next cursor')
    } while (cursor !== null)

    const apps = statuses.find(status => status.name === 'codex_apps')
    if (apps === undefined) throw new Error('Codex App host did not expose the codex_apps MCP server')

    const tools: CodexMcpTool[] = []
    for (const [rawName, value] of Object.entries(apps.tools)) {
      const tool = object(value, `Codex tool ${rawName}`)
      if (!matchesConnector(tool, this.options)) continue
      const name = exposedToolName(rawName, this.options.appName, tool)
      if (this.rawToolNames.has(name)) {
        throw new Error(`Codex App "${this.options.appName}" exposes duplicate tool name "${name}"`)
      }
      const inputSchema = object(tool.inputSchema, `Codex tool ${rawName} inputSchema`)
      const projected = { ...tool, name, inputSchema } as CodexMcpTool
      this.rawToolNames.set(name, rawName)
      for (const uri of linkedResourceUris(tool)) this.allowedResourceUris.add(uri)
      tools.push(projected)
    }
    tools.sort((left, right) => left.name.localeCompare(right.name))
    if (tools.length === 0) {
      throw new Error(`Codex App "${this.options.appName}" exposed no tools for ${this.options.connectionId}`)
    }

    const resources = apps.resources
      .filter(value => matchesConnector(value, this.options))
      .map((value): CodexMcpResource => {
        const resource = object(value, 'Codex App resource')
        const uri = nonempty(resource.uri, 'Codex App resource uri')
        this.allowedResourceUris.add(uri)
        return { ...resource, uri, name: nonempty(resource.name, 'Codex App resource name') } as CodexMcpResource
      })
      .sort((left, right) => left.uri.localeCompare(right.uri))
    const templates = apps.resourceTemplates
      .filter(value => matchesConnector(value, this.options))
      .map((value): CodexMcpResourceTemplate => {
        const template = object(value, 'Codex App resource template')
        return {
          ...template,
          uriTemplate: nonempty(template.uriTemplate, 'Codex App resource template uriTemplate'),
          name: nonempty(template.name, 'Codex App resource template name'),
        } as CodexMcpResourceTemplate
      })
      .sort((left, right) => left.uriTemplate.localeCompare(right.uriTemplate))

    this.threadId = threadId
    this.tools = tools
    this.resources = resources
    this.resourceTemplates = templates
  }

  listTools(): readonly CodexMcpTool[] {
    this.requireInitialized()
    return structuredClone(this.tools)
  }

  listResources(): readonly CodexMcpResource[] {
    this.requireInitialized()
    return structuredClone(this.resources)
  }

  listResourceTemplates(): readonly CodexMcpResourceTemplate[] {
    this.requireInitialized()
    return structuredClone(this.resourceTemplates)
  }

  async callTool(
    name: string,
    args?: Readonly<Record<string, unknown>>,
    meta?: Readonly<Record<string, unknown>>,
  ): Promise<CodexMcpCallResult> {
    const threadId = this.requireInitialized()
    const rawName = this.rawToolNames.get(name)
    if (rawName === undefined) throw new Error(`tool "${name}" is not exposed by Codex App "${this.options.appName}"`)
    const result = await this.rpc.request<CodexMcpCallResult>('mcpServer/tool/call', {
      threadId,
      server: 'codex_apps',
      tool: rawName,
      ...args === undefined ? {} : { arguments: args },
      ...meta === undefined ? {} : { _meta: meta },
    })
    // dsh-mcp-client currently renders only MCP content blocks to the model.
    // Preserve the canonical structured value for Apps/Host consumers and add
    // a text projection so connector data is not reduced to a generic status
    // sentence such as "Action completed." inside a DSH agent turn.
    if (result.structuredContent === undefined) return result
    return {
      ...result,
      content: [
        ...result.content,
        {
          type: 'text',
          text: `Structured result:\n${JSON.stringify(result.structuredContent)}`,
        },
      ],
    }
  }

  async readResource(uri: string): Promise<unknown> {
    const threadId = this.requireInitialized()
    if (!this.allowedResourceUris.has(uri)) {
      throw new Error(`resource "${uri}" is not exposed by Codex App "${this.options.appName}"`)
    }
    return await this.rpc.request('mcpServer/resource/read', {
      threadId,
      server: 'codex_apps',
      uri,
    })
  }

  close(): Promise<void> {
    return this.rpc.close()
  }

  private requireInitialized(): string {
    if (this.threadId === undefined) throw new Error('Codex host relay is not initialized')
    return this.threadId
  }
}
