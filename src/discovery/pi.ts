import { lstat, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  InstalledPluginCandidate,
  InstalledPluginLocator,
  InstalledPluginLocatorObservation,
} from '../kernel.js'
import { DirectoryPackageSource } from '../package-source.js'
import { piPackageProvider } from '../providers/pi-package.js'

export const name = 'plugin-bridge-discovery-pi'
export const inject = ['pluginBridge']

export interface Config {
  /** Pi settings file to inspect. Defaults to the user-scoped registry. */
  readonly settingsPath?: string
  /** Scope label attached to candidates from this settings file. */
  readonly scope?: 'user' | 'project'
}

interface ParsedSource {
  readonly kind: 'npm' | 'git' | 'local'
  readonly identity: string
  readonly root: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function npmSource(value: string, installRoot: string): ParsedSource | undefined {
  if (!value.startsWith('npm:')) return undefined
  const spec = value.slice('npm:'.length).trim()
  const match = /^(@[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+|[A-Za-z0-9._~-]+)(?:@(.+))?$/u.exec(spec)
  const packageName = match?.[1]
  if (packageName === undefined
    || packageName.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new TypeError(`invalid Pi npm package source "${value}"`)
  }
  return {
    kind: 'npm',
    identity: packageName,
    root: join(installRoot, 'npm', 'node_modules', ...packageName.split('/')),
  }
}

function splitPathRef(value: string): string {
  const ref = value.lastIndexOf('@')
  return ref > 0 ? value.slice(0, ref) : value
}

function gitSource(value: string, installRoot: string): ParsedSource | undefined {
  const hadPrefix = value.startsWith('git:')
  const candidate = hadPrefix ? value.slice('git:'.length).trim() : value.trim()
  if (!hadPrefix && !/^(?:https?|ssh|git):\/\//iu.test(candidate)) return undefined

  let host: string
  let path: string
  const scp = /^git@([^:]+):(.+)$/u.exec(candidate)
  if (scp?.[1] !== undefined && scp[2] !== undefined) {
    host = scp[1]
    path = splitPathRef(scp[2])
  } else if (/^(?:https?|ssh|git):\/\//iu.test(candidate)) {
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      throw new TypeError(`invalid Pi git package source "${value}"`)
    }
    host = url.hostname
    path = splitPathRef(url.pathname.replace(/^\/+/, ''))
  } else {
    const slash = candidate.indexOf('/')
    if (slash <= 0) throw new TypeError(`invalid Pi git package source "${value}"`)
    host = candidate.slice(0, slash)
    path = splitPathRef(candidate.slice(slash + 1))
  }

  path = path.replace(/\.git$/u, '').replace(/^\/+|\/+$/gu, '')
  let decodedHost: string
  let decodedPath: string
  try {
    decodedHost = decodeURIComponent(host)
    decodedPath = decodeURIComponent(path)
  } catch {
    throw new TypeError(`invalid Pi git package source "${value}"`)
  }
  const segments = path.split('/')
  if (host.length === 0
    || path.length === 0
    || segments.length < 2
    || host.includes('/')
    || host.includes('\\')
    || decodedHost.includes('/')
    || decodedHost.includes('\\')
    || path.includes('\\')
    || decodedPath.includes('\\')
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')
    || decodedPath.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new TypeError(`invalid Pi git package source "${value}"`)
  }
  const identity = `${host}/${path}`
  return {
    kind: 'git',
    identity,
    root: join(installRoot, 'git', host, ...segments),
  }
}

function parseSource(value: string, settingsPath: string): ParsedSource {
  const installRoot = dirname(settingsPath)
  const npm = npmSource(value, installRoot)
  if (npm !== undefined) return npm
  const git = gitSource(value, installRoot)
  if (git !== undefined) return git
  const root = isAbsolute(value) ? value : resolve(dirname(settingsPath), value)
  return { kind: 'local', identity: root, root }
}

function sourceEntry(value: unknown, index: number): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (record(value) && typeof value.source === 'string' && value.source.length > 0) {
    for (const field of ['extensions', 'skills', 'prompts', 'themes']) {
      const filter = value[field]
      if (filter !== undefined
        && (!Array.isArray(filter) || filter.some(entry => typeof entry !== 'string'))) {
        throw new TypeError(`packages[${index}].${field} must be an array of strings`)
      }
    }
    if (value.autoload !== undefined && typeof value.autoload !== 'boolean') {
      throw new TypeError(`packages[${index}].autoload must be a boolean`)
    }
    return value.source
  }
  throw new TypeError(`packages[${index}] must be a string or an object with a non-empty source`)
}

function candidateKey(scope: string, source: ParsedSource, canonicalRoot: string): string {
  const identity = source.kind === 'local' ? canonicalRoot : source.identity
  return `${scope}/${source.kind}/${encodeURIComponent(identity)}`
}

/** Reads Pi's explicit settings registry; Pi has no marketplace catalog registry. */
export function createPiInstalledPluginLocator(config: Config = {}): InstalledPluginLocator {
  const settingsPath = config.settingsPath ?? join(homedir(), '.pi', 'agent', 'settings.json')
  const scope = config.scope ?? 'user'
  return {
    name: `pi-installed-${scope}`,
    async discover(): Promise<InstalledPluginLocatorObservation> {
      let settings: Record<string, unknown>
      try {
        if (!(await lstat(settingsPath)).isFile()) {
          return { candidates: [], diagnostics: [`pi-installed: "${settingsPath}" is not a regular file`] }
        }
        const parsed = JSON.parse(await readFile(settingsPath, 'utf8')) as unknown
        if (!record(parsed)) throw new TypeError('settings root must be an object')
        settings = parsed
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { candidates: [] }
        return {
          candidates: [],
          diagnostics: [`pi-installed: cannot read "${settingsPath}": ${String(error)}`],
        }
      }
      if (settings.packages === undefined) return { candidates: [] }
      if (!Array.isArray(settings.packages)) {
        return {
          candidates: [],
          diagnostics: ['pi-installed: settings field "packages" must be an array'],
        }
      }

      const candidates: InstalledPluginCandidate[] = []
      const diagnostics: string[] = []
      const seenRoots = new Set<string>()
      for (const [index, unknownEntry] of settings.packages.entries()) {
        let entry: string
        let source: ParsedSource
        try {
          entry = sourceEntry(unknownEntry, index)
          source = parseSource(entry, settingsPath)
        } catch (error: unknown) {
          diagnostics.push(`pi-installed: ${error instanceof Error ? error.message : String(error)}`)
          continue
        }

        let root: string
        try {
          if (!(await lstat(source.root)).isDirectory()) {
            diagnostics.push(`pi-installed: packages[${index}] "${entry}" cannot be inspected: root is not a directory`)
            continue
          }
          root = await realpath(source.root)
        } catch (error: unknown) {
          diagnostics.push(`pi-installed: packages[${index}] "${entry}" cannot be inspected: ${String(error)}`)
          continue
        }
        if (seenRoots.has(root)) continue

        try {
          const packageSource = new DirectoryPackageSource(root)
          const observation = piPackageProvider.probe(packageSource)
          if (observation === undefined) {
            throw new TypeError('package does not contain a Pi manifest or conventional resource directory')
          }
          const version = observation.manifest.version
          candidates.push({
            key: candidateKey(scope, source, root),
            name: observation.manifest.name as string,
            root,
            evidence: 'installed-registry',
            ...typeof version === 'string' && version.length > 0 ? { version } : {},
            scope,
          })
          seenRoots.add(root)
        } catch (error: unknown) {
          diagnostics.push(
            `pi-installed: packages[${index}] "${entry}" is invalid: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      return {
        candidates,
        ...diagnostics.length === 0 ? {} : { diagnostics },
      }
    },
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  ctx.pluginBridge.registerInstalledPluginLocator(createPiInstalledPluginLocator(config))
}
