import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  PluginBridgeKernel,
  type DetectedPackageFormat,
  type PluginPackageSource,
} from '../src/kernel.js'
import { dshHooksAdapter } from '../src/adapters/dsh-hooks.js'
import { dshLspAdapter } from '../src/adapters/dsh-lsp.js'
import { dshAgentPluginsMcpAdapter } from '../src/adapters/dsh-agent-plugins-mcp.js'
import { dshMcpAdapter } from '../src/adapters/dsh-mcp.js'
import { dshPromptCommandsAdapter } from '../src/adapters/dsh-prompt-commands.js'
import { dshSkillsAdapter } from '../src/adapters/dsh-skills.js'

function source(files: Record<string, unknown>, texts: Record<string, string> = {}): PluginPackageSource {
  return {
    root: '/fixture/plugin',
    has: path => Object.hasOwn(files, path),
    kind: path => Object.hasOwn(files, path)
      ? path.endsWith('/') ? 'directory' : 'file'
      : undefined,
    readJson: path => files[path],
    readText: path => texts[path] ?? JSON.stringify(files[path]),
  }
}

test('Codex hook rows activate at explicit import without a duplicate approval gate', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshHooksAdapter)
  const hookText = '{"hooks":{"SessionStart":[]}}\n'

  const result = kernel.materializePackage(source({
    'hooks/hooks.json': { hooks: { SessionStart: [] } },
  }, { 'hooks/hooks.json': hookText }), detected('codex-legacy', [
    { type: 'hook', path: 'hooks/hooks.json' },
  ]))

  assert.deepEqual(result.activations, [])
  assert.equal(result.rows[0]?.name, '@openma/dsh-agents-plugins-bridge/hooks-codex')
})

test('Claude Code hook rows activate at explicit import without a duplicate approval gate', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshHooksAdapter)
  const hookText = '{"hooks":{"SessionStart":[]}}\n'

  const result = kernel.materializePackage(source({
    'hooks/hooks.json': { hooks: { SessionStart: [] } },
  }, { 'hooks/hooks.json': hookText }), detected('claude-code-legacy', [
    { type: 'hook', path: 'hooks/hooks.json' },
  ]))

  assert.deepEqual(result.activations, [])
})

function detected(
  provider: string,
  components: DetectedPackageFormat['components'],
): DetectedPackageFormat {
  return {
    provider,
    manifestPath: provider === 'codex-legacy'
      ? '.codex-plugin/plugin.json'
      : '.claude-plugin/plugin.json',
    manifest: { name: 'demo-plugin' },
    components,
  }
}

test('legacy materialization keeps each contributed capability in a separate dsh row', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshSkillsAdapter)
  kernel.registerComponentAdapter(dshMcpAdapter)
  const packageSource = source({
    'skills/': true,
    'mcp.json': {
      mcpServers: {
        local: {
          command: 'node',
          args: ['${CODEX_PLUGIN_ROOT}/server.js'],
          cwd: '.',
          env: { TOKEN: '${DEMO_TOKEN}' },
        },
        remote: {
          url: 'https://example.test/mcp',
          headers: { Authorization: 'Bearer ${DEMO_TOKEN}' },
        },
      },
    },
  })

  const result = kernel.materializePackage(packageSource, {
    provider: 'codex-legacy',
    manifestPath: '.codex-plugin/plugin.json',
    manifest: { name: 'demo-plugin' },
    components: [
      { type: 'skill', path: 'skills/' },
      { type: 'mcp-server', path: 'mcp.json' },
    ],
  })

  assert.deepEqual(result.unsupported, [])
  assert.deepEqual(result.rows, [
    {
      id: 'plugin-bridge-demo-plugin-skill-skills',
      name: '@deepseek-ai/dsh-skill-filesystem',
      config: {
        providerName: 'plugin-bridge-demo-plugin-skills',
        includeDefaultRoots: false,
        bundledSkillDir: '/fixture/plugin/skills',
      },
    },
    {
      id: 'plugin-bridge-demo-plugin-mcp-local',
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        transport: 'stdio',
        serverName: 'demo-plugin-local',
        command: 'node',
        args: ['/fixture/plugin/server.js'],
        env: {
          TOKEN: { __jsExpr: 'process.env["DEMO_TOKEN"] ?? ""' },
        },
        cwd: '/fixture/plugin',
        failOnStartupError: false,
      },
    },
    {
      id: 'plugin-bridge-demo-plugin-mcp-remote',
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        transport: 'streamable-http',
        serverName: 'demo-plugin-remote',
        url: 'https://example.test/mcp',
        headers: {
          Authorization: {
            __jsExpr: '"Bearer " + (process.env["DEMO_TOKEN"] ?? "")',
          },
        },
        failOnStartupError: false,
      },
    },
  ])
})

test('Agent Plugins MCP expands only its two standard roots and injects their subprocess environment', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshAgentPluginsMcpAdapter)
  const packageSource = source({
    'mcp.json': {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        portable: {
          type: 'stdio',
          command: './server.js',
          args: ['${PLUGIN_ROOT}/config.json', '${PLUGIN_DATA}/cache', '${UNRECOGNIZED}'],
          cwd: '${PLUGIN_DATA}/work',
          env: { CONFIG: '${PLUGIN_ROOT}/config.json' },
        },
      },
    },
  })

  const result = kernel.materializePackage(packageSource, {
    provider: 'agent-plugins-v1',
    manifestPath: 'plugin.json',
    manifest: { name: 'portable-plugin' },
    components: [{ type: 'agent-plugin-mcp-server', path: 'mcp.json' }],
  }, { pluginDataRoot: '/fixture/data/portable-plugin' })

  assert.deepEqual(result.rows, [{
    id: 'plugin-bridge-portable-plugin-mcp-portable',
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      transport: 'stdio',
      serverName: 'portable-plugin-portable',
      command: '/fixture/plugin/server.js',
      args: [
        '/fixture/plugin/config.json',
        '/fixture/data/portable-plugin/cache',
        '${UNRECOGNIZED}',
      ],
      cwd: '/fixture/data/portable-plugin/work',
      env: {
        CONFIG: '/fixture/plugin/config.json',
        PLUGIN_ROOT: '/fixture/plugin',
        PLUGIN_DATA: '/fixture/data/portable-plugin',
      },
      failOnStartupError: false,
    },
  }])
})

test('Agent Plugins MCP honors declared transport and skips invalid or unsupported server entries', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshAgentPluginsMcpAdapter)
  const result = kernel.materializePackage(source({
    'mcp.json': {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        invalid: { type: 'stdio', command: 'node', unexpected: true },
        legacy: { type: 'sse', url: 'https://example.test/sse' },
        remote: {
          type: 'streamable-http',
          url: 'https://example.test/mcp',
          headers: { 'X-Literal': '${NOT_EXPANDED}' },
        },
      },
    },
  }), {
    provider: 'agent-plugins-v1',
    manifestPath: 'plugin.json',
    manifest: { name: 'portable-plugin' },
    components: [{ type: 'agent-plugin-mcp-server', path: 'mcp.json' }],
  }, { pluginDataRoot: '/fixture/data/portable-plugin' })

  assert.deepEqual(result.rows, [{
    id: 'plugin-bridge-portable-plugin-mcp-remote',
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      transport: 'streamable-http',
      serverName: 'portable-plugin-remote',
      url: 'https://example.test/mcp',
      headers: { 'X-Literal': '${NOT_EXPANDED}' },
      failOnStartupError: false,
    },
  }])
  assert.deepEqual(result.diagnostics, [
    'agent-plugins-v1: skipped MCP server "invalid": agent-plugins-v1: mcpServers.invalid.unexpected is not supported',
    'agent-plugins-v1: skipped MCP server "legacy": transport "sse" is not supported by dsh-mcp-client',
  ])
})

test('Codex MCP accepts the documented mcp_servers wrapper', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshMcpAdapter)
  const result = kernel.materializePackage(source({
    '.mcp.json': {
      mcp_servers: {
        wrapped: { command: 'node', args: ['./server.js'] },
      },
    },
  }), {
    provider: 'codex-legacy',
    manifestPath: '.codex-plugin/plugin.json',
    manifest: { name: 'codex-plugin' },
    components: [{ type: 'mcp-server', path: '.mcp.json' }],
  })

  assert.deepEqual(result.rows, [{
    id: 'plugin-bridge-codex-plugin-mcp-wrapped',
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      transport: 'stdio',
      serverName: 'codex-plugin-wrapped',
      command: 'node',
      args: ['./server.js'],
      env: {},
      cwd: '/fixture/plugin',
      failOnStartupError: false,
    },
  }])
})

test('Codex and Claude hook components use bridge-owned hosts for the matching dsh hook plugin', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshHooksAdapter)
  const packageSource = source({
    'hooks/hooks.json': {},
    '.claude-plugin/plugin.json': { name: 'demo-plugin', hooks: {} },
  })

  assert.deepEqual(kernel.materializePackage(packageSource, detected('codex-legacy', [
    { type: 'hook', path: 'hooks/hooks.json' },
  ]), { pluginDataRoot: '/fixture/data/demo-plugin' }).rows, [{
    id: 'plugin-bridge-demo-plugin-hook-codex',
    name: '@openma/dsh-agents-plugins-bridge/hooks-codex',
    config: {
      configPath: '/fixture/plugin/hooks/hooks.json',
      pluginRoot: '/fixture/plugin',
      pluginData: '/fixture/data/demo-plugin',
    },
  }])

  assert.deepEqual(kernel.materializePackage(packageSource, detected('claude-code-legacy', [
    { type: 'hook', path: '.claude-plugin/plugin.json', manifestField: 'hooks' },
  ]), { pluginDataRoot: '/fixture/data/demo-plugin' }).rows, [{
    id: 'plugin-bridge-demo-plugin-hook-claude-code',
    name: '@openma/dsh-agents-plugins-bridge/hooks-claude-code',
    config: {
      configPath: '/fixture/plugin/.claude-plugin/plugin.json',
      pluginRoot: '/fixture/plugin',
      pluginData: '/fixture/data/demo-plugin',
    },
  }])
})

test('multiple declared Codex hook files become independent Loader rows', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshHooksAdapter)
  const packageSource = source({
    'hooks/session.json': {},
    'hooks/tools.json': {},
  })

  const rows = kernel.materializePackage(packageSource, detected('codex-legacy', [
    { type: 'hook', path: 'hooks/session.json' },
    { type: 'hook', path: 'hooks/tools.json' },
  ]), { pluginDataRoot: '/fixture/data/demo-plugin' }).rows

  assert.deepEqual(rows.map(row => row.id), [
    'plugin-bridge-demo-plugin-hook-codex-hooks-session-json',
    'plugin-bridge-demo-plugin-hook-codex-hooks-tools-json',
  ])
})

test('unsupported legacy components remain explicit instead of disappearing', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const packageSource = source({ 'skills/': true, '.app.json': {} })

  const result = kernel.materializePackage(packageSource, detected('codex-legacy', [
    { type: 'skill', path: 'skills/' },
    { type: 'app', path: '.app.json' },
  ]))

  assert.deepEqual(result.rows.map(row => row.name), ['@deepseek-ai/dsh-skill-filesystem'])
  assert.deepEqual(result.unsupported, [{ type: 'app', path: '.app.json' }])
})

test('Codex registered App connections become explicit foreign-host requirements', async () => {
  const bridge = await import('../src/index.js')
  const adapter = (bridge as Record<string, unknown>).dshCodexAppsAdapter as
    | Parameters<PluginBridgeKernel['registerComponentAdapter']>[0]
    | undefined
  assert.ok(adapter, 'the Codex Apps adapter must be exported')
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(adapter)
  const result = kernel.materializePackage(source({
    '.app.json': {
      apps: {
        sites: { id: 'connector_sites', required: true },
      },
    },
  }), detected('codex-legacy', [{ type: 'app', path: '.app.json' }]))

  assert.deepEqual(result.unsupported, [])
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0]?.id, 'plugin-bridge-demo-plugin-codex-app-sites')
  assert.equal(result.rows[0]?.name, '@deepseek-ai/dsh-mcp-client')
  assert.deepEqual(result.rows[0]?.config, {
    transport: 'stdio',
    serverName: 'demo-plugin-codex-sites',
    command: process.execPath,
    args: [
      (result.rows[0]?.config?.args as unknown[])[0],
      '--app-name', 'sites',
      '--connection-id', 'connector_sites',
      '--cwd', '/fixture/plugin',
    ],
    env: {},
    cwd: '/fixture/plugin',
    failOnStartupError: false,
  })
  assert.match(String((result.rows[0]?.config?.args as unknown[])[0]), /codex-host-relay-cli\.js$/)
  assert.deepEqual(result.rows[1], {
    id: 'plugin-bridge-demo-plugin-codex-app-sites-approval',
    name: '@openma/dsh-agents-plugins-bridge/policies/codex-app-tool-approval',
    config: {
      appName: 'sites',
      connectionId: 'connector_sites',
      serverName: 'demo-plugin-codex-sites',
      cwd: '/fixture/plugin',
    },
  })
  assert.deepEqual((result as unknown as { requirements: readonly unknown[] }).requirements, [{
    kind: 'foreign-host',
    host: 'codex',
    capability: 'registered-app-connection',
    componentPath: '.app.json',
    metadata: {
      app: 'sites',
      connectionId: 'connector_sites',
      required: true,
    },
  }])
})

test('Codex App connections resolved by a same-name MCP server do not require its host', async () => {
  const bridge = await import('../src/index.js')
  const adapter = (bridge as Record<string, unknown>).dshCodexAppsAdapter as
    | Parameters<PluginBridgeKernel['registerComponentAdapter']>[0]
    | undefined
  assert.ok(adapter, 'the Codex Apps adapter must be exported')
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(adapter)
  kernel.registerComponentAdapter(dshMcpAdapter)
  const result = kernel.materializePackage(source({
    '.app.json': { apps: { linear: { id: 'asdk_app_linear', required: true } } },
    '.mcp.json': {
      mcpServers: {
        linear: { url: 'https://mcp.linear.test/mcp' },
      },
    },
  }), detected('codex-legacy', [
    { type: 'mcp-server', path: '.mcp.json' },
    { type: 'app', path: '.app.json' },
  ]))

  assert.equal(result.rows.length, 1)
  assert.deepEqual(result.requirements, [])
  assert.deepEqual(result.unsupported, [])
})

test('Claude commands and Pi prompts materialize as separately disposable command producers', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshPromptCommandsAdapter)

  const claude = kernel.materializePackage(source({ 'commands/': true }), detected(
    'claude-code-legacy',
    [{ type: 'command', path: 'commands/' }],
  ))
  assert.deepEqual(claude.rows, [{
    id: 'plugin-bridge-demo-plugin-command-commands',
    name: '@openma/dsh-agents-plugins-bridge/prompt-commands',
    config: {
      dialect: 'claude-code',
      pluginName: 'demo-plugin',
      pluginRoot: '/fixture/plugin',
      componentPath: 'commands/',
    },
  }])
  assert.deepEqual(claude.unsupported, [])

  const pi = kernel.materializePackage(source({ 'prompts/': true }), {
    provider: 'pi-package',
    manifestPath: 'package.json',
    manifest: { name: 'demo-plugin' },
    components: [{
      type: 'pi-prompt-set',
      path: 'package.json',
      manifestField: 'pi.prompts',
      metadata: { entries: ['prompts/**', '!prompts/legacy/**'] },
    }],
  })
  assert.deepEqual(pi.rows, [{
    id: 'plugin-bridge-demo-plugin-prompt-prompts',
    name: '@openma/dsh-agents-plugins-bridge/prompt-commands',
    config: {
      dialect: 'pi',
      pluginName: 'demo-plugin',
      pluginRoot: '/fixture/plugin',
      entries: ['prompts/**', '!prompts/legacy/**'],
    },
  }])
  assert.deepEqual(pi.unsupported, [])
})

test('Claude LSP servers become independent DSH stdio providers with workspace semantics owned by DSH', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshLspAdapter)
  const result = kernel.materializePackage(source({
    '.lsp.json': {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio', '${CLAUDE_PLUGIN_ROOT}/tsconfig.json'],
        env: { PLUGIN_HOME: '${CLAUDE_PLUGIN_ROOT}' },
        extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
        initializationOptions: { preferences: { includePackageJsonAutoImports: 'on' } },
        workspaceFolder: '${CLAUDE_PROJECT_DIR}',
        startupTimeout: 120000,
      },
    },
  }), detected('claude-code-legacy', [{ type: 'lsp-server', path: '.lsp.json' }]))

  assert.deepEqual(result.rows, [{
    id: 'plugin-bridge-demo-plugin-lsp-typescript',
    name: '@deepseek-ai/dsh-lsp-stdio',
    config: {
      servers: {
        'plugin-bridge-demo-plugin-typescript': {
          command: 'typescript-language-server',
          args: ['--stdio', '/fixture/plugin/tsconfig.json'],
          env: { PLUGIN_HOME: '/fixture/plugin' },
          extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
          initializationOptions: { preferences: { includePackageJsonAutoImports: 'on' } },
        },
      },
    },
  }])
  assert.deepEqual(result.diagnostics, [
    'claude-code-legacy: lspServers.typescript.workspaceFolder is handled by DSH per query',
    'claude-code-legacy: lspServers.typescript.startupTimeout has no DSH provider setting and was ignored',
  ])
  assert.deepEqual(result.unsupported, [])
})

test('one component claimed by two adapters fails before producing partial rows', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter({
    name: 'alpha',
    componentTypes: ['skill'],
    materialize: () => [],
  })
  kernel.registerComponentAdapter({
    name: 'zulu',
    componentTypes: ['skill'],
    materialize: () => [],
  })

  assert.throws(
    () => kernel.materializePackage(source({ 'skills/': true }), detected('codex-legacy', [
      { type: 'skill', path: 'skills/' },
    ])),
    /component "skill" is claimed by multiple adapters: alpha, zulu/,
  )
})
