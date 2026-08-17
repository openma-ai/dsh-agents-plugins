import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ActivationPolicy } from '../kernel.js'

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`hook approval metadata "${field}" must be a non-empty string`)
  }
  return value
}

export const hookUserApprovalPolicy: ActivationPolicy = {
  name: 'hook-user-approval',
  async inspect(requirement) {
    const metadata = requirement.metadata ?? {}
    const configPath = nonEmptyString(metadata.configPath, 'configPath')
    const componentPath = nonEmptyString(metadata.componentPath, 'componentPath')
    const pluginName = nonEmptyString(metadata.pluginName, 'pluginName')
    const fileText = await readFile(configPath, 'utf8')
    const manifestField = metadata.manifestField
    if (manifestField !== undefined && typeof manifestField !== 'string') {
      throw new TypeError('hook approval metadata "manifestField" must be a string')
    }
    let definition = fileText
    if (manifestField !== undefined) {
      const manifest = JSON.parse(fileText) as unknown
      if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
        throw new TypeError(`hook manifest "${configPath}" must contain an object`)
      }
      definition = JSON.stringify((manifest as Record<string, unknown>)[manifestField])
    }
    const digest = createHash('sha256').update(definition).digest('hex')
    return {
      ...requirement,
      digest,
      review: [
        `Plugin: ${pluginName}`,
        `Hook: ${componentPath}`,
        `File: ${configPath}`,
        `Digest: ${digest}`,
        'Definition:',
        definition.trimEnd(),
      ].join('\n'),
    }
  },
}

export const name = 'plugin-bridge-policy-hook-user-approval'
export const inject = ['pluginBridge']

export function apply(ctx: Context): void {
  ctx.pluginBridge.registerActivationPolicy(hookUserApprovalPolicy)
}
