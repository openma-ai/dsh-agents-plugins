import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReleasePlan } from '../lib/release-plan.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function npm(args, cwd, stdio = 'pipe') {
  return spawnSync('npm', args, { cwd, encoding: 'utf8', stdio })
}

function isPublished(pkg) {
  const result = npm(['view', `${pkg.name}@${pkg.version}`, 'version', '--json'], root)
  if (result.status === 0) return true
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (/E404|404 Not Found/u.test(output)) return false
  throw new Error(`failed to query ${pkg.name}@${pkg.version}: ${output.trim()}`)
}

async function main() {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME
  if (tag === undefined) throw new Error('release tag argument or GITHUB_REF_NAME is required')
  const plan = await createReleasePlan(root, tag)
  for (const pkg of plan) {
    if (isPublished(pkg)) {
      process.stdout.write(`skip ${pkg.name}@${pkg.version}: already published\n`)
      continue
    }
    const result = npm(
      ['publish', '--access', 'public', '--provenance'],
      join(root, pkg.directory),
      'inherit',
    )
    if (result.status !== 0) throw new Error(`publishing ${pkg.name}@${pkg.version} failed`)
  }
}

await main()
