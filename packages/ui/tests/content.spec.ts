import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { expect, it } from 'vitest'

it('the bridge panel renders all capability sections and wires every action', async () => {
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
        requiredHosts: ['codex'],
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
    piUpdates: {
      mode: 'notify' as const,
      updates: [{
        id: 'a'.repeat(32),
        displayName: 'pi-demo',
        type: 'npm' as const,
        scope: 'user' as const,
        autoUpdate: true,
      }],
      lastCheckedAt: 1_000,
      nextCheckAt: 2_000,
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
    onCheckPiUpdates: async () => { calls.push('checkPiUpdates') },
    onSetPiUpdateMode: async (mode: string) => { calls.push(`piMode:${mode}`) },
    onSetPiPackageAutoUpdate: async (id: string, enabled: boolean) => {
      calls.push(`piAuto:${id}:${String(enabled)}`)
    },
    onUpdatePiPackage: async (id: string) => { calls.push(`piUpdate:${id}`) },
    onUpdateAllPiPackages: async () => { calls.push('piUpdateAll') },
  }

  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeContent as never, props))
  })
  const root = renderer!.root
  expect(
    root.findAll(node => node.type === 'section').map(node => node.props['data-section']),
  ).toEqual(['pi-updates', 'installed', 'configured-marketplaces', 'discovered-marketplaces', 'discovered-local'])
  const rendered = JSON.stringify(renderer!.toJSON())
  for (const detail of ['enabled', 'protected', 'unsupported', 'main', 'personal', 'user']) {
    expect(rendered).toContain(detail)
  }
  expect(root.findByProps({ 'data-notice': 'codex-host-required' })).toBeDefined()
  expect(rendered).toContain('codexHostRequired')

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
    await root.findByProps({ 'data-action': 'check-pi-updates' }).props.onClick()
    await root.findByProps({ 'data-action': 'update-pi-package' }).props.onClick()
    await root.findByProps({ 'data-action': 'update-all-pi-packages' }).props.onClick()
    await root.findByProps({ 'data-action': 'set-pi-update-mode' }).props.onChange({
      currentTarget: { value: 'auto' },
    })
    await root.findByProps({ 'data-action': 'set-pi-package-auto-update' }).props.onChange({
      currentTarget: { checked: false },
    })
  })

  expect(calls).toEqual([
    'rescan',
    'enabled:installed-demo:false',
    'install:catalog-demo@team',
    'importMarketplace:claude-code-registered-marketplaces:company',
    'importLocal:codex-local-cache:personal/local-demo/1.0.0',
    'addMarketplace',
    'checkPiUpdates',
    `piUpdate:${'a'.repeat(32)}`,
    'piUpdateAll',
    'piMode:auto',
    `piAuto:${'a'.repeat(32)}:false`,
  ])
})

it('a large marketplace is searchable inside one bounded catalog instead of becoming a button cloud', async () => {
  const ui = await import('../src/client/PluginBridgeContent.js')
  const plugins = Array.from({ length: 255 }, (_, index) => `plugin-${String(index).padStart(3, '0')}`)
  const view = {
    snapshot: {
      installations: [],
      marketplaces: [{
        name: 'claude-plugins-official',
        provider: 'claude-code-marketplace',
        plugins,
      }],
    },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeContent as never, {
      view,
      busyAction: null,
      marketplaceLocation: '',
      t: (key: string) => key,
      onMarketplaceLocationChange: () => {},
      onRescan: async () => {},
      onAddMarketplace: async () => {},
      onImportMarketplace: async () => {},
      onImportLocal: async () => {},
      onInstall: async () => {},
      onSetEnabled: async () => {},
    }))
  })

  const root = renderer!.root
  const catalog = root.findByProps({ 'data-catalog': 'claude-plugins-official' })
  expect(catalog.type).toBe('details')
  expect(catalog.findByProps({ 'data-catalog-summary': true }).props['aria-label']).toContain('255')
  expect(catalog.findByProps({ 'data-catalog-scroll': true })).toBeDefined()
  expect(catalog.findAllByProps({ 'data-catalog-plugin': true })).toHaveLength(255)
  expect(catalog.findByProps({ 'data-action': 'filter-marketplace' }).props['data-control-size']).toBe('large')

  await act(async () => {
    catalog.findByProps({ 'data-action': 'filter-marketplace' }).props.onChange({
      currentTarget: { value: 'plugin-127' },
    })
  })
  expect(catalog.findAllByProps({ 'data-catalog-plugin': true })).toHaveLength(1)
  expect(catalog.findByProps({ title: 'plugin-127' })).toBeDefined()
})
