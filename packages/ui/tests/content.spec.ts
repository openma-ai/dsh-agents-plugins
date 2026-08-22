import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { expect, it } from 'vitest'

it('secondary tabs partition Codex, Claude Code, and Pi bridge state', async () => {
  const ui = await import('../src/client/PluginBridgeContent.js')
  const view = {
    snapshot: {
      installations: [
        {
          name: 'codex-demo', marketplace: 'codex-team', format: 'codex-legacy', enabled: true,
          rowCount: 1, protectedCount: 0, requiredHosts: [], unsupportedCount: 0, diagnostics: [],
        },
        {
          name: 'claude-demo', marketplace: 'claude-team', format: 'claude-code-legacy', enabled: true,
          rowCount: 1, protectedCount: 0, requiredHosts: [], unsupportedCount: 0, diagnostics: [],
        },
        {
          name: 'pi-demo', marketplace: 'import:pi-installed-user', format: 'pi-package', enabled: true,
          rowCount: 1, protectedCount: 0, requiredHosts: [], unsupportedCount: 0, diagnostics: [],
        },
      ],
      marketplaces: [
        { name: 'codex-team', provider: 'codex-marketplace', plugins: ['codex-catalog'] },
        { name: 'claude-team', provider: 'claude-code-marketplace', plugins: ['claude-catalog'] },
      ],
    },
    marketplaces: {
      candidates: [
        {
          ref: 'codex-registered-marketplaces:codex-market', locator: 'codex-registered-marketplaces',
          name: 'codex-market', sourceType: 'local' as const,
        },
        {
          ref: 'claude-code-registered-marketplaces:claude-market', locator: 'claude-code-registered-marketplaces',
          name: 'claude-market', sourceType: 'installed-checkout' as const,
        },
      ],
      diagnostics: [
        'codex-registered-marketplaces: 1 diagnostic; details are available in Host logs',
        'claude-code-registered-marketplaces: 1 diagnostic; details are available in Host logs',
      ],
    },
    local: {
      candidates: [
        {
          ref: 'codex-local-cache:personal/codex-local/1.0.0', locator: 'codex-local-cache',
          name: 'codex-local', evidence: 'plugin-cache' as const,
        },
        {
          ref: 'claude-code-installed:claude-local', locator: 'claude-code-installed',
          name: 'claude-local', evidence: 'installed-registry' as const,
        },
        {
          ref: 'pi-installed-user:pi-local', locator: 'pi-installed-user',
          name: 'pi-local', evidence: 'installed-registry' as const,
        },
      ],
      diagnostics: [
        'codex-local-cache: 1 diagnostic; details are available in Host logs',
        'claude-code-installed: 1 diagnostic; details are available in Host logs',
        'pi-installed-user: 1 diagnostic; details are available in Host logs',
      ],
    },
    piUpdates: { mode: 'notify' as const, updates: [] },
  }
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeContent as never, {
      view,
      marketplaceLocation: '',
      t: (key: string) => key,
      onMarketplaceLocationChange: () => {},
      onRescan: async () => {},
      onAddMarketplace: async () => {},
      onImportMarketplace: async () => {},
      onImportLocal: async () => {},
      onInstall: async () => {},
      onSetEnabled: async () => {},
      onCheckPiUpdates: async () => {},
      onSetPiUpdateMode: async () => {},
      onSetPiPackageAutoUpdate: async () => {},
      onUpdatePiPackage: async () => {},
      onUpdateAllPiPackages: async () => {},
    }))
  })

  const root = renderer!.root
  expect(root.findByProps({ role: 'tablist' })).toBeDefined()
  expect(root.findAllByProps({ role: 'tab' }).map(tab => tab.props['data-bridge-tab'])).toEqual([
    'overview', 'codex', 'claude-code', 'pi',
  ])
  expect(root.findByProps({ 'data-bridge-tab': 'overview' }).props['aria-selected']).toBe(true)

  await act(async () => { root.findByProps({ 'data-bridge-tab': 'claude-code' }).props.onClick() })
  const claudePanel = root.findByProps({ role: 'tabpanel' })
  const claudeRendered = JSON.stringify(renderer!.toJSON())
  expect(claudeRendered).toContain('claude-demo')
  expect(claudeRendered).toContain('claude-catalog')
  expect(claudeRendered).toContain('claude-market')
  expect(claudeRendered).toContain('claude-local')
  expect(claudeRendered).toContain('claude-code-installed: 1 diagnostic')
  expect(claudeRendered).not.toContain('codex-demo')
  expect(claudeRendered).not.toContain('pi-demo')
  expect(claudePanel.findAllByProps({ 'data-section': 'pi-updates' })).toHaveLength(0)

  await act(async () => { root.findByProps({ 'data-bridge-tab': 'pi' }).props.onClick() })
  const piPanel = root.findByProps({ role: 'tabpanel' })
  const piRendered = JSON.stringify(renderer!.toJSON())
  expect(piRendered).toContain('pi-demo')
  expect(piRendered).toContain('pi-local')
  expect(piRendered).toContain('pi-installed-user: 1 diagnostic')
  expect(piRendered).not.toContain('claude-demo')
  expect(piPanel.findAllByProps({ 'data-section': 'pi-updates' })).toHaveLength(1)
  expect(piPanel.findAllByProps({ 'data-section': 'configured-marketplaces' })).toHaveLength(0)
  expect(piPanel.findAllByProps({ 'data-section': 'discovered-marketplaces' })).toHaveLength(0)
})

it('authoritative Bridge state wins over stale discovery actions and errors', async () => {
  const ui = await import('../src/client/PluginBridgeContent.js')
  const view = {
    snapshot: {
      installations: [{
        name: 'chatcut', marketplace: 'import:codex-local-cache', format: 'codex-legacy', enabled: true,
        rowCount: 1, protectedCount: 0, requiredHosts: [], unsupportedCount: 0, diagnostics: [],
      }],
      marketplaces: [{
        name: 'chatcut-inc', provider: 'codex-marketplace', plugins: ['chatcut'],
      }],
    },
    marketplaces: {
      candidates: [{
        ref: 'codex-registered-marketplaces:chatcut-inc', locator: 'codex-registered-marketplaces',
        name: 'chatcut-inc', sourceType: 'git' as const,
      }],
      diagnostics: [],
    },
    local: {
      candidates: [{
        ref: 'codex-local-cache:chatcut-inc/chatcut/0.2.16', locator: 'codex-local-cache',
        name: 'chatcut', evidence: 'plugin-cache' as const, version: '0.2.16', marketplace: 'chatcut-inc',
      }],
      diagnostics: [],
    },
    piUpdates: { mode: 'notify' as const, updates: [] },
  }
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeContent as never, {
      view,
      mutationFeedback: {
        'importLocal:codex-local-cache:chatcut-inc/chatcut/0.2.16': {
          status: 'error', messageKey: 'mutationError',
        },
      },
      marketplaceLocation: '',
      t: (key: string) => key,
      onMarketplaceLocationChange: () => {},
      onRescan: async () => {},
      onAddMarketplace: async () => {},
      onImportMarketplace: async () => {},
      onImportLocal: async () => {},
      onInstall: async () => {},
      onSetEnabled: async () => {},
      onCheckPiUpdates: async () => {},
      onSetPiUpdateMode: async () => {},
      onSetPiPackageAutoUpdate: async () => {},
      onUpdatePiPackage: async () => {},
      onUpdateAllPiPackages: async () => {},
    }))
  })

  const root = renderer!.root
  const localButton = root.findByProps({ 'data-action': 'import-local' })
  expect(localButton.props['data-import-state']).toBe('imported')
  expect(localButton.props.disabled).toBe(true)
  expect(localButton.children.join('')).toBe('imported')
  expect(root.findAllByProps({
    'data-operation-error': 'importLocal:codex-local-cache:chatcut-inc/chatcut/0.2.16',
  })).toHaveLength(0)

  const marketplaceButton = root.findByProps({ 'data-action': 'import-marketplace' })
  expect(marketplaceButton.props['data-import-state']).toBe('imported')
  expect(marketplaceButton.props.disabled).toBe(true)
  expect(marketplaceButton.children.join('')).toBe('imported')
  expect(root.findByProps({ 'data-action': 'install' }).props['data-install-state']).toBe('installed')
})

it('a failed discovery import becomes an enabled retry action', async () => {
  const ui = await import('../src/client/PluginBridgeContent.js')
  const ref = 'codex-local-cache:personal/demo/1.0.0'
  const view = {
    snapshot: { installations: [], marketplaces: [] },
    marketplaces: { candidates: [], diagnostics: [] },
    local: {
      candidates: [{
        ref, locator: 'codex-local-cache', name: 'demo', evidence: 'plugin-cache' as const,
      }],
      diagnostics: [],
    },
    piUpdates: { mode: 'notify' as const, updates: [] },
  }
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeContent as never, {
      view,
      mutationFeedback: { [`importLocal:${ref}`]: { status: 'error', messageKey: 'mutationError' } },
      marketplaceLocation: '',
      t: (key: string) => key,
      onMarketplaceLocationChange: () => {},
      onRescan: async () => {},
      onAddMarketplace: async () => {},
      onImportMarketplace: async () => {},
      onImportLocal: async () => {},
      onInstall: async () => {},
      onSetEnabled: async () => {},
      onCheckPiUpdates: async () => {},
      onSetPiUpdateMode: async () => {},
      onSetPiPackageAutoUpdate: async () => {},
      onUpdatePiPackage: async () => {},
      onUpdateAllPiPackages: async () => {},
    }))
  })

  const button = renderer!.root.findByProps({ 'data-action': 'import-local' })
  expect(button.props['data-import-state']).toBe('error')
  expect(button.props.disabled).toBe(false)
  expect(button.children.join('')).toBe('retry')
})

it('a remote marketplace registration says that adding it downloads the catalog', async () => {
  const ui = await import('../src/client/PluginBridgeContent.js')
  const ref = 'codex-registered-marketplaces:chatcut-inc'
  const view = {
    snapshot: { installations: [], marketplaces: [] },
    marketplaces: {
      candidates: [{
        ref,
        locator: 'codex-registered-marketplaces',
        name: 'chatcut-inc',
        sourceType: 'git' as const,
        revision: 'main',
      }],
      diagnostics: [],
    },
    local: { candidates: [], diagnostics: [] },
    piUpdates: { mode: 'notify' as const, updates: [] },
  }
  const props = {
    view,
    marketplaceLocation: '',
    t: (key: string) => key,
    onMarketplaceLocationChange: () => {},
    onRescan: async () => {},
    onAddMarketplace: async () => {},
    onImportMarketplace: async () => {},
    onImportLocal: async () => {},
    onInstall: async () => {},
    onSetEnabled: async () => {},
    onCheckPiUpdates: async () => {},
    onSetPiUpdateMode: async () => {},
    onSetPiPackageAutoUpdate: async () => {},
    onUpdatePiPackage: async () => {},
    onUpdateAllPiPackages: async () => {},
  }
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeContent as never, props))
  })

  expect(renderer!.root.findByProps({ 'data-action': 'import-marketplace' }).children.join('')).toBe('add')
  expect(JSON.stringify(renderer!.toJSON())).toContain('remoteMarketplaceRegistration')

  await act(async () => {
    renderer!.update(createElement(ui.PluginBridgeContent as never, {
      ...props,
      mutationFeedback: { [`importMarketplace:${ref}`]: { status: 'pending' } },
    }))
  })
  expect(renderer!.root.findByProps({ 'data-action': 'import-marketplace' }).children.join('')).toBe('downloading')
})

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
