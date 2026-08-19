import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'

const SURFACE_ROWS = [
  {
    id: 'plugin-bridge-ui-host',
    name: '@openma/dsh-agents-plugins-bridge/ui-host',
  },
  {
    id: 'plugin-bridge-ui',
    name: '@openma/dsh-agents-plugins-bridge-ui',
  },
] as const

export const name = 'plugin-bridge-ui-auto'
export const inject = ['loader']

/** Stay active on every surface and mount both Web faces while the Web seam exists. */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], webCtx => webCtx.effect(async () => {
    const owned: string[] = []
    const unmount = async () => {
      for (const id of [...owned].reverse()) {
        if (webCtx.loader.store[id] !== undefined) await webCtx.loader.remove(id)
      }
    }
    try {
      const creations: Promise<string>[] = []
      for (const row of SURFACE_ROWS) {
        if (webCtx.loader.store[row.id] !== undefined) continue
        owned.push(row.id)
        creations.push(webCtx.loader.create(row))
      }
      await Promise.all(creations)
    } catch (cause) {
      await unmount()
      throw cause
    }
    return unmount
  }, 'plugin-bridge-ui-auto: Web surface entries'))
}
