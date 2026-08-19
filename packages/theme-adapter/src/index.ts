import type { Context } from '@deepseek-ai/cordis'

export const name = 'plugin-bridge-theme-host'

/** Host half intentionally owns no service; its client manifest registers the themes. */
export function apply(_ctx: Context): void {}
