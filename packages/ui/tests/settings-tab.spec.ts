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

test('a mutation failure keeps the current view and hides transport details', async () => {
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
  const alert = renderer!.root.findByProps({ role: 'alert' }).children.join('')
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
