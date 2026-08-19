import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { parse } from 'yaml'
import type { ComponentAdapter, ComponentAdapterMaterialization, DshPluginRow } from '../kernel.js'
import { insidePlugin, packageName, slug } from './utils.js'

interface OutputStyleDefinition {
  readonly name: string
  readonly description: string
  readonly sourcePath: string
  readonly instructions: string
  readonly keepCodingInstructions: boolean
  readonly forceForPlugin: boolean
}

function contained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

function posix(path: string): string {
  return path.split(sep).join('/')
}

function markdownFiles(root: string, target: string, visited = new Set<string>()): string[] {
  const realRoot = realpathSync(root)
  const realTarget = realpathSync(target)
  if (!contained(realRoot, realTarget)) {
    throw new TypeError(`Claude output-style component resolves outside plugin root: ${target}`)
  }
  const stats = statSync(realTarget)
  if (stats.isFile()) return extname(realTarget).toLowerCase() === '.md' ? [realTarget] : []
  if (!stats.isDirectory() || visited.has(realTarget)) return []
  visited.add(realTarget)
  const files: string[] = []
  for (const entry of readdirSync(realTarget, { withFileTypes: true })) {
    const path = resolve(realTarget, entry.name)
    const real = realpathSync(path)
    if (!contained(realRoot, real)) {
      throw new TypeError(`Claude output-style entry resolves outside plugin root: ${path}`)
    }
    const child = statSync(real)
    if (child.isDirectory()) files.push(...markdownFiles(realRoot, real, visited))
    else if (child.isFile() && extname(real).toLowerCase() === '.md') files.push(real)
  }
  return files.sort()
}

function frontmatter(markdown: string, file: string): {
  readonly attributes: Readonly<Record<string, unknown>>
  readonly body: string
  readonly present: boolean
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown)
  if (match?.[1] === undefined) return { attributes: {}, body: markdown.trim(), present: false }
  const decoded: unknown = parse(match[1])
  if (decoded !== null && (typeof decoded !== 'object' || Array.isArray(decoded))) {
    throw new TypeError(`Claude output style ${file} frontmatter must be an object`)
  }
  return {
    attributes: decoded === null ? {} : decoded as Record<string, unknown>,
    body: markdown.slice(match[0].length).trim(),
    present: true,
  }
}

function requiredString(attributes: Readonly<Record<string, unknown>>, key: string): string {
  const value = attributes[key]
  if (value === undefined) throw new TypeError(`frontmatter ${key} is required`)
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`frontmatter ${key} must be a non-empty string`)
  }
  return value.trim()
}

function boolean(attributes: Readonly<Record<string, unknown>>, key: string, file: string): boolean {
  const value = attributes[key]
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    throw new TypeError(`Claude output style ${file} frontmatter ${key} must be a boolean`)
  }
  return value
}

function definitions(root: string, componentPath: string): {
  readonly definitions: readonly OutputStyleDefinition[]
  readonly diagnostics: readonly string[]
} {
  const component = resolve(root, componentPath)
  const accepted: OutputStyleDefinition[] = []
  const diagnostics: string[] = []
  for (const file of markdownFiles(root, component)) {
    const sourcePath = posix(relative(realpathSync(root), file))
    try {
      const parsed = frontmatter(readFileSync(file, 'utf8'), sourcePath)
      if (!parsed.present) throw new TypeError('frontmatter is required')
      const name = requiredString(parsed.attributes, 'name')
      const description = requiredString(parsed.attributes, 'description')
      if (parsed.body.length === 0) throw new TypeError('instructions body is required')
      accepted.push({
        name,
        description,
        sourcePath,
        instructions: parsed.body,
        keepCodingInstructions: boolean(parsed.attributes, 'keep-coding-instructions', sourcePath),
        forceForPlugin: boolean(parsed.attributes, 'force-for-plugin', sourcePath),
      })
    } catch (error) {
      diagnostics.push(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { definitions: accepted, diagnostics }
}

function row(pluginName: string, definition: OutputStyleDefinition): DshPluginRow {
  const sourceId = slug(definition.sourcePath.slice(0, -extname(definition.sourcePath).length))
  return {
    id: `plugin-bridge-${slug(pluginName)}-output-style-${sourceId}`,
    name: '@openma/dsh-agents-plugins-bridge/adapters/dsh-output-style-host',
    config: {
      pluginName,
      styleName: definition.name,
      description: definition.description,
      sourcePath: definition.sourcePath,
      instructions: definition.instructions,
      keepCodingInstructions: definition.keepCodingInstructions,
      forceForPlugin: definition.forceForPlugin,
    },
  }
}

/** Preserve every Claude output-style definition and auto-apply only explicitly forced styles. */
export const dshOutputStylesAdapter: ComponentAdapter = {
  name: 'dsh-output-styles',
  componentTypes: ['output-style'],
  materialize(input): ComponentAdapterMaterialization {
    if (input.detected.provider !== 'claude-code-legacy') {
      throw new TypeError(`${input.detected.provider}: output-style component has no DSH adapter`)
    }
    const pluginName = packageName(input)
    const componentRoot = insidePlugin(input, input.component.path)
    const scanned = definitions(input.source.root, relative(input.source.root, componentRoot))
    return {
      rows: scanned.definitions.map(style => row(pluginName, style)),
      ...scanned.diagnostics.length === 0 ? {} : { diagnostics: scanned.diagnostics },
    }
  },
}

export const name = 'plugin-bridge-adapter-dsh-output-styles'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerComponentAdapter(dshOutputStylesAdapter)
}
