import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { PluginPackageEntryKind, PluginPackageSource } from './kernel.js'

function contained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

/** Filesystem-backed package view that rejects paths and symlinks outside its root. */
export class DirectoryPackageSource implements PluginPackageSource {
  readonly root: string

  constructor(root: string) {
    this.root = realpathSync(root)
    if (!lstatSync(this.root).isDirectory()) throw new TypeError(`plugin root "${root}" is not a directory`)
  }

  has(path: string): boolean {
    const target = this.resolve(path)
    if (!existsSync(target)) return false
    this.assertRealTarget(target, path)
    return true
  }

  kind(path: string): PluginPackageEntryKind | undefined {
    const target = this.resolve(path)
    if (!existsSync(target)) return undefined
    this.assertRealTarget(target, path)
    const stats = statSync(target)
    if (stats.isFile()) return 'file'
    if (stats.isDirectory()) return 'directory'
    return 'other'
  }

  readJson(path: string): unknown {
    const target = this.resolve(path)
    if (this.kind(path) !== 'file') throw new TypeError(`package path "${path}" is not a regular file`)
    return JSON.parse(readFileSync(target, 'utf8')) as unknown
  }

  readText(path: string): string {
    const target = this.resolve(path)
    if (this.kind(path) !== 'file') throw new TypeError(`package path "${path}" is not a regular file`)
    return readFileSync(target, 'utf8')
  }

  private resolve(path: string): string {
    const target = resolve(this.root, path)
    if (!contained(this.root, target)) throw new TypeError(`package path "${path}" escapes the plugin root`)
    return target
  }

  private assertRealTarget(target: string, path: string): void {
    const real = realpathSync(target)
    if (!contained(this.root, real)) {
      throw new TypeError(`package path "${path}" resolves outside the plugin root`)
    }
  }
}
