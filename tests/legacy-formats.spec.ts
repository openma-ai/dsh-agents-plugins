import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PluginBridgeKernel, type PluginPackageSource } from '../src/kernel.js'
import { claudeCodeLegacyProvider } from '../src/providers/claude-code-legacy.js'
import { codexLegacyProvider } from '../src/providers/codex-legacy.js'

function source(files: Record<string, unknown>): PluginPackageSource {
  return {
    root: '/fixture/plugin',
    has: path => Object.hasOwn(files, path),
    kind: path => Object.hasOwn(files, path)
      ? path.endsWith('/') ? 'directory' : 'file'
      : undefined,
    readJson: path => files[path],
  }
}

test('Codex legacy manifest contributes skills, MCP servers, Apps, and hooks', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerPackageFormatProvider(codexLegacyProvider)

  const detected = kernel.detectPackageFormat(source({
    '.codex-plugin/plugin.json': {
      name: 'inline-preference-app',
      version: '0.1.0',
      skills: './skills/',
      mcpServers: './.mcp.json',
      apps: './.app.json',
    },
    'skills/': true,
    '.mcp.json': {},
    '.app.json': {},
    'hooks/hooks.json': {},
  }))

  assert.equal(detected.provider, 'codex-legacy')
  assert.deepEqual(detected.components, [
    { type: 'skill', path: 'skills/' },
    { type: 'mcp-server', path: '.mcp.json' },
    { type: 'app', path: '.app.json' },
    { type: 'hook', path: 'hooks/hooks.json' },
  ])
})

test('Claude Code legacy manifest combines defaults, custom paths, and inline components', () => {
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerPackageFormatProvider(claudeCodeLegacyProvider)

  const detected = kernel.detectPackageFormat(source({
    '.claude-plugin/plugin.json': {
      name: 'deployment-tools',
      skills: './extra-skills/',
      commands: ['./commands/release.md'],
      hooks: { hooks: {} },
      mcpServers: './mcp-config.json',
      agents: './custom-agents/',
    },
    'skills/': true,
    'extra-skills/': true,
    'commands/release.md': true,
    'mcp-config.json': {},
    'custom-agents/': true,
    '.lsp.json': {},
    'monitors/monitors.json': {},
  }))

  assert.equal(detected.provider, 'claude-code-legacy')
  assert.deepEqual(detected.components, [
    { type: 'skill', path: 'skills/' },
    { type: 'skill', path: 'extra-skills/' },
    { type: 'command', path: 'commands/release.md' },
    { type: 'agent', path: 'custom-agents/' },
    { type: 'hook', path: '.claude-plugin/plugin.json', manifestField: 'hooks' },
    { type: 'mcp-server', path: 'mcp-config.json' },
    { type: 'lsp-server', path: '.lsp.json' },
    { type: 'monitor', path: 'monitors/monitors.json' },
  ])
})

test('legacy providers reject declared component paths that escape the plugin root', () => {
  assert.throws(
    () => codexLegacyProvider.probe(source({
      '.codex-plugin/plugin.json': { name: 'bad-plugin', skills: '../skills/' },
    })),
    /plugin-relative path/,
  )
})

test('Codex legacy manifest honors declared hook paths instead of only the default hook file', () => {
  const detected = codexLegacyProvider.probe(source({
    '.codex-plugin/plugin.json': {
      name: 'repo-policy',
      hooks: ['./hooks/session.json', './hooks/tools.json'],
    },
    'hooks/session.json': {},
    'hooks/tools.json': {},
    'hooks/hooks.json': {},
  }))

  assert.deepEqual(detected?.components, [
    { type: 'hook', path: 'hooks/session.json' },
    { type: 'hook', path: 'hooks/tools.json' },
  ])
})
