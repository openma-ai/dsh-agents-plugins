import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { dshThemesAdapter } from '../src/adapters/dsh-themes.js'
import { PluginBridgeKernel } from '../src/kernel.js'
import { DirectoryPackageSource } from '../src/package-source.js'

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-themes-'))
  await mkdir(join(root, 'themes'), { recursive: true })
  return root
}

test('Pi themes resolve variables and xterm colors into a namespaced DSH client theme', async () => {
  const root = await fixture()
  await writeFile(join(root, 'themes', 'ocean.json'), JSON.stringify({
    name: 'ocean',
    vars: { blue: '#0066cc', gray: 242 },
    colors: {
      accent: 'blue',
      border: 'blue',
      muted: 'gray',
      text: '#eeeeee',
      selectedBg: '#101820',
      success: '#00ff00',
      error: '#ff0000',
      warning: '#ffff00',
    },
  }))
  const source = new DirectoryPackageSource(root)
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshThemesAdapter)

  const result = kernel.materializePackage(source, {
    provider: 'pi-package',
    manifestPath: 'package.json',
    manifest: { name: 'pi-toolbox' },
    components: [{
      type: 'pi-theme-set',
      path: 'package.json',
      manifestField: 'pi.themes',
      metadata: { entries: ['themes/**', '!themes/legacy/**'] },
    }],
  })

  assert.deepEqual(result.unsupported, [])
  assert.deepEqual(result.rows, [{
    id: 'plugin-bridge-pi-toolbox-themes',
    name: '@openma/dsh-agents-plugins-bridge/theme',
    config: {
      themes: [{
        id: 'pi-toolbox-ocean',
        colorScheme: 'dark',
        tokens: {
          '--dsw-alias-bg-layer-1': '#101820',
          '--dsw-alias-border-l2': '#0066cc',
          '--dsw-alias-brand-primary': '#0066cc',
          '--dsw-alias-label-primary': '#eeeeee',
          '--dsw-alias-label-secondary': '#6c6c6c',
          '--dsw-alias-state-error-primary': '#ff0000',
          '--dsw-alias-state-success-primary': '#00ff00',
          '--dsw-alias-state-warn-primary': '#ffff00',
        },
      }],
    },
  }])
})

test('Claude themes retain base palette semantics and map supported override roles', async () => {
  const root = await fixture()
  await writeFile(join(root, 'themes', 'paper.json'), JSON.stringify({
    name: 'Paper',
    base: 'light',
    overrides: {
      claude: '#a45a3a',
      text: '#25211f',
      subtle: '#716a65',
      userMessageBackground: '#f2ede8',
      error: '#b42318',
    },
  }))
  const source = new DirectoryPackageSource(root)
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshThemesAdapter)

  const result = kernel.materializePackage(source, {
    provider: 'claude-code-legacy',
    manifestPath: '.claude-plugin/plugin.json',
    manifest: { name: 'review-pack' },
    components: [{ type: 'theme', path: 'themes/' }],
  })

  assert.deepEqual(result.rows, [{
    id: 'plugin-bridge-review-pack-themes',
    name: '@openma/dsh-agents-plugins-bridge/theme',
    config: {
      themes: [{
        id: 'review-pack-paper',
        colorScheme: 'light',
        tokens: {
          '--dsw-alias-bg-layer-1': '#f2ede8',
          '--dsw-alias-brand-primary': '#a45a3a',
          '--dsw-alias-label-primary': '#25211f',
          '--dsw-alias-label-secondary': '#716a65',
          '--dsw-alias-state-error-primary': '#b42318',
        },
      }],
    },
  }])
})
