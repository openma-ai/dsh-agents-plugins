import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import config from '../tsdown.client.config.ts'

interface CssPlugin {
  readonly name?: string
  resolveId?: (source: string, importer: string | undefined) => string | null
  load?: (this: { addWatchFile: (file: string) => void }, id: string) => Promise<string | null>
}

test('CSS module output is independent of the checkout path', async () => {
  const plugin = config.plugins?.find(candidate => candidate.name === 'openma-plugin-bridge-css-modules') as CssPlugin | undefined
  assert.ok(plugin?.resolveId)
  assert.ok(plugin.load)

  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-css-'))
  try {
    const outputs: string[] = []
    for (const checkout of ['checkout-a', 'checkout-b']) {
      const clientDir = join(root, checkout, 'src', 'client')
      await mkdir(clientDir, { recursive: true })
      await writeFile(join(clientDir, 'Panel.module.css'), [
        '.zeta { color: blue; }',
        '.root { color: red; }',
        '.alpha { color: green; }',
        '',
      ].join('\n'))

      const id = plugin.resolveId('./Panel.module.css', join(clientDir, 'index.ts'))
      assert.ok(id)
      const output = await plugin.load.call({ addWatchFile() {} }, id)
      assert.ok(output)
      outputs.push(output)
    }

    assert.equal(outputs[0], outputs[1])
    assert.doesNotMatch(outputs[0], /plugin-bridge-css-|checkout-[ab]/u)
    assert.match(outputs[0], /export default \{"alpha":.*,"root":.*,"zeta":.*\};$/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
