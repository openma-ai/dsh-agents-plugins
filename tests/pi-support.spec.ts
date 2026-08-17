import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { dshSkillsAdapter } from '../src/adapters/dsh-skills.js'
import { createPiInstalledPluginLocator } from '../src/discovery/pi.js'
import { PluginBridgeKernel } from '../src/kernel.js'
import { DirectoryPackageSource } from '../src/package-source.js'
import { piPackageProvider } from '../src/providers/pi-package.js'

async function packageRoot(
  manifest: Record<string, unknown>,
  directories: readonly string[] = [],
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-pi-package-'))
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  for (const directory of directories) await mkdir(join(root, directory), { recursive: true })
  return root
}

test('Pi manifest maps only directory skills onto the shared DSH skill capability', async () => {
  const root = await packageRoot({
    name: 'pi-toolbox',
    version: '1.2.3',
    pi: {
      extensions: ['./extensions'],
      skills: ['./skills'],
      prompts: ['./prompts'],
      themes: ['./themes'],
    },
  }, ['extensions', 'skills', 'prompts', 'themes'])

  const detected = piPackageProvider.probe(new DirectoryPackageSource(root))

  assert.deepEqual(detected?.components, [
    { type: 'pi-extension', path: 'extensions/' },
    { type: 'skill', path: 'skills/' },
    { type: 'pi-prompt', path: 'prompts/' },
    { type: 'pi-theme', path: 'themes/' },
  ])
})

test('Pi convention directories claim a package without relying on the discovery keyword', async () => {
  const conventional = await packageRoot({ name: 'conventional-pi' }, [
    'extensions',
    'skills',
    'prompts',
    'themes',
  ])
  const generic = await packageRoot({ name: 'ordinary-node-package', keywords: ['pi-package'] })

  assert.deepEqual(piPackageProvider.probe(new DirectoryPackageSource(conventional))?.components, [
    { type: 'pi-extension', path: 'extensions/' },
    { type: 'skill', path: 'skills/' },
    { type: 'pi-prompt', path: 'prompts/' },
    { type: 'pi-theme', path: 'themes/' },
  ])
  assert.equal(piPackageProvider.probe(new DirectoryPackageSource(generic)), undefined)
})

test('Pi provider rejects malformed resource lists and paths outside the package root', async () => {
  const malformed = await packageRoot({
    name: 'malformed-pi',
    pi: { skills: './skills' },
  }, ['skills'])
  const escaping = await packageRoot({
    name: 'escaping-pi',
    pi: { skills: ['../skills'] },
  })

  assert.throws(
    () => piPackageProvider.probe(new DirectoryPackageSource(malformed)),
    /pi-package: pi\.skills must be an array of strings/,
  )
  assert.throws(
    () => piPackageProvider.probe(new DirectoryPackageSource(escaping)),
    /pi-package: pi\.skills.*within the package root/,
  )
})

test('Pi skill directories materialize while runtime-specific resources stay explicit', async () => {
  const root = await packageRoot({
    name: 'pi-toolbox',
    pi: {
      extensions: ['./extensions'],
      skills: ['./skills'],
      prompts: ['./prompts'],
      themes: ['./themes'],
    },
  }, ['extensions', 'skills', 'prompts', 'themes'])
  const source = new DirectoryPackageSource(root)
  const observation = piPackageProvider.probe(source)
  assert.notEqual(observation, undefined)

  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshSkillsAdapter)
  const result = kernel.materializePackage(source, {
    provider: piPackageProvider.name,
    ...observation!,
  })

  assert.deepEqual(result.rows, [{
    id: 'plugin-bridge-pi-toolbox-skill-skills',
    name: '@deepseek-ai/dsh-skill-filesystem',
    config: {
      providerName: 'plugin-bridge-pi-toolbox-skills',
      includeDefaultRoots: false,
      customSkillDirs: [join(await realpath(root), 'skills')],
    },
  }])
  assert.deepEqual(result.unsupported, [
    { type: 'pi-extension', path: 'extensions/' },
    { type: 'pi-prompt', path: 'prompts/' },
    { type: 'pi-theme', path: 'themes/' },
  ])
})

test('Pi locator resolves npm, git, and local settings entries while isolating broken packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-pi-discovery-'))
  const agentDir = join(root, '.pi', 'agent')
  const settingsPath = join(agentDir, 'settings.json')
  const npmPackage = join(agentDir, 'npm', 'node_modules', '@scope', 'npm-pi')
  const gitPackage = join(agentDir, 'git', 'github.com', 'openma-ai', 'git-pi')
  const localPackage = join(root, 'local-pi')
  const brokenPackage = join(root, 'broken-pi')
  await mkdir(npmPackage, { recursive: true })
  await mkdir(join(gitPackage, 'skills'), { recursive: true })
  await mkdir(join(localPackage, 'skills'), { recursive: true })
  await mkdir(brokenPackage, { recursive: true })
  await writeFile(join(npmPackage, 'package.json'), JSON.stringify({
    name: '@scope/npm-pi',
    version: '2.3.4',
    pi: { skills: [] },
  }))
  await writeFile(join(gitPackage, 'package.json'), JSON.stringify({ name: 'git-pi' }))
  await writeFile(join(localPackage, 'package.json'), JSON.stringify({ name: 'local-pi' }))
  await writeFile(join(brokenPackage, 'package.json'), '{')
  await mkdir(agentDir, { recursive: true })
  await writeFile(settingsPath, JSON.stringify({
    packages: [
      'npm:@scope/npm-pi@2.3.4',
      { source: 'git:github.com/openma-ai/git-pi@v1', skills: ['./skills'] },
      '../../local-pi',
      '../../broken-pi',
      'npm:missing-pi',
      { source: 42 },
    ],
  }))

  const observation = await createPiInstalledPluginLocator({ settingsPath }).discover()

  assert.deepEqual(observation.candidates.slice(0, 2), [
    {
      key: 'user/npm/%40scope%2Fnpm-pi',
      name: '@scope/npm-pi',
      root: await realpath(npmPackage),
      evidence: 'installed-registry',
      version: '2.3.4',
      scope: 'user',
    },
    {
      key: 'user/git/github.com%2Fopenma-ai%2Fgit-pi',
      name: 'git-pi',
      root: await realpath(gitPackage),
      evidence: 'installed-registry',
      scope: 'user',
    },
  ])
  const local = observation.candidates[2]
  assert.notEqual(local, undefined)
  assert.match(local!.key, /^user\/local\/[a-f0-9]{64}$/u)
  assert.doesNotMatch(local!.key, /%2F|%5C|local-pi/iu)
  assert.deepEqual({ ...local, key: '<opaque>' }, {
    key: '<opaque>',
    name: 'local-pi',
    root: await realpath(localPackage),
    evidence: 'installed-registry',
    scope: 'user',
  })
  assert.equal(observation.diagnostics?.length, 3)
  assert.match(observation.diagnostics?.join('\n') ?? '', /broken-pi.*invalid/i)
  assert.match(observation.diagnostics?.join('\n') ?? '', /missing-pi.*cannot be inspected/i)
  assert.match(observation.diagnostics?.join('\n') ?? '', /packages\[5\].*source/i)
})
