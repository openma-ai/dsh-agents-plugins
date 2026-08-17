import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PACKAGE_NAME = '@openma/dsh-agents-plugins-bridge-ui'
const CSS_PREFIX = '\0openma-plugin-bridge-css:'
const CSS_SUFFIX = '.mjs'

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: ['react', 'react/jsx-runtime'],
    alwaysBundle: (id: string) => id !== 'react' && id !== 'react/jsx-runtime',
    onlyBundle: ['zod'],
  },
  plugins: [
    {
      name: 'openma-plugin-bridge-css-modules',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css') || importer === undefined) return null
        return CSS_PREFIX + new URL(source, `file://${importer}`).pathname + CSS_SUFFIX
      },
      async load(id: string) {
        if (!id.startsWith(CSS_PREFIX)) return null
        const file = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
        this.addWatchFile(file)
        const result = transform({
          filename: file,
          code: await readFile(file),
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classes: Record<string, string> = {}
        for (const [local, value] of Object.entries(result.exports ?? {})) classes[local] = value.name
        const tag = `${PACKAGE_NAME}/${basename(file)}`
        return [
          `const css = ${JSON.stringify(result.code.toString())};`,
          `const tag = ${JSON.stringify(tag)};`,
          'if (document.querySelector(`style[data-plugin-css="${tag}"]`) === null) {',
          '  const node = document.createElement("style");',
          `  node.dataset.plugin = ${JSON.stringify(PACKAGE_NAME)};`,
          '  node.dataset.pluginCss = tag;',
          '  node.textContent = css;',
          '  document.head.appendChild(node);',
          '}',
          `export default ${JSON.stringify(classes)};`,
        ].join('\n')
      },
    },
    {
      name: 'openma-plugin-bridge-clean-generated-whitespace',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type === 'chunk') output.code = output.code.replace(/[\t ]+$/gmu, '')
        }
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
