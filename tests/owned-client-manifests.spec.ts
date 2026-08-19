import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'

const requireFromBridge = createRequire(new URL('../package.json', import.meta.url))

for (const fixture of [
  {
    specifier: '@openma/dsh-agents-plugins-bridge/ui',
    inject: [
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-settings-plugins',
    ],
  },
  {
    specifier: '@openma/dsh-agents-plugins-bridge/theme',
    inject: ['@deepseek-ai/dsh-client-ui-theme'],
  },
] as const) {
  test(`${fixture.specifier} exposes the official dual-face client manifest`, () => {
    const manifestPath = requireFromBridge.resolve(`${fixture.specifier}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dsh?: { client?: { inject?: string[], platform?: string } }
      exports?: Record<string, string | { default?: string }>
    }
    assert.equal(manifest.dsh?.client?.platform, 'web')
    assert.deepEqual(manifest.dsh?.client?.inject, fixture.inject)

    const clientExport = manifest.exports?.['./client']
    const clientPath = typeof clientExport === 'string' ? clientExport : clientExport?.default
    assert.equal(typeof clientPath, 'string')
    const bundlePath = join(dirname(manifestPath), clientPath!)
    assert.equal(existsSync(bundlePath), true)
    assert.match(readFileSync(bundlePath, 'utf8'), new RegExp(`id: ${JSON.stringify(fixture.specifier)}`))
  })
}
