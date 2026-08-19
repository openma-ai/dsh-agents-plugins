import { readFile, writeFile } from 'node:fs/promises'

const bundles = [
  {
    source: new URL('../packages/ui/lib/client.js', import.meta.url),
    target: new URL('../lib/ui-client.js', import.meta.url),
    sourceId: '@openma/dsh-agents-plugins-bridge-ui',
    targetId: '@openma/dsh-agents-plugins-bridge/ui',
  },
  {
    source: new URL('../packages/theme-adapter/lib/client.js', import.meta.url),
    target: new URL('../lib/theme-client.js', import.meta.url),
    sourceId: '@openma/dsh-agents-plugins-bridge-theme',
    targetId: '@openma/dsh-agents-plugins-bridge/theme',
  },
]

for (const bundle of bundles) {
  const source = await readFile(bundle.source, 'utf8')
  const marker = `id: ${JSON.stringify(bundle.sourceId)}`
  const occurrences = source.split(marker).length - 1
  if (occurrences !== 1) {
    throw new Error(`${bundle.sourceId} client bundle must register exactly once; found ${occurrences}`)
  }
  const owned = source
    .replace(marker, `id: ${JSON.stringify(bundle.targetId)}`)
    .replace(/\n+\/\/# sourceMappingURL=client\.js\.map\s*$/u, '\n')
  await writeFile(bundle.target, owned)
}
