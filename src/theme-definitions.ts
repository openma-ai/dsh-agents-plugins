import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, relative, resolve, sep } from 'node:path'
import { minimatch } from 'minimatch'
import { slug } from './adapters/utils.js'

export interface DshThemeDefinition {
  readonly id: string
  readonly colorScheme: 'light' | 'dark'
  readonly tokens: Readonly<Record<string, string>>
}

export interface ThemeLoadResult {
  readonly themes: readonly DshThemeDefinition[]
  readonly diagnostics: readonly string[]
}

type ThemeDialect = 'claude-code' | 'pi'
type ColorValue = string | number

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

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

function walk(root: string, start: string): string[] {
  let realStart: string
  try { realStart = realpathSync(start) } catch { return [] }
  if (!contained(root, realStart)) return []
  const stats = statSync(realStart)
  if (stats.isFile()) return [realStart]
  if (!stats.isDirectory()) return []
  const values: string[] = []
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

function themeFiles(pluginRoot: string, entries: readonly string[]): string[] {
  const root = realpathSync(pluginRoot)
  const excludes = entries.filter(entry => entry.startsWith('!')).map(entry => entry.slice(1))
  const files = new Set<string>()
  for (const expression of entries.filter(entry => !entry.startsWith('!'))) {
    const patterned = /[*?\[\]{}()]/u.test(expression)
    const start = resolve(root, patterned ? staticPrefix(expression) : expression)
    if (!contained(root, start)) throw new TypeError(`theme path "${expression}" escapes the plugin root`)
    const candidates = walk(root, start)
    for (const file of candidates) {
      if (extname(file).toLowerCase() !== '.json') continue
      const local = posix(relative(root, file))
      if (patterned && !minimatch(local, expression, { dot: true })) continue
      if (excludes.some(pattern => minimatch(local, pattern, { dot: true }))) continue
      files.add(file)
    }
  }
  return [...files].sort()
}

const ANSI = [
  '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
  '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
] as const

function xterm(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined
  if (index < 16) return ANSI[index]
  if (index < 232) {
    const value = index - 16
    const levels = [0, 95, 135, 175, 215, 255] as const
    const red = levels[Math.floor(value / 36)] as number
    const green = levels[Math.floor((value % 36) / 6)] as number
    const blue = levels[value % 6] as number
    return `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`
  }
  const gray = 8 + (index - 232) * 10
  const hex = gray.toString(16).padStart(2, '0')
  return `#${hex}${hex}${hex}`
}

function color(value: unknown, variables: Readonly<Record<string, unknown>>, seen = new Set<string>()): string | undefined {
  if (typeof value === 'number') return xterm(value)
  if (typeof value !== 'string' || value.length === 0) return undefined
  if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl') || value.startsWith('oklch') || value.startsWith('var(')) {
    return value
  }
  if (!Object.hasOwn(variables, value) || seen.has(value)) return value
  seen.add(value)
  return color(variables[value], variables, seen)
}

function mappedTokens(
  values: Record<string, unknown>,
  variables: Readonly<Record<string, unknown>>,
  mapping: Readonly<Record<string, readonly string[]>>,
): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const [target, sources] of Object.entries(mapping)) {
    for (const source of sources) {
      const resolved = color(values[source], variables)
      if (resolved === undefined) continue
      tokens[target] = resolved
      break
    }
  }
  return tokens
}

const PI_MAPPING: Readonly<Record<string, readonly string[]>> = {
  '--dsw-alias-bg-base': ['background'],
  '--dsw-alias-bg-layer-1': ['userMessageBg', 'selectedBg'],
  '--dsw-alias-bg-layer-2': ['customMessageBg', 'toolPendingBg'],
  '--dsw-alias-bg-overlay': ['toolSuccessBg', 'toolErrorBg'],
  '--dsw-alias-border-l1': ['borderMuted'],
  '--dsw-alias-border-l2': ['border', 'borderAccent'],
  '--dsw-alias-brand-primary': ['accent', 'mdLink', 'toolTitle'],
  '--dsw-alias-label-primary': ['text', 'userMessageText', 'toolOutput'],
  '--dsw-alias-label-secondary': ['muted', 'dim', 'thinkingText'],
  '--dsw-alias-state-error-primary': ['error', 'toolDiffRemoved'],
  '--dsw-alias-state-success-primary': ['success', 'toolDiffAdded'],
  '--dsw-alias-state-warn-primary': ['warning'],
}

const CLAUDE_MAPPING: Readonly<Record<string, readonly string[]>> = {
  '--dsw-alias-bg-base': ['background'],
  '--dsw-alias-bg-layer-1': ['userMessageBackground'],
  '--dsw-alias-bg-layer-2': ['bashMessageBackgroundColor', 'memoryBackgroundColor'],
  '--dsw-alias-bg-overlay': ['backgroundSecondary'],
  '--dsw-alias-border-l1': ['border', 'subtleBorder'],
  '--dsw-alias-border-l2': ['borderActive'],
  '--dsw-alias-brand-primary': ['claude', 'accent', 'professionalBlue'],
  '--dsw-alias-label-primary': ['text'],
  '--dsw-alias-label-secondary': ['subtle', 'inactive', 'secondaryText'],
  '--dsw-alias-state-error-primary': ['error', 'diffRemoved'],
  '--dsw-alias-state-success-primary': ['success', 'diffAdded'],
  '--dsw-alias-state-warn-primary': ['warning'],
}

function luminance(value: string | undefined): number | undefined {
  const match = /^#([0-9a-f]{6})$/iu.exec(value ?? '')
  if (match?.[1] === undefined) return undefined
  const rgb = [0, 2, 4].map(offset => Number.parseInt(match[1]!.slice(offset, offset + 2), 16) / 255)
  const linear = rgb.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function piTheme(value: unknown, pluginName: string, file: string): DshThemeDefinition {
  const theme = record(value, `${file}: Pi theme`)
  if (typeof theme.name !== 'string' || theme.name.trim().length === 0 || theme.name.includes('/')) {
    throw new TypeError(`${file}: Pi theme name must be a non-empty slash-free string`)
  }
  const variables = theme.vars === undefined ? {} : record(theme.vars, `${file}: vars`)
  const colors = record(theme.colors, `${file}: colors`)
  const tokens = mappedTokens(colors, variables, PI_MAPPING)
  const background = tokens['--dsw-alias-bg-base'] ?? tokens['--dsw-alias-bg-layer-1']
  return {
    id: `${slug(pluginName)}-${slug(theme.name)}`,
    colorScheme: (luminance(background) ?? 0) > 0.45 ? 'light' : 'dark',
    tokens,
  }
}

function claudeTheme(value: unknown, pluginName: string, file: string): DshThemeDefinition {
  const theme = record(value, `${file}: Claude theme`)
  if (typeof theme.name !== 'string' || theme.name.trim().length === 0) {
    throw new TypeError(`${file}: Claude theme name must be a non-empty string`)
  }
  if (theme.base !== 'light' && theme.base !== 'dark') {
    throw new TypeError(`${file}: Claude theme base must be "light" or "dark"`)
  }
  const overrides = theme.overrides === undefined ? {} : record(theme.overrides, `${file}: overrides`)
  return {
    id: `${slug(pluginName)}-${slug(theme.name)}`,
    colorScheme: theme.base,
    tokens: mappedTokens(overrides, {}, CLAUDE_MAPPING),
  }
}

export function loadThemeDefinitions(
  dialect: ThemeDialect,
  pluginName: string,
  pluginRoot: string,
  entries: readonly string[],
): ThemeLoadResult {
  const themes: DshThemeDefinition[] = []
  const diagnostics: string[] = []
  const seen = new Set<string>()
  for (const file of themeFiles(pluginRoot, entries)) {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8')) as unknown
      const theme = dialect === 'pi' ? piTheme(value, pluginName, file) : claudeTheme(value, pluginName, file)
      if (seen.has(theme.id)) throw new TypeError(`${file}: duplicate mapped theme id "${theme.id}"`)
      seen.add(theme.id)
      themes.push(theme)
    } catch (error: unknown) {
      diagnostics.push(`theme adapter: skipped ${basename(file)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { themes: Object.freeze(themes), diagnostics: Object.freeze(diagnostics) }
}
