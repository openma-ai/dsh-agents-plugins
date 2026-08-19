import assert from 'node:assert/strict'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as UiAuto from '../src/ui-auto.js'

const UI_HOST = '@openma/dsh-agents-plugins-bridge/ui-host'
const UI_CLIENT = '@openma/dsh-agents-plugins-bridge/ui'

class WebServerProbe extends Service {
  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }
}

function entryNames(ctx: Context): string[] {
  return [...ctx.loader.entries()].map(entry => entry.options.name)
}

test('TUI keeps the adaptive surface active without mounting Web children', async () => {
  const ctx = new Context()
  await ctx.plugin(Loader)

  const fiber = await ctx.plugin(UiAuto)

  assert.equal(fiber.state, 2)
  assert.deepEqual(entryNames(ctx), [])
  await fiber.dispose()
})

test('Web auto surface mounts both plugin faces through Loader and owns their teardown', async () => {
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === UI_HOST || specifier === UI_CLIENT) {
        return { name: specifier, apply() {} }
      }
      throw new Error(`unexpected Loader import: ${specifier}`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.plugin(WebServerProbe)

  const fiber = await ctx.plugin(UiAuto)
  await ctx.loader.await()

  assert.deepEqual(entryNames(ctx).sort(), [UI_CLIENT, UI_HOST].sort())
  await fiber.dispose()
  assert.deepEqual(entryNames(ctx), [])
})
