import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginPackageSource } from '../src/kernel.js'
import {
  AGENT_PLUGINS_V1_MCP_SCHEMA,
  AGENT_PLUGINS_V1_SCHEMA,
  agentPluginsV1Provider,
} from '../src/providers/agent-plugins-v1.js'

function source(
  files: Record<string, unknown>,
  kinds: Readonly<Record<string, 'file' | 'directory' | 'other'>> = {},
): PluginPackageSource {
  const packageSource = {
    root: '/fixture/plugin',
    has: (path: string) => Object.hasOwn(files, path),
    kind: (path: string) => Object.hasOwn(files, path)
      ? kinds[path] ?? (path.endsWith('/') ? 'directory' : 'file')
      : undefined,
    readJson: (path: string) => {
      if ((kinds[path] ?? (path.endsWith('/') ? 'directory' : 'file')) !== 'file') {
        throw new TypeError(`package path "${path}" is not a regular file`)
      }
      return files[path]
    },
  }
  return packageSource
}

function manifest(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { $schema: AGENT_PLUGINS_V1_SCHEMA, name, ...extra }
}

test('Agent Plugins v1 enforces the normative plugin name constraints', () => {
  for (const name of ['', 'Uppercase', '-leading', 'trailing-', 'has--double', 'has..double', 'a'.repeat(65)]) {
    assert.throws(
      () => agentPluginsV1Provider.probe(source({ 'plugin.json': manifest(name) })),
      /field "name"/,
      name,
    )
  }

  assert.equal(
    agentPluginsV1Provider.probe(source({ 'plugin.json': manifest('acme.tools-v1') }))?.manifest.name,
    'acme.tools-v1',
  )
})

test('Agent Plugins v1 treats author as a closed string-valued object', () => {
  for (const author of [
    'OpenMA',
    { name: 42 },
    { name: 'OpenMA', handle: '@openma' },
  ]) {
    assert.throws(
      () => agentPluginsV1Provider.probe(source({
        'plugin.json': manifest('portable-plugin', { author }),
      })),
      /field "author"/,
    )
  }

  assert.deepEqual(
    agentPluginsV1Provider.probe(source({
      'plugin.json': manifest('portable-plugin', {
        author: { name: '', email: 'not-validated@example', url: 'not necessarily a URL' },
      }),
    }))?.manifest.author,
    { name: '', email: 'not-validated@example', url: 'not necessarily a URL' },
  )
})

test('an invalid portable mcp.json disables only MCP and keeps independent skills', () => {
  const detected = agentPluginsV1Provider.probe(source({
    'plugin.json': manifest('portable-plugin'),
    'skills/': true,
    'mcp.json': {
      $schema: `${AGENT_PLUGINS_V1_MCP_SCHEMA}.unsupported`,
      mcpServers: { ignored: { type: 'stdio', command: 'node' } },
    },
  }))

  assert.deepEqual(detected?.components, [{ type: 'skill', path: 'skills/' }])
  assert.match(detected?.diagnostics?.join('\n') ?? '', /mcp\.json.*unsupported.*schema/i)
})

test('a non-directory skills entry disables only skills and keeps independent MCP', () => {
  const detected = agentPluginsV1Provider.probe(source({
    'plugin.json': manifest('portable-plugin'),
    'skills/': true,
    'mcp.json': {
      $schema: AGENT_PLUGINS_V1_MCP_SCHEMA,
      mcpServers: {},
    },
  }, { 'skills/': 'file' }))

  assert.deepEqual(detected?.components, [
    { type: 'agent-plugin-mcp-server', path: 'mcp.json' },
  ])
  assert.match(detected?.diagnostics?.join('\n') ?? '', /skills\/.*must be a directory/i)
})

test('a non-file mcp.json disables only MCP and keeps independent skills', () => {
  const detected = agentPluginsV1Provider.probe(source({
    'plugin.json': manifest('portable-plugin'),
    'skills/': true,
    'mcp.json': {},
  }, { 'mcp.json': 'directory' }))

  assert.deepEqual(detected?.components, [{ type: 'skill', path: 'skills/' }])
  assert.match(detected?.diagnostics?.join('\n') ?? '', /mcp\.json.*must be a regular file/i)
})
