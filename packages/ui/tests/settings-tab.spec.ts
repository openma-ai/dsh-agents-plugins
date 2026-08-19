import assert from 'node:assert/strict'
import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { it as test } from 'vitest'

test('the settings tab loads exclusively through its callback injection face', async () => {
  const ui = await import('../src/client/PluginBridgeSettingsTab.js').catch(() => undefined)
  assert.equal(typeof ui?.PluginBridgeSettingsTab, 'function')
  const empty = {
    snapshot: { installations: [], marketplaces: [] },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  let resolveLoad: ((value: typeof empty) => void) | undefined
  const calls: string[] = []
  const props = {
    t: (key: string) => key,
    load: () => {
      calls.push('load')
      return new Promise<typeof empty>((resolve) => { resolveLoad = resolve })
    },
    rescan: async () => empty,
    addMarketplace: async () => empty,
    importMarketplace: async () => empty,
    importLocal: async () => empty,
    install: async () => empty,
    setEnabled: async () => empty,
  }

  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui?.PluginBridgeSettingsTab as never, props))
  })
  assert.equal(renderer!.root.findByProps({ 'data-state': 'loading' }).type, 'p')
  assert.deepEqual(calls, ['load'])

  await act(async () => { resolveLoad?.(empty) })

  assert.equal(renderer!.root.findAll(node => node.type === 'section').length, 4)
  assert.equal(renderer!.root.findAllByProps({ 'data-state': 'loading' }).length, 0)
})

test('a failed initial load exposes a localized retry and recovers', async () => {
  const ui = await import('../src/client/PluginBridgeSettingsTab.js').catch(() => undefined)
  assert.equal(typeof ui?.PluginBridgeSettingsTab, 'function')
  const empty = {
    snapshot: { installations: [], marketplaces: [] },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  let attempts = 0
  const props = {
    t: (key: string) => key,
    load: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('transport detail')
      return empty
    },
    rescan: async () => empty,
    addMarketplace: async () => empty,
    importMarketplace: async () => empty,
    importLocal: async () => empty,
    install: async () => empty,
    setEnabled: async () => empty,
  }
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui?.PluginBridgeSettingsTab as never, props))
  })
  assert.equal(renderer!.root.findByProps({ role: 'alert' }).children.join(''), 'loadError')
  await act(async () => { renderer!.root.findByProps({ 'data-action': 'retry' }).props.onClick() })
  assert.equal(attempts, 2)
  assert.equal(renderer!.root.findAll(node => node.type === 'section').length, 4)
})

test('a mutation failure stays beside its action and hides transport details', async () => {
  const ui = await import('../src/client/PluginBridgeSettingsTab.js').catch(() => undefined)
  assert.equal(typeof ui?.PluginBridgeSettingsTab, 'function')
  const view = {
    snapshot: {
      installations: [{
        name: 'demo', marketplace: 'team', format: 'codex-legacy', enabled: true,
        rowCount: 1, protectedCount: 0, unsupportedCount: 0, diagnostics: [],
      }],
      marketplaces: [],
    },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  const props = {
    t: (key: string) => key,
    load: async () => view,
    rescan: async () => view,
    addMarketplace: async () => view,
    importMarketplace: async () => view,
    importLocal: async () => view,
    install: async () => view,
    setEnabled: async () => { throw new Error('TOKEN=must-not-render') },
  }
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui?.PluginBridgeSettingsTab as never, props))
  })
  await act(async () => { renderer!.root.findByProps({ 'data-action': 'set-enabled' }).props.onClick() })
  const alert = renderer!.root.findByProps({ 'data-operation-error': 'setEnabled:demo' }).children.join('')
  assert.equal(alert, 'mutationError')
  assert.doesNotMatch(alert, /TOKEN|must-not-render/u)
  assert.equal(renderer!.root.findAll(node => node.type === 'section').length, 4)
})

test('a failed marketplace add preserves the entered location', async () => {
  const ui = await import('../src/client/PluginBridgeSettingsTab.js')
  const empty = {
    snapshot: { installations: [], marketplaces: [] },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeSettingsTab as never, {
      t: (key: string) => key,
      load: async () => empty,
      rescan: async () => empty,
      addMarketplace: async () => { throw new Error('unreachable') },
      importMarketplace: async () => empty,
      importLocal: async () => empty,
      install: async () => empty,
      setEnabled: async () => empty,
    }))
  })
  await act(async () => {
    renderer!.root.findByType('input').props.onChange({ currentTarget: { value: '/catalog' } })
  })
  await act(async () => {
    await renderer!.root.findByProps({ 'data-action': 'add-marketplace' }).props.onClick()
  })
  assert.equal(renderer!.root.findByType('input').props.value, '/catalog')
})

test('marketplace install shows progress and becomes visibly installed', async () => {
  const ui = await import('../src/client/PluginBridgeSettingsTab.js')
  const initial = {
    snapshot: {
      installations: [],
      marketplaces: [{ name: 'team', provider: 'claude-code-marketplace', plugins: ['demo'] }],
    },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  const installed = {
    ...initial,
    snapshot: {
      ...initial.snapshot,
      installations: [{
        name: 'demo', marketplace: 'team', format: 'claude-code-legacy', enabled: true,
        rowCount: 1, protectedCount: 0, unsupportedCount: 0, diagnostics: [],
      }],
    },
  }
  let resolveInstall: ((value: typeof installed) => void) | undefined
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeSettingsTab as never, {
      t: (key: string) => key,
      load: async () => initial,
      rescan: async () => initial,
      addMarketplace: async () => initial,
      importMarketplace: async () => initial,
      importLocal: async () => initial,
      install: () => new Promise<typeof installed>((resolve) => { resolveInstall = resolve }),
      setEnabled: async () => initial,
    }))
  })

  const installButton = (): TestRenderer.ReactTestInstance => renderer!.root.findByProps({ 'data-action': 'install' })
  await act(async () => { installButton().props.onClick() })
  assert.equal(installButton().children.join(''), 'installing')
  assert.equal(installButton().props['aria-busy'], true)

  await act(async () => { resolveInstall?.(installed) })
  assert.equal(installButton().children.join(''), 'installed')
  assert.equal(installButton().props.disabled, true)
  assert.equal(installButton().props['data-install-state'], 'installed')
})

test('an install in progress leaves unrelated plugin actions usable', async () => {
  const ui = await import('../src/client/PluginBridgeSettingsTab.js')
  const view = {
    snapshot: {
      installations: [{
        name: 'existing', marketplace: 'team', format: 'claude-code-legacy', enabled: true,
        rowCount: 1, protectedCount: 0, unsupportedCount: 0, diagnostics: [],
      }],
      marketplaces: [{ name: 'team', provider: 'claude-code-marketplace', plugins: ['demo'] }],
    },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  let resolveInstall: ((value: typeof view) => void) | undefined
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeSettingsTab as never, {
      t: (key: string) => key,
      load: async () => view,
      rescan: async () => view,
      addMarketplace: async () => view,
      importMarketplace: async () => view,
      importLocal: async () => view,
      install: () => new Promise<typeof view>((resolve) => { resolveInstall = resolve }),
      setEnabled: async () => view,
    }))
  })

  await act(async () => { renderer!.root.findByProps({ 'data-action': 'install' }).props.onClick() })
  assert.equal(renderer!.root.findByProps({ 'data-action': 'install' }).props.disabled, true)
  assert.equal(renderer!.root.findByProps({ 'data-action': 'rescan' }).props.disabled, false)
  assert.equal(renderer!.root.findByProps({ 'data-action': 'set-enabled' }).props.disabled, false)
  await act(async () => { resolveInstall?.(view) })
})

test('a failed install stays on its marketplace row with a safe actionable reason', async () => {
  const ui = await import('../src/client/PluginBridgeSettingsTab.js')
  const view = {
    snapshot: {
      installations: [],
      marketplaces: [{ name: 'team', provider: 'claude-code-marketplace', plugins: ['demo'] }],
    },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeSettingsTab as never, {
      t: (key: string) => key,
      load: async () => view,
      rescan: async () => view,
      addMarketplace: async () => view,
      importMarketplace: async () => view,
      importLocal: async () => view,
      install: async () => { throw new Error('git clone timed out: TOKEN=must-not-render') },
      setEnabled: async () => view,
    }))
  })

  await act(async () => { renderer!.root.findByProps({ 'data-action': 'install' }).props.onClick() })
  const rowError = renderer!.root.findByProps({ 'data-operation-error': 'install:team:demo' })
  assert.equal(rowError.children.join(''), 'installErrorTimeout')
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /TOKEN|must-not-render/u)
  assert.equal(renderer!.root.findByProps({ 'data-action': 'install' }).props['data-install-state'], 'error')
  assert.equal(renderer!.root.findByProps({ 'data-action': 'install' }).props.disabled, false)
})

test('install failures distinguish source, compatibility, manifest, duplicate, and unknown causes', async () => {
  const ui = await import('../src/client/PluginBridgeSettingsTab.js')
  const view = {
    snapshot: {
      installations: [],
      marketplaces: [{ name: 'team', provider: 'claude-code-marketplace', plugins: ['demo'] }],
    },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  const cases = [
    ['Command failed: git clone https://example.invalid/demo.git', 'installErrorSource'],
    ['unsupported package format at demo', 'installErrorUnsupported'],
    ['plugin manifest is invalid', 'installErrorInvalid'],
    ['plugin "demo" is already installed', 'installErrorInstalled'],
    ['opaque host failure', 'installErrorGeneric'],
  ] as const

  for (const [message, expected] of cases) {
    let renderer: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(createElement(ui.PluginBridgeSettingsTab as never, {
        t: (key: string) => key,
        load: async () => view,
        rescan: async () => view,
        addMarketplace: async () => view,
        importMarketplace: async () => view,
        importLocal: async () => view,
        install: async () => { throw new Error(message) },
        setEnabled: async () => view,
      }))
    })
    await act(async () => { renderer!.root.findByProps({ 'data-action': 'install' }).props.onClick() })
    assert.equal(
      renderer!.root.findByProps({ 'data-operation-error': 'install:team:demo' }).children.join(''),
      expected,
    )
    renderer!.unmount()
  }
})

test('a Host-classified activation failure explains that DSH capability mounting failed', async () => {
  const ui = await import('../src/client/PluginBridgeSettingsTab.js')
  const view = {
    snapshot: {
      installations: [],
      marketplaces: [{ name: 'team', provider: 'claude-code-marketplace', plugins: ['demo'] }],
    },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  let renderer: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(createElement(ui.PluginBridgeSettingsTab as never, {
      t: (key: string) => key,
      load: async () => view,
      rescan: async () => view,
      addMarketplace: async () => view,
      importMarketplace: async () => view,
      importLocal: async () => view,
      install: async () => {
        throw Object.assign(new Error('private loader detail'), { reason: 'activation' })
      },
      setEnabled: async () => view,
    }))
  })

  await act(async () => { renderer!.root.findByProps({ 'data-action': 'install' }).props.onClick() })
  assert.equal(
    renderer!.root.findByProps({ 'data-operation-error': 'install:team:demo' }).children.join(''),
    'installErrorActivation',
  )
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /private loader detail/u)
})

test('unmount ignores a late load result', async () => {
  const ui = await import('../src/client/PluginBridgeSettingsTab.js').catch(() => undefined)
  assert.equal(typeof ui?.PluginBridgeSettingsTab, 'function')
  const empty = {
    snapshot: { installations: [], marketplaces: [] },
    marketplaces: { candidates: [], diagnostics: [] },
    local: { candidates: [], diagnostics: [] },
  }
  let resolveLoad: ((value: typeof empty) => void) | undefined
  const errors: unknown[][] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => { errors.push(args) }
  try {
    let renderer: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(createElement(ui?.PluginBridgeSettingsTab as never, {
        t: (key: string) => key,
        load: () => new Promise<typeof empty>((resolve) => { resolveLoad = resolve }),
        rescan: async () => empty,
        addMarketplace: async () => empty,
        importMarketplace: async () => empty,
        importLocal: async () => empty,
        install: async () => empty,
        setEnabled: async () => empty,
      }))
    })
    renderer!.unmount()
    await act(async () => { resolveLoad?.(empty) })
    assert.deepEqual(errors, [])
  } finally {
    console.error = originalError
  }
})
