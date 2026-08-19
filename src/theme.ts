import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { mountOwnedDependency } from './owned-dependency.js'

export const name = 'plugin-bridge-theme-wrapper'
export const inject = ['loader']

export function apply(ctx: Context, config: unknown): Promise<void> {
  return mountOwnedDependency(ctx, '@openma/dsh-agents-plugins-bridge-theme', config)
}
