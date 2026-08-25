import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const requireFromBridge = createRequire(new URL('../package.json', import.meta.url))
const requireFromMcpApps = createRequire(
  requireFromBridge.resolve('@openma/dsh-mcp-apps/package.json'),
)

for (const fixture of [
  {
    entry: '../src/mcp-apps-host.ts',
    dependency: '@openma/dsh-mcp-apps-host',
    name: 'plugin-bridge-mcp-apps-host',
  },
  {
    entry: '../src/mcp-apps-web.ts',
    dependency: '@openma/dsh-mcp-apps-web',
    name: 'plugin-bridge-mcp-apps-web',
  },
] as const) {
  test(`${fixture.name} resolves the nested MCP Apps runtime from Bridge's dependency graph`, async () => {
    const entry = new URL(fixture.entry, import.meta.url).href
    let wrapper: {
      apply(ctx: unknown, config: unknown): Promise<void>
      inject: readonly string[]
      name: string
    }
    try {
      wrapper = await import(entry)
    } catch (cause) {
      assert.fail(`wrapper entry ${fixture.entry} must load: ${String(cause)}`)
    }

    const imported: string[] = []
    const mounted: Array<{ plugin: unknown, config: unknown }> = []
    const plugin = { name: fixture.dependency, apply() {} }
    const config = { marker: fixture.name }
    await wrapper.apply({
      loader: {
        import: async (specifier: string) => {
          imported.push(specifier)
          return plugin
        },
        unwrapExports: (exports: unknown) => exports,
      },
      plugin: async (mountedPlugin: unknown, mountedConfig: unknown) => {
        mounted.push({ plugin: mountedPlugin, config: mountedConfig })
      },
    }, config)

    assert.equal(wrapper.name, fixture.name)
    assert.deepEqual(wrapper.inject, ['loader'])
    assert.deepEqual(imported, [pathToFileURL(requireFromMcpApps.resolve(fixture.dependency)).href])
    assert.deepEqual(mounted, [{ plugin, config }])
  })
}
