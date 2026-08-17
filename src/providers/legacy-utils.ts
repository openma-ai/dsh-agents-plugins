import { posix } from 'node:path'
import type { PackageComponent, PluginPackageSource } from '../kernel.js'

export function manifestObject(value: unknown, format: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${format}: plugin manifest must contain an object`)
  }
  const manifest = value as Record<string, unknown>
  if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
    throw new TypeError(`${format}: plugin manifest field "name" must be a non-empty string`)
  }
  return manifest
}

export function normalizePluginPath(value: string, format: string, field: string): string {
  if (!value.startsWith('./') || value.includes('\\')) {
    throw new TypeError(`${format}: ${field} must be a ./ plugin-relative path`)
  }
  const normalized = posix.normalize(value.slice(2))
  if (normalized.length === 0 || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError(`${format}: ${field} must remain within the plugin root`)
  }
  return value.endsWith('/') && !normalized.endsWith('/') ? `${normalized}/` : normalized
}

function values(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value]
}

export function declaredComponents(
  source: PluginPackageSource,
  manifestPath: string,
  manifest: Record<string, unknown>,
  field: string,
  type: string,
  format: string,
): PackageComponent[] {
  const declared = manifest[field]
  if (declared === undefined) return []
  const components: PackageComponent[] = []
  for (const entry of values(declared)) {
    if (typeof entry === 'string') {
      const path = normalizePluginPath(entry, format, field)
      if (!source.has(path)) throw new TypeError(`${format}: ${field} path "${entry}" does not exist`)
      components.push({ type, path })
      continue
    }
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      components.push({ type, path: manifestPath, manifestField: field })
      continue
    }
    throw new TypeError(`${format}: ${field} must be a plugin-relative path, an object, or an array of them`)
  }
  return components
}

export function fixedComponent(
  source: PluginPackageSource,
  type: string,
  path: string,
): PackageComponent[] {
  return source.has(path) ? [{ type, path }] : []
}

export function dedupeComponents(components: readonly PackageComponent[]): readonly PackageComponent[] {
  const seen = new Set<string>()
  return Object.freeze(components.filter((component) => {
    const key = `${component.type}\0${component.path}\0${component.manifestField ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }))
}
