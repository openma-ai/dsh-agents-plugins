import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { claudeCodeMarketplaceProvider } from '../src/marketplaces/claude-code.js'
import { codexMarketplaceProvider } from '../src/marketplaces/codex.js'

test('Claude Code marketplace normalizes documented relative and GitHub plugin sources', () => {
  const catalog = claudeCodeMarketplaceProvider.probe({
    manifestPath: '.claude-plugin/marketplace.json',
    manifest: {
      name: 'company-tools',
      owner: { name: 'DevTools Team' },
      plugins: [
        { name: 'code-formatter', source: './plugins/formatter' },
        {
          name: 'deployment-tools',
          source: {
            source: 'github',
            repo: 'company/deploy-plugin',
            ref: 'v2.0.0',
            sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
          },
        },
      ],
    },
  })

  assert.deepEqual(catalog, {
    name: 'company-tools',
    manifestPath: '.claude-plugin/marketplace.json',
    plugins: [
      {
        name: 'code-formatter',
        source: { kind: 'marketplace-relative-directory', path: './plugins/formatter' },
      },
      {
        name: 'deployment-tools',
        source: {
          kind: 'github-repository',
          repo: 'company/deploy-plugin',
          ref: 'v2.0.0',
          sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        },
      },
    ],
  })
})

test('Claude Code marketplace normalizes documented URL and git-subdir plugin sources', () => {
  const catalog = claudeCodeMarketplaceProvider.probe({
    manifestPath: '.claude-plugin/marketplace.json',
    manifest: {
      name: 'remote-tools',
      plugins: [
        {
          name: 'root-plugin',
          source: {
            source: 'url',
            url: 'https://github.com/example/root-plugin.git',
            path: 'claude-plugin/root-plugin',
            ref: 'main',
            sha: 'a1b2c3d4',
          },
        },
        {
          name: 'nested-plugin',
          source: {
            source: 'git-subdir',
            url: 'https://github.com/example/claude-plugins.git',
            path: 'plugins/nested-plugin',
            sha: 'e5f6a7b8',
          },
        },
        {
          name: 'catalog-pinned-plugin',
          source: {
            source: 'github',
            repo: 'example/catalog-pinned-plugin',
            commit: '0123456789abcdef0123456789abcdef01234567',
            sha: '89abcdef0123456789abcdef0123456789abcdef',
          },
        },
      ],
    },
  })

  assert.deepEqual(catalog?.plugins, [
    {
      name: 'root-plugin',
      source: {
        kind: 'git-repository',
        url: 'https://github.com/example/root-plugin.git',
        subdirectory: 'claude-plugin/root-plugin',
        ref: 'main',
        sha: 'a1b2c3d4',
      },
    },
    {
      name: 'nested-plugin',
      source: {
        kind: 'git-repository',
        url: 'https://github.com/example/claude-plugins.git',
        subdirectory: 'plugins/nested-plugin',
        sha: 'e5f6a7b8',
      },
    },
    {
      name: 'catalog-pinned-plugin',
      source: {
        kind: 'github-repository',
        repo: 'example/catalog-pinned-plugin',
        sha: '89abcdef0123456789abcdef0123456789abcdef',
      },
    },
  ])
})

test('Claude Code marketplace rejects duplicate plugin identifiers', () => {
  assert.throws(
    () => claudeCodeMarketplaceProvider.probe({
      manifestPath: '.claude-plugin/marketplace.json',
      manifest: {
        name: 'company-tools',
        plugins: [
          { name: 'formatter', source: './plugins/formatter-v1' },
          { name: 'formatter', source: './plugins/formatter-v2' },
        ],
      },
    }),
    /duplicate plugin name "formatter"/,
  )
})

test('Claude Code marketplace rejects plugin sources outside the supported safe subset', () => {
  const invalidSources: readonly unknown[] = [
    '../outside',
    './plugins/../outside',
    '/absolute/plugin',
    { source: 'github', repo: 'owner/repo/extra' },
    { source: 'npm', package: '@company/plugin' },
    { source: 'github', repo: 'company/plugin', command: 'run-me' },
  ]

  for (const source of invalidSources) {
    assert.throws(
      () => claudeCodeMarketplaceProvider.probe({
        manifestPath: '.claude-plugin/marketplace.json',
        manifest: {
          name: 'company-tools',
          plugins: [{ name: 'formatter', source }],
        },
      }),
      /marketplace\.plugins\[0\]\.source/,
    )
  }
})

test('Codex marketplace normalizes the local source shape used by the official catalog', () => {
  const fixtureUrl = new URL(
    './fixtures/marketplaces/codex-local/.agents/plugins/marketplace.json',
    import.meta.url,
  )
  const manifest: unknown = JSON.parse(readFileSync(fixtureUrl, 'utf8'))

  const catalog = codexMarketplaceProvider.probe({
    manifestPath: '.agents/plugins/marketplace.json',
    manifest,
  })

  assert.deepEqual(catalog, {
    name: 'openai-curated',
    manifestPath: '.agents/plugins/marketplace.json',
    plugins: [
      {
        name: 'linear',
        source: { kind: 'marketplace-relative-directory', path: './plugins/linear' },
      },
      {
        name: 'superpowers',
        source: { kind: 'marketplace-relative-directory', path: './plugins/superpowers' },
      },
    ],
  })
})

test('Codex marketplace recognizes the canonical .agents path and documented string local source', () => {
  const catalog = codexMarketplaceProvider.probe({
    manifestPath: '.agents/plugins/marketplace.json',
    manifest: {
      name: 'local-repo',
      plugins: [{ name: 'my-plugin', source: './plugins/my-plugin' }],
    },
  })

  assert.deepEqual(catalog, {
    name: 'local-repo',
    manifestPath: '.agents/plugins/marketplace.json',
    plugins: [{
      name: 'my-plugin',
      source: { kind: 'marketplace-relative-directory', path: './plugins/my-plugin' },
    }],
  })
})

test('Codex marketplace normalizes documented URL and git-subdir plugin sources', () => {
  const catalog = codexMarketplaceProvider.probe({
    manifestPath: '.agents/plugins/marketplace.json',
    manifest: {
      name: 'remote-tools',
      plugins: [
        {
          name: 'root-plugin',
          source: {
            source: 'url',
            url: 'https://github.com/example/root-plugin.git',
            ref: 'main',
          },
        },
        {
          name: 'nested-plugin',
          source: {
            source: 'git-subdir',
            url: 'https://github.com/example/codex-plugins.git',
            path: './plugins/nested-plugin',
            sha: 'a1b2c3d4',
          },
        },
      ],
    },
  })

  assert.deepEqual(catalog?.plugins, [
    {
      name: 'root-plugin',
      source: {
        kind: 'git-repository',
        url: 'https://github.com/example/root-plugin.git',
        ref: 'main',
      },
    },
    {
      name: 'nested-plugin',
      source: {
        kind: 'git-repository',
        url: 'https://github.com/example/codex-plugins.git',
        subdirectory: './plugins/nested-plugin',
        sha: 'a1b2c3d4',
      },
    },
  ])
})

test('Codex marketplace reports documented npm sources as explicitly unsupported', () => {
  assert.throws(
    () => codexMarketplaceProvider.probe({
      manifestPath: '.agents/plugins/marketplace.json',
      manifest: {
        name: 'registry-tools',
        plugins: [{
          name: 'npm-helper',
          source: { source: 'npm', package: '@example/codex-plugin', version: '^1.2.0' },
        }],
      },
    }),
    /npm marketplace sources are documented but not supported by this bridge/,
  )
})
