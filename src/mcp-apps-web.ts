import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { mountMcpAppsDependency } from './mcp-apps-dependency.js'

export const name = 'plugin-bridge-mcp-apps-web'
export const inject = ['loader']

export function apply(ctx: Context, config: unknown): Promise<void> {
  return mountMcpAppsDependency(ctx, '@openma/dsh-mcp-apps-web', config)
}
