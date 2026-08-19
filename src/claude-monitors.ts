import type { Context } from '@deepseek-ai/cordis'
import {
  applyClaudeMonitorsRuntime,
  type ClaudeMonitorsRuntimeConfig,
} from './adapters/dsh-claude-monitors.js'

export const name = 'plugin-bridge-claude-monitors'
export const inject = ['agents', 'subprocess']

export function apply(ctx: Context, config: ClaudeMonitorsRuntimeConfig): void {
  applyClaudeMonitorsRuntime(ctx, config)
}
