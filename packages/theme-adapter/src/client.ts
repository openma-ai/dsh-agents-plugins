import type { Context } from '@deepseek-ai/cordis'
import type { ThemeDefinition } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'

export interface Config {
  readonly themes: readonly ThemeDefinition[]
}

export const inject = ['theme']

/** Register package-owned themes as one disposable client contribution. */
export function apply(ctx: Context, config: Config): () => void {
  if (!Array.isArray(config.themes)) throw new TypeError('plugin bridge theme config requires a themes array')
  const disposers: Array<() => void> = []
  try {
    for (const definition of config.themes) disposers.push(ctx.theme.register(definition))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
