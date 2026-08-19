import { readdirSync, realpathSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import { minimatch } from 'minimatch'

const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'])

function contained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

function posix(path: string): string {
  return path.split(sep).join('/')
}

function staticPrefix(pattern: string): string {
  const wildcard = pattern.search(/[*?\[\]{}()]/u)
  if (wildcard < 0) return pattern
  const prefix = pattern.slice(0, wildcard)
  const slash = prefix.lastIndexOf('/')
  return slash < 0 ? '.' : prefix.slice(0, slash) || '.'
}

function walkFiles(root: string, start: string): string[] {
  let realStart: string
  try { realStart = realpathSync(start) } catch { return [] }
  if (!contained(root, realStart)) return []
  const stats = statSync(realStart)
  if (stats.isFile()) return [realStart]
  if (!stats.isDirectory()) return []
  const files: string[] = []
  for (const entry of readdirSync(realStart, { withFileTypes: true })) {
    const path = resolve(realStart, entry.name)
    let real: string
    try { real = realpathSync(path) } catch { continue }
    if (!contained(root, real)) continue
    if (entry.isDirectory()) files.push(...walkFiles(root, real))
    else if (entry.isFile()) files.push(real)
  }
  return files
}

function directFiles(root: string, target: string): string[] {
  let real: string
  try { real = realpathSync(target) } catch { return [] }
  if (!contained(root, real)) return []
  const stats = statSync(real)
  if (stats.isFile()) return [real]
  if (!stats.isDirectory()) return []
  const files: string[] = []
  for (const entry of readdirSync(real, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = realpathSync(resolve(real, entry.name))
    if (contained(root, file)) files.push(file)
  }
  return files
}

/** Resolve Pi extension expressions without allowing a symlink or pattern to leave the copied package. */
export function resolvePiExtensionFiles(pluginRoot: string, entries: readonly string[]): string[] {
  const root = realpathSync(pluginRoot)
  const excludes = entries.filter(entry => entry.startsWith('!')).map(entry => entry.slice(1))
  const files = new Set<string>()
  for (const expression of entries.filter(entry => !entry.startsWith('!'))) {
    const patterned = /[*?\[\]{}()]/u.test(expression)
    const start = resolve(root, patterned ? staticPrefix(expression) : expression)
    if (!contained(root, start)) throw new TypeError(`Pi extension path "${expression}" escapes the plugin root`)
    const candidates = patterned ? walkFiles(root, start) : directFiles(root, start)
    for (const file of candidates) {
      if (!EXTENSIONS.has(extname(file).toLowerCase())) continue
      const local = posix(relative(root, file))
      if (patterned && !minimatch(local, expression, { dot: true })) continue
      if (excludes.some(pattern => minimatch(local, pattern, { dot: true }))) continue
      files.add(file)
    }
  }
  return [...files].sort()
}
