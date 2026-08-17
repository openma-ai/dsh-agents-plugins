import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { expect, it } from 'vitest'

it('the bridge panel renders four real capability sections and wires every action', async () => {
  const ui = await import('../src/client/PluginBridgeContent.js')
  expect(typeof ui.PluginBridgeContent).toBe('function')
  const calls: string[] = []
  const view = {
    snapshot: {
      installations: [{
        name: 'installed-demo',
        marketplace: 'team',
        format: 'codex-legacy',
        enabled: true,
        rowCount: 2,
        protectedCount: 1,
        unsupportedCount: 0,
        diagnostics: [],
      }],
      marketplaces: [{
        name: 'team',
        provider: 'codex-marketplace',
        plugins: ['catalog-demo'],
      }],
    },
    marketplaces: {
      candidates: [{
        ref: 'claude-code-registered-marketplaces:company',
        locator: 'claude-code-registered-marketplaces',
        name: 'company',
        sourceType: 'installed-checkout' as const,
        revision: 'main',
      }],
      diagnostics: [],
    },
    local: {
      candidates: [{
        ref: 'codex-local-cache:personal/local-demo/1.0.0',
        locator: 'codex-local-cache',
        name: 'local-demo',
        evidence: 'plugin-cache' as const,
        marketplace: 'personal',
        scope: 'user',
        enabled: true,
      }],
      diagnostics: [],
    },
  }
  const props = {
    view,
    busyAction: null,
    marketplaceLocation: '/catalog',
    t: (key: string) => key,
    onMarketplaceLocationChange: (value: string) => { calls.push(`location:${value}`) },
    onRescan: async () => { calls.push('rescan') },
    onAddMarketplace: async () => { calls.push('addMarketplace') },
    onImportMarketplace: async (ref: string) => { calls.push(`importMarketplace:${ref}`) },
    onImportLocal: async (ref: string) => { calls.push(`importLocal:${ref}`) },
    onInstall: async (name: string, marketplace: string) => { calls.push(`install:${name}@${marketplace}`) },
    onSetEnabled: async (name: string, enabled: boolean) => { calls.push(`enabled:${name}:${String(enabled)}`) },
  }

  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeContent as never, props))
  })
  const root = renderer!.root
  expect(
    root.findAll(node => node.type === 'section').map(node => node.props['data-section']),
  ).toEqual(['installed', 'configured-marketplaces', 'discovered-marketplaces', 'discovered-local'])
  const rendered = JSON.stringify(renderer!.toJSON())
  for (const detail of ['enabled', 'protected', 'unsupported', 'main', 'personal', 'user']) {
    expect(rendered).toContain(detail)
  }

  for (const button of root.findAllByType('button')) {
    expect(typeof button.props.onClick, `button ${String(button.props['data-action'])} has no action`).toBe('function')
  }
  await act(async () => {
    await root.findByProps({ 'data-action': 'rescan' }).props.onClick()
    await root.findByProps({ 'data-action': 'set-enabled' }).props.onClick()
    await root.findByProps({ 'data-action': 'install' }).props.onClick()
    await root.findByProps({ 'data-action': 'import-marketplace' }).props.onClick()
    await root.findByProps({ 'data-action': 'import-local' }).props.onClick()
    await root.findByProps({ 'data-action': 'add-marketplace' }).props.onClick()
  })

  expect(calls).toEqual([
    'rescan',
    'enabled:installed-demo:false',
    'install:catalog-demo@team',
    'importMarketplace:claude-code-registered-marketplaces:company',
    'importLocal:codex-local-cache:personal/local-demo/1.0.0',
    'addMarketplace',
  ])
})
