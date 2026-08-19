import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { minimatch } from 'minimatch'
import { parse } from 'yaml'

export interface Config {
  readonly providerName: string
  readonly pluginRoot: string
  readonly entries: readonly string[]
}

interface ParsedSkill {
  readonly attributes: Readonly<Record<string, unknown>>
  readonly body: string
}

function contained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

function posix(path: string): string {
  return path.split(sep).join('/')
}

function parsedSkill(markdown: string): ParsedSkill {
  const normalized = markdown.replace(/\r\n/gu, '\n')
  if (!normalized.startsWith('---\n')) return { attributes: {}, body: normalized.trim() }
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) return { attributes: {}, body: normalized.trim() }
  const value = parse(normalized.slice(4, end)) as unknown
  const attributes = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return { attributes, body: normalized.slice(end + 5).trim() }
}

function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (['true', 'yes', 'on', '1'].includes(normalized)) return true
    if (['false', 'no', 'off', '0'].includes(normalized)) return false
  }
  return fallback
}

function staticPrefix(pattern: string): string {
  const wildcard = pattern.search(/[*?\[\]{}()]/u)
  if (wildcard < 0) return pattern
  const prefix = pattern.slice(0, wildcard)
  const slash = prefix.lastIndexOf('/')
  return slash < 0 ? '.' : prefix.slice(0, slash) || '.'
}

function walk(root: string, start: string): string[] {
  let realStart: string
  try { realStart = realpathSync(start) } catch { return [] }
  if (!contained(root, realStart)) return []
  const stats = statSync(realStart)
  if (stats.isFile()) return [realStart]
  if (!stats.isDirectory()) return []
  const values = [realStart]
  for (const entry of readdirSync(realStart, { withFileTypes: true })) {
    const path = resolve(realStart, entry.name)
    let real: string
    try { real = realpathSync(path) } catch { continue }
    if (!contained(root, real)) continue
    if (entry.isDirectory()) values.push(...walk(root, real))
    else if (entry.isFile()) values.push(real)
  }
  return values
}

function skillFiles(root: string, resource: string): string[] {
  const stats = statSync(resource)
  if (stats.isFile()) {
    return basename(resource) === 'SKILL.md' || extname(resource).toLowerCase() === '.md' ? [resource] : []
  }
  if (!stats.isDirectory()) return []
  const files: string[] = []
  for (const path of walk(root, resource)) {
    if (!statSync(path).isFile()) continue
    const local = relative(resource, path)
    if (basename(path) === 'SKILL.md' || (!local.includes(sep) && extname(path).toLowerCase() === '.md')) {
      files.push(path)
    }
  }
  return files
}

function resolveSkillFiles(config: Config): string[] {
  const root = realpathSync(config.pluginRoot)
  const include = config.entries.filter(entry => !entry.startsWith('!'))
  const exclude = config.entries.filter(entry => entry.startsWith('!')).map(entry => entry.slice(1))
  const resources = new Set<string>()
  for (const expression of include) {
    const hasPattern = /[*?\[\]{}()]/u.test(expression)
    if (!hasPattern) {
      const target = resolve(root, expression)
      if (!contained(root, target)) throw new TypeError(`Pi skill path "${expression}" escapes the plugin root`)
      let real: string
      try { real = realpathSync(target) } catch { continue }
      if (contained(root, real)) resources.add(real)
      continue
    }
    const start = resolve(root, staticPrefix(expression))
    if (!contained(root, start)) throw new TypeError(`Pi skill pattern "${expression}" escapes the plugin root`)
    for (const path of walk(root, start)) {
      const local = posix(relative(root, path))
      if (minimatch(local, expression, { dot: true })) resources.add(path)
    }
  }

  const files = new Set<string>()
  for (const resource of resources) {
    for (const file of skillFiles(root, resource)) {
      const localFile = posix(relative(root, file))
      const localBundle = posix(relative(root, basename(file) === 'SKILL.md' ? dirname(file) : file))
      if (exclude.some(pattern => minimatch(localFile, pattern, { dot: true })
        || minimatch(localBundle, pattern, { dot: true }))) continue
      files.add(file)
    }
  }
  return [...files].sort()
}

function fallbackName(file: string): string {
  return basename(file) === 'SKILL.md' ? basename(dirname(file)) : basename(file, extname(file))
}

export const name = 'plugin-bridge-pi-skills'
export const inject = ['skills']

export function apply(ctx: Context, config: Config): void {
  for (const file of resolveSkillFiles(config)) {
    const parsed = parsedSkill(readFileSync(file, 'utf8'))
    const skillName = typeof parsed.attributes.name === 'string' ? parsed.attributes.name : fallbackName(file)
    if (!isSkillName(skillName)) {
      ctx.logger.warn(`pi-skills: skipped invalid skill name ${JSON.stringify(skillName)} from ${file}`)
      continue
    }
    const description = typeof parsed.attributes.description === 'string'
      ? parsed.attributes.description
      : `Imported Pi skill ${skillName}`
    const whenToUse = typeof parsed.attributes.whenToUse === 'string'
      ? parsed.attributes.whenToUse
      : typeof parsed.attributes['when-to-use'] === 'string'
        ? parsed.attributes['when-to-use']
        : undefined
    const metadata = typeof parsed.attributes.metadata === 'object'
      && parsed.attributes.metadata !== null
      && !Array.isArray(parsed.attributes.metadata)
      ? parsed.attributes.metadata as Readonly<Record<string, unknown>>
      : undefined
    ctx.skills.register({
      name: skillName,
      description,
      content: parsed.body,
      source: 'bundled',
      provider: config.providerName,
      path: file,
      resourceBase: { kind: 'directory', path: basename(file) === 'SKILL.md' ? dirname(file) : dirname(file) },
      invocation: {
        modelInvocable: !boolean(parsed.attributes['disable-model-invocation'], false),
        userInvocable: boolean(parsed.attributes['user-invocable'], true),
      },
      ...whenToUse === undefined ? {} : { whenToUse },
      ...metadata === undefined ? {} : { metadata },
    })
  }
}
