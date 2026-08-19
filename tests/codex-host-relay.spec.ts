import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CodexHostRelay,
  createCodexAppApprovalCatalog,
  type CodexAppRpc,
} from '../src/codex-host-relay.js'
import { CodexRelayMcpProtocol } from '../src/codex-host-relay-cli.js'

class FixtureRpc implements CodexAppRpc {
  readonly requests: Array<{ method: string; params: unknown }> = []

  async request<Result>(method: string, params: unknown): Promise<Result> {
    this.requests.push({ method, params })
    if (method === 'app/installed') {
      return { apps: [{ id: 'connector_sites', runtimeName: 'Sites', enabled: true, callable: true }] } as Result
    }
    if (method === 'thread/start') {
      return { thread: { id: 'thread-1' } } as Result
    }
    if (method === 'mcpServerStatus/list') {
      return {
        data: [{
          name: 'codex_apps',
          tools: {
            'sites.create_site': {
              name: 'sites.create_site',
              description: 'Create a site.',
              inputSchema: { type: 'object', properties: {} },
              annotations: { readOnlyHint: false },
              _meta: {
                connector_id: 'connector_sites',
                connector_name: 'Sites',
                ui: { resourceUri: 'ui://sites/create.html' },
              },
            },
            'sites.list_sites': {
              name: 'sites.list_sites',
              description: 'List sites.',
              inputSchema: { type: 'object', properties: {} },
              annotations: { readOnlyHint: true },
              _meta: { connector_id: 'connector_sites', connector_name: 'Sites' },
            },
            'github.search': {
              name: 'github.search',
              description: 'Search GitHub.',
              inputSchema: { type: 'object', properties: {} },
              annotations: { readOnlyHint: true },
              _meta: { connector_id: 'connector_github', connector_name: 'GitHub' },
            },
          },
          resources: [{
            uri: 'ui://sites/create.html',
            name: 'sites-create',
            mimeType: 'text/html;profile=mcp-app',
            _meta: { connector_id: 'connector_sites' },
          }, {
            uri: 'ui://github/search.html',
            name: 'github-search',
            mimeType: 'text/html;profile=mcp-app',
            _meta: { connector_id: 'connector_github' },
          }],
          resourceTemplates: [],
          authStatus: 'oAuth',
        }],
        nextCursor: null,
      } as Result
    }
    if (method === 'mcpServer/tool/call') {
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { items: [] },
        _meta: { trace: 'kept' },
      } as Result
    }
    if (method === 'mcpServer/resource/read') {
      return {
        contents: [{
          uri: 'ui://sites/create.html',
          mimeType: 'text/html;profile=mcp-app',
          text: '<html></html>',
        }],
      } as Result
    }
    throw new Error(`unexpected fixture method ${method}`)
  }

  async close(): Promise<void> {}
}

test('Codex host relay exposes only one declared App and preserves MCP metadata', async () => {
  const rpc = new FixtureRpc()
  const relay = new CodexHostRelay(rpc, {
    appName: 'sites',
    connectionId: 'connector_sites',
    cwd: '/fixture/plugin',
  })

  await relay.initialize()

  assert.deepEqual(relay.listTools().map(tool => tool.name), ['create_site', 'list_sites'])
  assert.deepEqual(relay.listTools()[0]?.annotations, { readOnlyHint: false })
  assert.deepEqual(relay.listTools()[0]?._meta, {
    connector_id: 'connector_sites',
    connector_name: 'Sites',
    ui: { resourceUri: 'ui://sites/create.html' },
  })
  assert.deepEqual(relay.listResources().map(resource => resource.uri), ['ui://sites/create.html'])

  const result = await relay.callTool('list_sites', { limit: 1 }, { progressToken: 'p1' })
  assert.deepEqual(result, {
    content: [
      { type: 'text', text: 'ok' },
      { type: 'text', text: 'Structured result:\n{"items":[]}' },
    ],
    structuredContent: { items: [] },
    _meta: { trace: 'kept' },
  })
  assert.deepEqual(rpc.requests.at(-1), {
    method: 'mcpServer/tool/call',
    params: {
      threadId: 'thread-1',
      server: 'codex_apps',
      tool: 'sites.list_sites',
      arguments: { limit: 1 },
      _meta: { progressToken: 'p1' },
    },
  })

  await relay.readResource('ui://sites/create.html')
  assert.deepEqual(rpc.requests.at(-1), {
    method: 'mcpServer/resource/read',
    params: {
      threadId: 'thread-1',
      server: 'codex_apps',
      uri: 'ui://sites/create.html',
    },
  })
  await assert.rejects(
    relay.readResource('ui://github/search.html'),
    /not exposed by Codex App "sites"/,
  )
})

test('Codex host relay fails with an actionable diagnostic when the connection is not callable', async () => {
  const rpc = new FixtureRpc()
  const original = rpc.request.bind(rpc)
  rpc.request = async <Result>(method: string, params: unknown): Promise<Result> => {
    if (method === 'app/installed') {
      return { apps: [{ id: 'connector_sites', runtimeName: 'Sites', enabled: true, callable: false }] } as Result
    }
    return original<Result>(method, params)
  }
  const relay = new CodexHostRelay(rpc, {
    appName: 'sites',
    connectionId: 'connector_sites',
    cwd: '/fixture/plugin',
  })

  await assert.rejects(relay.initialize(), /Codex App "sites".*not callable/)
})

test('Codex App approval adapter asks for writes and unknown tools but not declared reads', async () => {
  const relay = new CodexHostRelay(new FixtureRpc(), {
    appName: 'sites',
    connectionId: 'connector_sites',
    cwd: '/fixture/plugin',
  })
  await relay.initialize()
  const catalog = createCodexAppApprovalCatalog('codex-sites', relay.listTools())

  assert.equal(catalog.requiresApproval('mcp__codex-sites__list_sites'), false)
  assert.equal(catalog.requiresApproval('mcp__codex-sites__create_site'), true)
  assert.equal(catalog.requiresApproval('mcp__codex-sites__future_write'), true)
  assert.equal(catalog.requiresApproval('mcp__somewhere-else__tool'), false)
})

test('Codex relay speaks standard MCP initialize, tools, calls, and resources', async () => {
  const relay = new CodexHostRelay(new FixtureRpc(), {
    appName: 'sites',
    connectionId: 'connector_sites',
    cwd: '/fixture/plugin',
  })
  await relay.initialize()
  const protocol = new CodexRelayMcpProtocol(relay)

  assert.deepEqual(await protocol.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  }), {
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: '2025-06-18',
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: { name: 'dsh-codex-host-relay', version: '0.1.0' },
    },
  })
  const tools = await protocol.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.deepEqual(
    ((tools?.result as { tools: Array<{ name: string }> }).tools).map(tool => tool.name),
    ['create_site', 'list_sites'],
  )
  const called = await protocol.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'list_sites', arguments: { limit: 1 } },
  })
  assert.deepEqual(called?.result, {
    content: [
      { type: 'text', text: 'ok' },
      { type: 'text', text: 'Structured result:\n{"items":[]}' },
    ],
    structuredContent: { items: [] },
    _meta: { trace: 'kept' },
  })
  const resource = await protocol.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'resources/read',
    params: { uri: 'ui://sites/create.html' },
  })
  assert.equal(
    ((resource?.result as { contents: Array<{ text: string }> }).contents[0]?.text),
    '<html></html>',
  )
})
